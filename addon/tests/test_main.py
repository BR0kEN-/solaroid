import json
from datetime import datetime

import pytest
import requests

from solaroid import solaroid as solaroid_client
from solaroid.config import DtekConfig, NotificationsConfig, SolaroidConfig, load_config
from solaroid.main import (
    UTILITY_METER_FAILURE_NOTIFICATION_ID,
    daily_ingest_slots,
    next_ingest_slot,
    run_once,
    run_with_ingest_failure_notification,
)
from solaroid.solaroid import post_payload
from solaroid.utility import UtilityMeterFetchError, UtilityMeterStaleError, UtilityMeter

INSTANCE_NAME = "Bondas"


def config() -> SolaroidConfig:
    return SolaroidConfig(
        api="https://example.supabase.co",
        token="token",
        payload={
            "thisMonth": {
                "production": "sensor.production",
            },
        },
        dtek=DtekConfig(
            endpoint="https://example.test",
            phone="+380970000000",
            password="secret",
            intervalMinutes=60,
        ),
        notifications=NotificationsConfig(mobileServices=("notify.notify_admins", "notify.mobile_app_phone")),
    )


class FakeDtek(UtilityMeter):
    def __init__(
        self,
        result: dict[str, object] | None = None,
        error: Exception | None = None,
        recovered_from_failure: bool = False,
    ) -> None:
        super().__init__()
        self._result = result
        self._error = error
        self._recovered_from_failure = recovered_from_failure

    def get_values(self) -> dict[str, object] | None:
        if self._error:
            raise self._error

        return self._result


def test_first_failure_notifies_and_posts_without_utility() -> None:
    service_calls: list[tuple[str, dict[str, object]]] = []
    posts: list[dict[str, object]] = []

    def post(_url: str, _token: str, payload: dict[str, object]) -> dict[str, object]:
        posts.append(payload)
        return {"ok": True}

    run_once(
        FakeDtek(error=UtilityMeterFetchError("HTTPError: HTTP 403", 1, None)),
        config(),
        read_state=lambda _entity_id: 10,
        post=post,
        service_call=lambda service, data: service_calls.append((service, data)),
        instance_name=INSTANCE_NAME,
    )

    assert [service for service, _data in service_calls] == [
        "persistent_notification.create",
        "notify.notify_admins",
        "notify.mobile_app_phone",
    ]
    assert service_calls[0][1]["notification_id"] == UTILITY_METER_FAILURE_NOTIFICATION_ID
    assert service_calls[0][1]["title"] == "Solaroid (Bondas): Utility Meter fetch failed"
    assert "utility" not in posts[0]["thisMonth"]  # type: ignore[operator]


def test_repeated_failure_updates_persistent_notification_only() -> None:
    service_calls: list[tuple[str, dict[str, object]]] = []

    run_once(
        FakeDtek(error=UtilityMeterFetchError("HTTPError: HTTP 403", 2, 100)),
        config(),
        read_state=lambda _entity_id: 10,
        post=lambda _url, _token, _payload: {"ok": True},
        service_call=lambda service, data: service_calls.append((service, data)),
        instance_name=INSTANCE_NAME,
    )

    assert [service for service, _data in service_calls] == ["persistent_notification.create"]


def test_stale_utility_data_posts_without_utility_and_does_not_notify() -> None:
    service_calls: list[tuple[str, dict[str, object]]] = []
    posts: list[dict[str, object]] = []

    def post(_url: str, _token: str, payload: dict[str, object]) -> dict[str, object]:
        posts.append(payload)
        return {"ok": True}

    run_once(
        FakeDtek(error=UtilityMeterStaleError("Utility response stale: latest 2026-05, expected 2026-06")),
        config(),
        read_state=lambda _entity_id: 10,
        post=post,
        service_call=lambda service, data: service_calls.append((service, data)),
        instance_name=INSTANCE_NAME,
    )

    assert service_calls == []
    assert "utility" not in posts[0]["thisMonth"]  # type: ignore[operator]


