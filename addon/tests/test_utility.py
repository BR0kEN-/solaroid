import json
import base64
import time
from datetime import date
from pathlib import Path

import pytest

from config import DtekConfig
from utility import Dtek, UtilityMeterFetchError, UtilityMeterStaleError, expected_utility_month, fetch_history, utility_payload


FIXTURES = Path(__file__).parent / "__fixtures__"


def response_payload() -> dict[str, object]:
    return load_fixture("two-zone-export-meter.json")


def total_export_payload() -> dict[str, object]:
    return load_fixture("total-export-meter.json")


def stale_payload() -> dict[str, object]:
    payload = response_payload()
    data = payload["data"]
    if not isinstance(data, dict):
        raise AssertionError("fixture data must be an object")
    items = data["items"]
    if not isinstance(items, list):
        raise AssertionError("fixture items must be a list")

    data["items"] = [
        item
        for item in items
        if isinstance(item, dict) and item.get("date") in {"31.05.2026", "30.04.2026"}
    ]

    return payload


def load_fixture(name: str) -> dict[str, object]:
    with (FIXTURES / name).open(encoding="utf-8") as file:
        payload = json.load(file)

    if not isinstance(payload, dict):
        raise AssertionError(f"{name} must contain a JSON object")

    return payload


def config() -> DtekConfig:
    return DtekConfig(
        endpoint="https://n8n.example.test",
        phone="+380971234567",
        password="secret",
        accountId="nest",
        department="dnem",
        intervalMinutes=0,
    )


def slow_config() -> DtekConfig:
    return DtekConfig(
        endpoint="https://n8n.example.test",
        phone="+380971234567",
        password="secret",
        accountId="nest",
        department="dnem",
        intervalMinutes=60,
    )


def test_uses_previous_reading_month_for_delta() -> None:
    payload = utility_payload(response_payload())

    assert payload["month"] == "2026-06"
    assert payload["import"] == {"day": 58, "night": 108}
    assert payload["export"] == {"day": 2432, "night": 22}


def test_supports_total_export_meter_as_day_with_zero_night() -> None:
    payload = utility_payload(total_export_payload())

    assert payload["month"] == "2026-06"
    assert payload["import"] == {"day": 40, "night": 392}
    assert payload["export"] == {"day": 1701, "night": 0}


def test_rejects_stale_payload_when_expected_month_missing() -> None:
    with pytest.raises(ValueError, match="latest 2026-05, expected 2026-06"):
        utility_payload(stale_payload(), "2026-06")


def test_expected_utility_month_covers_start_grace_only() -> None:
    assert expected_utility_month(date(2026, 6, 30)) is None
    assert expected_utility_month(date(2026, 7, 1)) == "2026-06"
    assert expected_utility_month(date(2026, 7, 3)) == "2026-06"
    assert expected_utility_month(date(2026, 7, 4)) is None


def test_fetch_history_calls_n8n_webhook_with_three_part_basic_auth(monkeypatch) -> None:
    calls: list[dict[str, object]] = []

    class Response:
        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict[str, object]:
            return response_payload()

    def get(url: str, headers: dict[str, str], timeout: int) -> Response:
        calls.append({"url": url, "headers": headers, "timeout": timeout})
        return Response()

    monkeypatch.setattr("utility.requests.get", get)

    payload = fetch_history(config())

    token = base64.b64encode(b"nest:+380971234567:secret").decode("ascii")
    assert calls == [
        {
            "url": "https://n8n.example.test/webhook/um?department=dnem",
            "headers": {
                "Authorization": f"Basic {token}",
                "Accept": "application/json",
            },
            "timeout": 45,
        }
    ]
    assert payload == response_payload()


def test_fetch_history_adds_department_query_to_base_url(monkeypatch) -> None:
    calls: list[str] = []

    class Response:
        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict[str, object]:
            return response_payload()

    def get(url: str, **_kwargs: object) -> Response:
        calls.append(url)
        return Response()

    trailing_slash_config = DtekConfig(
        endpoint="https://n8n.example.test/",
        phone="+380971234567",
        password="secret",
        accountId="nest",
        department="dnem",
        intervalMinutes=0,
    )

    monkeypatch.setattr("utility.requests.get", get)

    fetch_history(trailing_slash_config)

    assert calls == ["https://n8n.example.test/webhook/um?department=dnem"]


