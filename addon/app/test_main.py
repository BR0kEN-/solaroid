import unittest

from config import DtekConfig, NotificationsConfig, SolaroidConfig
from main import DTEK_FAILURE_NOTIFICATION_ID, run_once
from utility import DtekFetchError


def config() -> SolaroidConfig:
    return SolaroidConfig(
        api="https://example.supabase.co",
        token="token",
        intervalMinutes=20,
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


if __name__ == "__main__":
    unittest.main()
