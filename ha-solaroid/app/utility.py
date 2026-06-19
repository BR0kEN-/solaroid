import base64
import json
import ssl
import subprocess
import time
import urllib.error
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from config import DtekConfig


STATE_PATH = Path("/data/solaroid-utility-meter-state.json")
CHECK_DAYS_BEFORE_MONTH_END = 3
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


def should_check(today: date | None = None) -> bool:
    current = today or date.today()
    first_next_month = (current.replace(day=28) + timedelta(days=4)).replace(day=1)
    days_before_end = (first_next_month - current).days
    return current.day <= CHECK_DAYS_AFTER_MONTH_START or days_before_end <= CHECK_DAYS_BEFORE_MONTH_END


def load_state(path: Path = STATE_PATH) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as file:
        return json.load(file)


def save_state(state: dict[str, Any], path: Path = STATE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(state, file, ensure_ascii=False, indent=2)


def due(config: DtekConfig, now: float | None = None, path: Path = STATE_PATH) -> bool:
    if not config.enabled or not should_check():
        return False
    state = load_state(path)
    checked_at = float(state.get("checkedAt", 0) or 0)
    return (now or time.time()) - checked_at >= config.intervalMinutes * 60


def curl_post_json(url: str, payload: dict[str, Any], token: str | None = None) -> dict[str, Any]:
    command = [
        "curl",
        url,
        "--silent",
        "--show-error",
        "--fail",
        "--header",
        "Content-Type: application/json",
        "--data",
        json.dumps(payload),
    ]
    if token is not None:
        command.extend(["--header", f"Authorization: Basic {token}"])
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def post_json(url: str, payload: dict[str, Any], token: str | None = None) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["Authorization"] = f"Basic {token}"
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.URLError as error:
        if isinstance(error.reason, ssl.SSLCertVerificationError):
            return curl_post_json(url, payload, token)
        raise


def fetch_history(config: DtekConfig) -> dict[str, Any]:
    auth_token = base64.b64encode(f"{config.phone}:{config.password}".encode("utf-8")).decode("ascii")
    auth_payload = {
        "language": "en-US",
        "phone": config.phone,
        "platform": "HomeAssistant",
        "site": config.department,
        "userType": USER_TYPE,
    }
    auth_data = post_json(f"{config.url}/auth/{USER_TYPE}", auth_payload, auth_token)
    token = auth_data.get("user", {}).get("token")
    if not token:
        raise RuntimeError("Utility auth response missing user.token")
    return post_json(
        f"{config.url}/get-common",
        {
            "token": token,
            "account": config.account_id,
            "userType": USER_TYPE,
            "url": f"/{USER_TYPE}/cust_data_history",
        },
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
            payload["import"]["day"],
            payload["import"]["night"],
            payload["export"]["day"],
            payload["export"]["night"],
        ]
    except (KeyError, TypeError):
        return False
    return all(isinstance(value, (int, float)) and value == value for value in values)


def get_utility_values(config: DtekConfig, path: Path = STATE_PATH) -> dict[str, Any] | None:
    if not config.enabled or not should_check():
        return None
    if not due(config, path=path):
        state = load_state(path)
        payload = state.get("payload")
        return payload if is_complete_payload(payload) else None
    payload = utility_payload(fetch_history(config))
    save_state({"checkedAt": time.time(), "payload": payload}, path)
    return payload