def test_stale_utility_data_after_failure_dismisses_persistent_notification() -> None:
    service_calls: list[tuple[str, dict[str, object]]] = []

    run_once(
        FakeDtek(
            error=UtilityMeterStaleError("Utility response stale: latest 2026-05, expected 2026-06"),
            recovered_from_failure=True,
        ),
        config(),
        read_state=lambda _entity_id: 10,
        post=lambda _url, _token, _payload: {"ok": True},
        service_call=lambda service, data: service_calls.append((service, data)),
        instance_name=INSTANCE_NAME,
    )

    assert service_calls == [("persistent_notification.dismiss", {"notification_id": UTILITY_METER_FAILURE_NOTIFICATION_ID})]


def test_success_dismisses_persistent_notification() -> None:
    service_calls: list[tuple[str, dict[str, object]]] = []

    run_once(
        FakeDtek(
            result={"month": "2026-07", "import": {"day": 1, "night": 2}, "export": {"day": 3, "night": 4}},
            recovered_from_failure=True,
        ),
        config(),
        read_state=lambda _entity_id: 10,
        post=lambda _url, _token, _payload: {"ok": True},
        service_call=lambda service, data: service_calls.append((service, data)),
        instance_name=INSTANCE_NAME,
    )

    assert service_calls == [("persistent_notification.dismiss", {"notification_id": UTILITY_METER_FAILURE_NOTIFICATION_ID})]


def test_ingest_failure_notifies_and_returns_false() -> None:
    service_calls: list[tuple[str, dict[str, object]]] = []

    result = run_with_ingest_failure_notification(
        FakeDtek(),
        config(),
        read_state=lambda _entity_id: 10,
        post=lambda _url, _token, _payload: (_ for _ in ()).throw(RuntimeError("backend down")),
        service_call=lambda service, data: service_calls.append((service, data)),
        instance_name=INSTANCE_NAME,
    )

    assert result is False
    assert [service for service, _data in service_calls] == [
        "notify.notify_admins",
        "notify.mobile_app_phone",
    ]
    assert service_calls[0][1]["title"] == "Solaroid (Bondas): Ingest failed"


def test_ingest_success_does_not_notify() -> None:
    service_calls: list[tuple[str, dict[str, object]]] = []

    result = run_with_ingest_failure_notification(
        FakeDtek(),
        config(),
        read_state=lambda _entity_id: 10,
        post=lambda _url, _token, _payload: {"ok": True},
        service_call=lambda service, data: service_calls.append((service, data)),
        instance_name=INSTANCE_NAME,
    )

    assert result is True
    assert service_calls == []


def test_recovered_post_retry_does_not_notify(monkeypatch: pytest.MonkeyPatch) -> None:
    service_calls: list[tuple[str, dict[str, object]]] = []
    responses = [requests.Response(), requests.Response()]
    responses[0].status_code = 503
    responses[0]._content = b'{"ok":false}'
    responses[1].status_code = 200
    responses[1]._content = b'{"ok":true}'
    post_calls = 0
    sleeps: list[float] = []

    def request_post(*_args: object, **_kwargs: object) -> requests.Response:
        nonlocal post_calls
        response = responses[post_calls]
        post_calls += 1
        return response

    monkeypatch.setattr(solaroid_client.requests, "post", request_post)
    monkeypatch.setattr(solaroid_client.random, "uniform", lambda _minimum, _maximum: 1.0)
    monkeypatch.setattr(solaroid_client.time, "sleep", sleeps.append)

    result = run_with_ingest_failure_notification(
        FakeDtek(),
        config(),
        read_state=lambda _entity_id: 10,
        post=post_payload,
        service_call=lambda service, data: service_calls.append((service, data)),
        instance_name=INSTANCE_NAME,
    )

    assert result is True
    assert post_calls == 2
    assert sleeps == [20]
    assert service_calls == []


