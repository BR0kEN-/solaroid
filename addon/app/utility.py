import base64
import json
import time
from abc import ABC
from collections import defaultdict
from dataclasses import dataclass, asdict
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Final

import requests

from config import DtekConfig


STATE_PATH = Path("/data/solaroid-utility-meter-state.json")
CHECK_DAYS_BEFORE_MONTH_END = 1
CHECK_DAYS_AFTER_MONTH_START = 3
IMPORT_CODE = "01"
EXPORT_CODE = "03"
DAY_SCALE = "04"
NIGHT_SCALE = "05"
USER_TYPE = "person"


@dataclass(frozen=True)
class MonthReading:
    date: datetime
    date_text: str
    import_day: Decimal
    import_night: Decimal
    export_day: Decimal
    export_night: Decimal


class UtilityMeterFetchError(RuntimeError):
    def __init__(self, message: str | None, failure_count: int, last_success_at: float | None) -> None:
        super().__init__(message)
        self.message = message
        self.failure_count = failure_count
        self.last_success_at = last_success_at


def post_json(
    url: str,
    payload: dict[str, Any],
    token: str | None = None,
    cookies: dict[str, str] | None = None,
) -> dict[str, Any]:
    headers = {
        "Content-Type": "application/json",
    }

    if token is not None:
        headers["Authorization"] = f"Basic {token}"

    response = requests.post(url, json=payload, headers=headers, cookies=cookies, timeout=45)
    response.raise_for_status()
    return response.json()


def fetch_history(config: DtekConfig) -> dict[str, Any]:
    auth = post_json(
        f"{config.url}/auth/{USER_TYPE}",
        {
            "site": config.department,
            "phone": config.phone,
            "userType": USER_TYPE,
            "language": "en-US",
            "platform": "MacIntel",
        },
        base64.b64encode(f"{config.phone}:{config.password}".encode("utf-8")).decode("ascii"),
        config.cookies,
    )

    token = auth.get("user", {}).get("token")

    if not token:
        raise RuntimeError("Utility auth response missing user.token")

    return post_json(
        f"{config.url}/get-common",
        {
            "url": f"/{USER_TYPE}/cust_data_history",
            "token": token,
            "account": config.accountId,
            "userType": USER_TYPE,
        },
        cookies=config.cookies,
    )


def parse_value(value: Any) -> Decimal:
    try:
        return Decimal(str(value))
    except InvalidOperation as error:
        raise ValueError(f"Invalid meter value: {value!r}") from error


def collect_months(items: list[dict[str, Any]]) -> list[MonthReading]:
    buckets: dict[str, dict[str, dict[str, Decimal]]] = defaultdict(dict)
    for item in items:
        if item.get("inactive"):
            continue
        date_text = item.get("date")
        energy_code = str(item.get("energyCode", ""))
        scale = str(item.get("scale", ""))
        if not isinstance(date_text, str) or energy_code not in {IMPORT_CODE, EXPORT_CODE}:
            continue
        buckets[date_text].setdefault(energy_code, {})[scale] = parse_value(item.get("value"))

    readings: list[MonthReading] = []
    for date_text, by_code in buckets.items():
        if IMPORT_CODE not in by_code or EXPORT_CODE not in by_code:
            continue
        readings.append(
            MonthReading(
                date=datetime.strptime(date_text, "%d.%m.%Y"),
                date_text=date_text,
                import_day=by_code[IMPORT_CODE].get(DAY_SCALE, Decimal("0")),
                import_night=by_code[IMPORT_CODE].get(NIGHT_SCALE, Decimal("0")),
                export_day=by_code[EXPORT_CODE].get(DAY_SCALE, Decimal("0")),
                export_night=by_code[EXPORT_CODE].get(NIGHT_SCALE, Decimal("0")),
            )
        )
    return sorted(readings, key=lambda reading: reading.date)


