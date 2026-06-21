import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from config import DtekConfig, NotificationsConfig, SolaroidConfig, load_config
from main import DTEK_FAILURE_NOTIFICATION_ID, daily_ingest_slots, next_ingest_slot, run_once
from utility import DtekFetchError


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
            phone="+380970000000",
            password="secret",
            accountId="120001234567",
            department="dnem",
            intervalMinutes=60,
            cookies={},
        ),
        notifications=NotificationsConfig(mobileServices=["notify.notify_admins", "notify.mobile_app_phone"]),
    )


class FakeDtek:
    def __init__(
        self,
        result: dict[str, object] | None = None,
        error: DtekFetchError | None = None,
        recovered_from_failure: bool = False,
    ) -> None:
        self._result = result
        self._error = error
        self.recovered_from_failure = recovered_from_failure

    def get_values(self) -> dict[str, object] | None:
        if self._error:
            raise self._error

        return self._result


class MainNotificationTest(unittest.TestCase):
    def test_first_failure_notifies_and_posts_without_utility(self) -> None:
        service_calls: list[tuple[str, dict[str, object]]] = []
        posts: list[dict[str, object]] = []

        def post(_url: str, _token: str, payload: dict[str, object]) -> dict[str, object]:
            posts.append(payload)
            return {"ok": True}

        run_once(
            FakeDtek(error=DtekFetchError("HTTPError: HTTP 403", 1, None)),  # type: ignore[arg-type]
            config(),
            read_state=lambda _entity_id: 10,
            post=post,
            service_call=lambda service, data: service_calls.append((service, data)),
        )

        self.assertEqual([service for service, _data in service_calls], [
            "persistent_notification.create",
            "notify.notify_admins",
            "notify.mobile_app_phone",
        ])
        self.assertEqual(service_calls[0][1]["notification_id"], DTEK_FAILURE_NOTIFICATION_ID)
        self.assertNotIn("utility", posts[0]["thisMonth"])  # type: ignore[operator]

    def test_repeated_failure_updates_persistent_notification_only(self) -> None:
        service_calls: list[tuple[str, dict[str, object]]] = []

        run_once(
            FakeDtek(error=DtekFetchError("HTTPError: HTTP 403", 2, 100)),  # type: ignore[arg-type]
            config(),
            read_state=lambda _entity_id: 10,
            post=lambda _url, _token, _payload: {"ok": True},
            service_call=lambda service, data: service_calls.append((service, data)),
        )

        self.assertEqual([service for service, _data in service_calls], ["persistent_notification.create"])

    def test_success_dismisses_persistent_notification(self) -> None:
        service_calls: list[tuple[str, dict[str, object]]] = []

        run_once(
            FakeDtek(
                result={"month": "2026-07", "import": {"day": 1, "night": 2}, "export": {"day": 3, "night": 4}},
                recovered_from_failure=True,
            ),  # type: ignore[arg-type]
            config(),
            read_state=lambda _entity_id: 10,
            post=lambda _url, _token, _payload: {"ok": True},
            service_call=lambda service, data: service_calls.append((service, data)),
        )

        self.assertEqual(service_calls, [("persistent_notification.dismiss", {"notification_id": DTEK_FAILURE_NOTIFICATION_ID})])

    def test_cached_success_does_not_dismiss_persistent_notification(self) -> None:
        service_calls: list[tuple[str, dict[str, object]]] = []

        run_once(
            FakeDtek(result={"month": "2026-07", "import": {"day": 1, "night": 2}, "export": {"day": 3, "night": 4}}),  # type: ignore[arg-type]
            config(),
            read_state=lambda _entity_id: 10,
            post=lambda _url, _token, _payload: {"ok": True},
            service_call=lambda service, data: service_calls.append((service, data)),
        )

        self.assertEqual(service_calls, [])


class IngestScheduleTest(unittest.TestCase):
    def test_daily_slots_include_final_pre_midnight_shot(self) -> None:
        slots = daily_ingest_slots(datetime(2026, 6, 21, 12, 0, 0))

        self.assertEqual(len(slots), 72)
        self.assertEqual(slots[-1], datetime(2026, 6, 21, 23, 59, 50))

    def test_next_slot_after_233950_is_235950(self) -> None:
        self.assertEqual(
            next_ingest_slot(datetime(2026, 6, 21, 23, 39, 51)),
            datetime(2026, 6, 21, 23, 59, 50),
        )

    def test_next_slot_after_final_shot_is_next_day_001950(self) -> None:
        self.assertEqual(
            next_ingest_slot(datetime(2026, 6, 21, 23, 59, 51)),
            datetime(2026, 6, 22, 0, 19, 50),
        )


class ConfigTest(unittest.TestCase):
    def test_loads_without_top_level_interval_minutes(self) -> None:
        options = {
            "api": "https://example.supabase.co",
            "token": "token",
            "dtek": {
                "phone": "+380970000000",
                "password": "secret",
                "accountId": "120001234567",
                "department": "dnem",
                "intervalMinutes": 60,
                "cookies": [],
            },
            "notifications": {"mobileServices": ["notify.notify_admins"]},
            "payload": {"thisMonth": {"production": "sensor.production"}},
        }

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "options.json"
            path.write_text(json.dumps(options), encoding="utf-8")

            loaded = load_config(path)

        self.assertEqual(loaded.api, "https://example.supabase.co")
        self.assertFalse(hasattr(loaded, "intervalMinutes"))
        self.assertEqual(loaded.dtek.intervalMinutes, 60)


if __name__ == "__main__":
    unittest.main()
