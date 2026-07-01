import json
import logging
import time
from abc import ABC
from calendar import monthrange
from dataclasses import dataclass, asdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Final

import requests

from config import DtekConfig


STATE_PATH = Path("/data/solaroid-utility-meter-state.json")
CHECK_DAYS_AFTER_MONTH_START = 3
# Note: Cyrillic letter!
AUTOMATED_READING_TYPE = "А"
IMPORT_ENERGY_CODE = "01"
EXPORT_ENERGY_CODE = "03"
TOTAL_SCALE = "00"
DAY_SCALE = "04"
NIGHT_SCALE = "05"
DAY_KEY = "day"
NIGHT_KEY = "night"


class UtilityMeterFetchError(RuntimeError):
    def __init__(self, message: str | None, failure_count: int, last_success_at: float | None) -> None:
        super().__init__(message)
        self.message = message
        self.failure_count = failure_count
        self.last_success_at = last_success_at


class UtilityMeterStaleError(RuntimeError):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class StaleUtilityDataError(ValueError):
    pass


def fetch_history(config: DtekConfig) -> dict[str, Any]:
    response = requests.get(
        config.url,
        headers={
            "Authorization": f"Basic {config.auth}",
            "Accept": "application/json",
        },
        timeout=45,
    )
    response.raise_for_status()
    payload = response.json()
    logging.info("Utility meter response: %s", payload)
    return payload


def parse_value(value: Any) -> Decimal:
    try:
        return Decimal(str(value))
    except InvalidOperation as error:
        raise ValueError(f"Invalid meter value: {value!r}") from error


def month_key(day: date) -> str:
    return f"{day.year}-{day.month:02d}"


def previous_month_key(day: date) -> str:
    year = day.year
    month = day.month - 1
    if month == 0:
        year -= 1
        month = 12
    return f"{year}-{month:02d}"


def expected_utility_month(today: date | None = None) -> str | None:
    day = today or date.today()

    if day.day <= CHECK_DAYS_AFTER_MONTH_START:
        return previous_month_key(day)

    return None


def payload_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    items = payload.get("data", {}).get("items") if isinstance(payload.get("data"), dict) else None

    if not isinstance(items, list):
        raise ValueError("Utility response missing data.items")

    return [item for item in items if isinstance(item, dict)]


def parse_item_date(raw: Any) -> date:
    if not isinstance(raw, str):
        raise ValueError(f"Invalid meter date: {raw!r}")

    return datetime.strptime(raw, "%d.%m.%Y").date()


def reading_sort_key(item: dict[str, Any]) -> str:
    item_date = parse_item_date(item.get("date"))
    item_time = item.get("time") if isinstance(item.get("time"), str) else "00:00"

    return f"{item_date.isoformat()} {item_time}"


def item_month(item: dict[str, Any]) -> str:
    return month_key(parse_item_date(item.get("date")))


def is_final_month_reading(item: dict[str, Any]) -> bool:
    item_date = parse_item_date(item.get("date"))
    last_day = monthrange(item_date.year, item_date.month)[1]

    return item_date.day > last_day - 2


def is_automated_active_reading(item: dict[str, Any]) -> bool:
    return (
        not item.get("inactive")
        and not item.get("blocked")
        and item.get("type") == AUTOMATED_READING_TYPE
        and is_final_month_reading(item)
    )


def direction_key(item: dict[str, Any]) -> str | None:
    if item.get("energyCode") == IMPORT_ENERGY_CODE:
        return "import"
    if item.get("energyCode") == EXPORT_ENERGY_CODE:
        return "export"

    return None


def zone_key(item: dict[str, Any]) -> str | None:
    if item.get("scale") == DAY_SCALE:
        return DAY_KEY
    if item.get("scale") == NIGHT_SCALE:
        return NIGHT_KEY

    return None


def month_readings(items: list[dict[str, Any]]) -> dict[str, dict[str, dict[str, Decimal]]]:
    months: dict[str, dict[str, dict[str, Decimal]]] = {}
    latest: dict[tuple[str, str, str], str] = {}

    for item in items:
        month = item_month(item)
        direction = direction_key(item)
        if direction is None:
            continue

        scale = item.get("scale")
        if scale == TOTAL_SCALE:
            candidates = ((DAY_KEY, parse_value(item.get("value"))), (NIGHT_KEY, Decimal(0)))
        else:
            zone = zone_key(item)
            if zone is None:
                continue
            candidates = ((zone, parse_value(item.get("value"))),)

        sort_key = reading_sort_key(item)
        for zone, value in candidates:
            key = (month, direction, zone)
            if sort_key < latest.get(key, ""):
                continue

            months.setdefault(month, {}).setdefault(direction, {})[zone] = value
            latest[key] = sort_key

    return months


def complete_months(months: dict[str, dict[str, dict[str, Decimal]]]) -> list[str]:
    return [
        month
        for month, readings in months.items()
        if all(zone in readings.get(direction, {}) for direction in ("import", "export") for zone in (DAY_KEY, NIGHT_KEY))
    ]


def decimal_diff(current: Decimal, previous: Decimal) -> float:
    return float(current - previous)


def utility_payload(payload: dict[str, Any], expected_month: str | None = None) -> dict[str, Any]:
    readings = month_readings([item for item in payload_items(payload) if is_automated_active_reading(item)])
    months = sorted(complete_months(readings), reverse=True)

    if len(months) < 2:
        raise ValueError("Utility response has fewer than two complete months")

    month = months[0]
    if expected_month is not None and month != expected_month:
        raise StaleUtilityDataError(f"Utility response stale: latest {month}, expected {expected_month}")

    previous_month = months[1]
    current = readings[month]
    previous = readings[previous_month]

    return {
        "month": month,
        "import": {
            "day": decimal_diff(current["import"][DAY_KEY], previous["import"][DAY_KEY]),
            "night": decimal_diff(current["import"][NIGHT_KEY], previous["import"][NIGHT_KEY]),
        },
        "export": {
            "day": decimal_diff(current["export"][DAY_KEY], previous["export"][DAY_KEY]),
            "night": decimal_diff(current["export"][NIGHT_KEY], previous["export"][NIGHT_KEY]),
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

    for secret in (
        config.phone,
        config.password,
        config.accountId,
        config.auth,
    ):
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

        if state.failureCount > 0 or state.checked_minutes_ago > self._config.intervalMinutes:
            try:
                state.payload = utility_payload(fetch_history(self._config), expected_utility_month())
                self._recovered_from_failure = state.failureCount > 0
                state.failureCount = 0
                state.lastFailureAt = None
                state.lastSuccessAt = time.time()
                state.lastError = None
                self._state_storage.save(state)
            except StaleUtilityDataError as error:
                self._recovered_from_failure = state.failureCount > 0
                state.failureCount = 0
                state.lastFailureAt = None
                state.lastSuccessAt = time.time()
                state.lastError = None
                self._state_storage.save(state)
                raise UtilityMeterStaleError(str(error)) from error
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
    "UtilityMeterStaleError",
    "UtilityMeter",
]