def utility_payload(payload: dict[str, Any]) -> dict[str, Any]:
    items = payload.get("data", {}).get("items")
    if not isinstance(items, list):
        raise ValueError("Utility response missing data.items")
    readings = collect_months([item for item in items if isinstance(item, dict)])
    if len(readings) < 2:
        raise ValueError("Need at least two active utility readings")
    previous = readings[-2]
    latest = readings[-1]
    return {
        "month": latest.date.strftime("%Y-%m"),
        "import": {
            "day": float(latest.import_day - previous.import_day),
            "night": float(latest.import_night - previous.import_night),
        },
        "export": {
            "day": float(latest.export_day - previous.export_day),
            "night": float(latest.export_night - previous.export_night),
        },
    }


def is_complete_payload(payload: Any) -> bool:
    try:
        values = [
            payload["month"],
            payload["import"]["day"],
            payload["import"]["night"],
            payload["export"]["day"],
            payload["export"]["night"],
        ]
    except (KeyError, TypeError):
        return False
    month, *numbers = values
    return (
        isinstance(month, str)
        and len(month) == 7
        and all(isinstance(value, (int, float)) and value == value for value in numbers)
    )


@dataclass()
class State:
    checkedAt: float | None = None
    payload: dict[str, Any] | None = None
    failureCount: int = 0
    lastFailureAt: float | None = None
    lastSuccessAt: float | None = None
    lastError: str | None = None

    @property
    def checked_minutes_ago(self) -> float:
        return (time.time() - float(self.checkedAt or 0)) / 60


class Storage[T: State]:
    def __init__(self, cls: type[T], path: Path = STATE_PATH) -> None:
        self._cls: Final[type[T]] = cls
        self._path: Final[Path] = path

    def load(self) -> T:
        # noinspection PyBroadException
        try:
            if self._path.exists():
                with self._path.open(encoding="utf-8") as file:
                    return self._cls(**json.load(file))
        except:
            pass

        return self._cls()

    def save(self, state: T) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)

        state.checkedAt = time.time()

        with self._path.open("w", encoding="utf-8") as file:
            json.dump(asdict(state), file, ensure_ascii=False)


def sanitize_error(error: Exception, config: DtekConfig) -> str:
    status_code = getattr(getattr(error, "response", None), "status_code", None)
    text = f"{error.__class__.__name__}"

    if status_code is not None:
        text = f"{text}: HTTP {status_code}"
    elif str(error):
        text = f"{text}: {error}"

    secrets = [
        config.phone,
        config.password,
        base64.b64encode(f"{config.phone}:{config.password}".encode("utf-8")).decode("ascii"),
        *config.cookies.values(),
    ]

    for secret in secrets:
        if secret:
            text = text.replace(secret, "[redacted]")

    return text[:220]


class UtilityMeter(ABC):
    def __init__(self) -> None:
        self._recovered_from_failure = False

    @property
    def recovered_from_failure(self) -> bool:
        return self._recovered_from_failure

    def get_values(self) -> dict[str, Any] | None:
        raise NotImplementedError


class Dtek(UtilityMeter):
    def __init__(self, config: DtekConfig, storage: Path = STATE_PATH) -> None:
        super().__init__()
        self._config: Final[DtekConfig] = config
        self._state_storage: Final[Storage] = Storage(State, storage)

    def get_values(self) -> dict[str, Any] | None:
        if not self._config.enabled:
            return None

        self._recovered_from_failure = False
        state = self._state_storage.load()

        if state.checked_minutes_ago > self._config.intervalMinutes:
            try:
                state.payload = utility_payload(fetch_history(self._config))
                self._recovered_from_failure = state.failureCount > 0
                state.failureCount = 0
                state.lastFailureAt = None
                state.lastSuccessAt = time.time()
                state.lastError = None
                self._state_storage.save(state)
            except Exception as error:
                state.failureCount += 1
                state.lastFailureAt = time.time()
                state.lastError = sanitize_error(error, self._config)
                self._state_storage.save(state)
                raise UtilityMeterFetchError(state.lastError, state.failureCount, state.lastSuccessAt) from error

        if state.failureCount > 0:
            return None

        return state.payload if is_complete_payload(state.payload) else None


__all__ = [
    "Dtek",
    "UtilityMeterFetchError",
    "UtilityMeter",
]