def test_failed_fetch_updates_failure_state_without_clearing_cached_payload(tmp_path, monkeypatch) -> None:
    cached_payload = {"month": "2026-07", "import": {"day": 1, "night": 2}, "export": {"day": 3, "night": 4}}
    path = tmp_path / "state.json"
    path.write_text(json.dumps({"checkedAt": 0, "payload": cached_payload}), encoding="utf-8")

    def fetch() -> None:
        raise RuntimeError("blocked secret")

    monkeypatch.setattr("utility.expected_utility_month", lambda: None)
    monkeypatch.setattr("utility.fetch_history", lambda _config: fetch())

    with pytest.raises(UtilityMeterFetchError) as first:
        Dtek(config(), path).get_values()
    with pytest.raises(UtilityMeterFetchError) as second:
        Dtek(config(), path).get_values()

    state = json.loads(path.read_text(encoding="utf-8"))

    assert first.value.failure_count == 1
    assert second.value.failure_count == 2
    assert state["failureCount"] == 2
    assert state["payload"] == cached_payload
    assert "secret" not in state["lastError"]


def test_recent_failure_retries_without_waiting_for_interval(tmp_path, monkeypatch) -> None:
    path = tmp_path / "state.json"
    path.write_text(
        json.dumps(
            {
                "checkedAt": time.time(),
                "payload": None,
                "failureCount": 1,
                "lastFailureAt": time.time(),
                "lastSuccessAt": None,
                "lastError": "JSONDecodeError",
            }
        ),
        encoding="utf-8",
    )
    fetch_calls = 0

    def fetch(_config: DtekConfig) -> dict[str, object]:
        nonlocal fetch_calls
        fetch_calls += 1
        return response_payload()

    monkeypatch.setattr("utility.expected_utility_month", lambda: "2026-06")
    monkeypatch.setattr("utility.fetch_history", fetch)

    payload = Dtek(slow_config(), path).get_values()
    state = json.loads(path.read_text(encoding="utf-8"))

    assert fetch_calls == 1
    assert payload == {"month": "2026-06", "import": {"day": 58, "night": 108}, "export": {"day": 2432, "night": 22}}
    assert state["failureCount"] == 0
    assert state["lastError"] is None


def test_success_resets_failure_state(tmp_path, monkeypatch) -> None:
    path = tmp_path / "state.json"
    path.write_text(
        json.dumps(
            {
                "checkedAt": 0,
                "payload": None,
                "failureCount": 2,
                "lastFailureAt": 1,
                "lastSuccessAt": None,
                "lastError": "blocked",
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr("utility.expected_utility_month", lambda: "2026-06")
    monkeypatch.setattr("utility.fetch_history", lambda _config: response_payload())

    dtek = Dtek(config(), path)
    payload = dtek.get_values()
    state = json.loads(path.read_text(encoding="utf-8"))

    assert payload == {"month": "2026-06", "import": {"day": 58, "night": 108}, "export": {"day": 2432, "night": 22}}
    assert dtek.recovered_from_failure is True
    assert state["failureCount"] == 0
    assert state["lastFailureAt"] is None
    assert state["lastError"] is None
    assert isinstance(state["lastSuccessAt"], float)


def test_stale_success_keeps_cached_payload_without_failure_state(tmp_path, monkeypatch) -> None:
    cached_payload = {"month": "2026-05", "import": {"day": 1, "night": 2}, "export": {"day": 3, "night": 4}}
    path = tmp_path / "state.json"
    path.write_text(
        json.dumps(
            {
                "checkedAt": 0,
                "payload": cached_payload,
                "failureCount": 2,
                "lastFailureAt": 1,
                "lastSuccessAt": None,
                "lastError": "blocked",
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr("utility.expected_utility_month", lambda: "2026-06")
    monkeypatch.setattr("utility.fetch_history", lambda _config: stale_payload())
    dtek = Dtek(config(), path)

    with pytest.raises(UtilityMeterStaleError) as error:
        dtek.get_values()

    state = json.loads(path.read_text(encoding="utf-8"))

    assert "Utility response stale" in error.value.message
    assert dtek.recovered_from_failure is True
    assert state["failureCount"] == 0
    assert state["payload"] == cached_payload
    assert state["lastFailureAt"] is None
    assert state["lastError"] is None
    assert isinstance(state["lastSuccessAt"], float)
