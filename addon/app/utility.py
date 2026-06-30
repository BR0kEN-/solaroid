import json
import logging
import time
from abc import ABC
from dataclasses import dataclass, asdict
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Final

import requests

from config import DtekConfig


STATE_PATH = Path("/data/solaroid-utility-meter-state.json")
CHECK_DAYS_BEFORE_MONTH_END = 1
CHECK_DAYS_AFTER_MONTH_START = 3


class UtilityMeterFetchError(RuntimeError):
    def __init__(self, message: str | None, failure_count: int, last_success_at: float | None) -> None:
        super().__init__(message)
        self.message = message
        self.failure_count = failure_count
        self.last_success_at = last_success_at


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


def utility_payload(payload: dict[str, Any]) -> dict[str, Any]:
    diff = payload.get("diff")
    samples = payload.get("samples")

    if not isinstance(diff, dict):
        raise ValueError("Utility response missing diff")
    if not isinstance(samples, dict) or not samples:
        raise ValueError("Utility response missing samples")

    month = max(str(key) for key in samples.keys())

    return {
        "month": month,
        "import": {
            "day": float(parse_value(diff["import"]["day"])),
            "night": float(parse_value(diff["import"]["night"])),
        },
        "export": {
            "day": float(parse_value(diff["export"]["day"])),
            "night": float(parse_value(diff["export"]["night"])),
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