def test_exhausted_post_retries_notify_once(monkeypatch: pytest.MonkeyPatch) -> None:
    service_calls: list[tuple[str, dict[str, object]]] = []
    post_calls = 0
    sleeps: list[float] = []

    def request_post(*_args: object, **_kwargs: object) -> requests.Response:
        nonlocal post_calls
        post_calls += 1
        response = requests.Response()
        response.status_code = 503
        response._content = b'{"ok":false}'
        return response

    monkeypatch.setattr(solaroid_client.requests, "post", request_post)
    monkeypatch.setattr(solaroid_client.random, "uniform", lambda _minimum, _maximum: 1.0)
    monkeypatch.setattr(solaroid_client.time, "sleep", sleeps.append)

    result = run_with_ingest_failure_notification(
        FakeDtek(),
        config(),
        read_state=lambda _entity_id: 10,
        post=post_payload,
        service_call=lambda service, data: service_calls.append((service, data)),
        instance_name=INSTANCE_NAME,
    )

    assert result is False
    assert post_calls == 3
    assert sleeps == [20, 70]
    assert [service for service, _data in service_calls] == [
        "notify.notify_admins",
        "notify.mobile_app_phone",
    ]


def test_cached_success_does_not_dismiss_persistent_notification() -> None:
    service_calls: list[tuple[str, dict[str, object]]] = []

    run_once(
        FakeDtek(result={"month": "2026-07", "import": {"day": 1, "night": 2}, "export": {"day": 3, "night": 4}}),
        config(),
        read_state=lambda _entity_id: 10,
        post=lambda _url, _token, _payload: {"ok": True},
        service_call=lambda service, data: service_calls.append((service, data)),
        instance_name=INSTANCE_NAME,
    )

    assert service_calls == []


def test_disabled_utility_meter_dismisses_persistent_notification() -> None:
    service_calls: list[tuple[str, dict[str, object]]] = []

    run_once(
        FakeDtek(recovered_from_failure=True),
        config(),
        read_state=lambda _entity_id: 10,
        post=lambda _url, _token, _payload: {"ok": True},
        service_call=lambda service, data: service_calls.append((service, data)),
        instance_name=INSTANCE_NAME,
    )

    assert service_calls == [("persistent_notification.dismiss", {"notification_id": UTILITY_METER_FAILURE_NOTIFICATION_ID})]


def test_daily_slots_include_final_pre_midnight_shot() -> None:
    slots = daily_ingest_slots(datetime(2026, 6, 21, 12, 0, 0))

    assert len(slots) == 72
    assert slots[-1] == datetime(2026, 6, 21, 23, 59, 50)


def test_next_slot_after_233950_is_235950() -> None:
    assert next_ingest_slot(datetime(2026, 6, 21, 23, 39, 51)) == datetime(2026, 6, 21, 23, 59, 50)


def test_next_slot_after_final_shot_is_next_day_001950() -> None:
    assert next_ingest_slot(datetime(2026, 6, 21, 23, 59, 51)) == datetime(2026, 6, 22, 0, 19, 50)


def test_loads_without_top_level_interval_minutes(tmp_path) -> None:
    options = {
        "api": "https://example.supabase.co",
        "token": "token",
        "dtek": {
            "accountId": "old",
            "cookies": {"old": "cookie"},
            "department": "dnem",
            "endpoint": "https://example.test",
            "phone": "+380970000000",
            "password": "secret",
            "intervalMinutes": 60,
        },
        "notifications": {"mobileServices": ["notify.notify_admins"]},
        "payload": {"thisMonth": {"production": "sensor.production"}},
    }
    path = tmp_path / "options.json"
    path.write_text(json.dumps(options), encoding="utf-8")

    loaded = load_config(path)

    assert loaded.api == "https://example.supabase.co"
    assert not hasattr(loaded, "intervalMinutes")
    assert loaded.dtek.intervalMinutes == 60
