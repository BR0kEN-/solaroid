import json
import tempfile
import unittest
import base64
from datetime import date
from pathlib import Path
from unittest.mock import patch

from _test_requests import install_requests_stub

install_requests_stub()

from config import DtekConfig
from utility import Dtek, UtilityMeterFetchError, UtilityMeterStaleError, expected_utility_month, fetch_history, utility_payload


def response_payload() -> dict[str, object]:
    return {
        "diff": {
            "import": {"day": 50, "night": 60},
            "export": {"day": 30, "night": 10},
        },
        "samples": {
            "2026-07": {
                "import": {"day": 150, "night": 260},
                "export": {"day": 330, "night": 410},
            },
            "2026-06": {
                "import": {"day": 100, "night": 200},
                "export": {"day": 300, "night": 400},
            },
        },
    }


def config() -> DtekConfig:
    return DtekConfig(
        endpoint="https://n8n.example.test",
        phone="+380971234567",
        password="secret",
        accountId="nest",
        department="dnem",
        intervalMinutes=0,
    )


class UtilityPayloadTest(unittest.TestCase):
    def test_uses_previous_reading_month_for_delta(self) -> None:
        payload = utility_payload(response_payload())

        self.assertEqual(payload["month"], "2026-07")
        self.assertEqual(payload["import"], {"day": 50, "night": 60})
        self.assertEqual(payload["export"], {"day": 30, "night": 10})

    def test_rejects_stale_payload_when_expected_month_missing(self) -> None:
        stale = response_payload()
        stale["samples"] = {
            "2026-05": {
                "import": {"day": 100, "night": 200},
                "export": {"day": 300, "night": 400},
            }
        }

        with self.assertRaisesRegex(ValueError, "latest 2026-05, expected 2026-06"):
            utility_payload(stale, "2026-06")

    def test_expected_utility_month_covers_start_grace_only(self) -> None:
        self.assertIsNone(expected_utility_month(date(2026, 6, 30)))
        self.assertEqual(expected_utility_month(date(2026, 7, 1)), "2026-06")
        self.assertEqual(expected_utility_month(date(2026, 7, 3)), "2026-06")
        self.assertIsNone(expected_utility_month(date(2026, 7, 4)))

    def test_fetch_history_calls_n8n_webhook_with_three_part_basic_auth(self) -> None:
        class Response:
            def raise_for_status(self) -> None:
                pass

            def json(self) -> dict[str, object]:
                return response_payload()

        with patch("utility.requests.get", return_value=Response()) as get:
            payload = fetch_history(config())

        token = base64.b64encode(b"nest:+380971234567:secret").decode("ascii")
        get.assert_called_once_with(
            "https://n8n.example.test/webhook/um?department=dnem",
            headers={
                "Authorization": f"Basic {token}",
                "Accept": "application/json",
            },
            timeout=45,
        )
        self.assertEqual(payload, response_payload())

    def test_fetch_history_adds_department_query_to_base_url(self) -> None:
        class Response:
            def raise_for_status(self) -> None:
                pass

            def json(self) -> dict[str, object]:
                return response_payload()

        trailing_slash_config = DtekConfig(
            endpoint="https://n8n.example.test/",
            phone="+380971234567",
            password="secret",
            accountId="nest",
            department="dnem",
            intervalMinutes=0,
        )

        with patch("utility.requests.get", return_value=Response()) as get:
            fetch_history(trailing_slash_config)

        self.assertEqual(get.call_args.args[0], "https://n8n.example.test/webhook/um?department=dnem")

    def test_failed_fetch_updates_failure_state_without_clearing_cached_payload(self) -> None:
        cached_payload = {"month": "2026-07", "import": {"day": 1, "night": 2}, "export": {"day": 3, "night": 4}}

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            path.write_text(json.dumps({"checkedAt": 0, "payload": cached_payload}), encoding="utf-8")

            with (
                patch("utility.expected_utility_month", return_value=None),
                patch("utility.fetch_history", side_effect=RuntimeError("blocked secret")),
            ):
                with self.assertRaises(UtilityMeterFetchError) as first:
                    Dtek(config(), path).get_values()
                with self.assertRaises(UtilityMeterFetchError) as second:
                    Dtek(config(), path).get_values()

            state = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual(first.exception.failure_count, 1)
        self.assertEqual(second.exception.failure_count, 2)
        self.assertEqual(state["failureCount"], 2)
        self.assertEqual(state["payload"], cached_payload)
        self.assertNotIn("secret", state["lastError"])

    def test_success_resets_failure_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
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

            with (
                patch("utility.expected_utility_month", return_value="2026-07"),
                patch("utility.fetch_history", return_value=response_payload()),
            ):
                dtek = Dtek(config(), path)
                payload = dtek.get_values()

            state = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual(payload, {"month": "2026-07", "import": {"day": 50, "night": 60}, "export": {"day": 30, "night": 10}})
        self.assertTrue(dtek.recovered_from_failure)
        self.assertEqual(state["failureCount"], 0)
        self.assertIsNone(state["lastFailureAt"])
        self.assertIsNone(state["lastError"])
        self.assertIsInstance(state["lastSuccessAt"], float)

    def test_stale_success_keeps_cached_payload_without_failure_state(self) -> None:
        stale = response_payload()
        stale["samples"] = {
            "2026-05": {
                "import": {"day": 100, "night": 200},
                "export": {"day": 300, "night": 400},
            }
        }
        cached_payload = {"month": "2026-05", "import": {"day": 1, "night": 2}, "export": {"day": 3, "night": 4}}

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
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

            with (
                patch("utility.expected_utility_month", return_value="2026-06"),
                patch("utility.fetch_history", return_value=stale),
            ):
                dtek = Dtek(config(), path)
                with self.assertRaises(UtilityMeterStaleError) as error:
                    dtek.get_values()

            state = json.loads(path.read_text(encoding="utf-8"))

        self.assertIn("Utility response stale", error.exception.message)
        self.assertTrue(dtek.recovered_from_failure)
        self.assertEqual(state["failureCount"], 0)
        self.assertEqual(state["payload"], cached_payload)
        self.assertIsNone(state["lastFailureAt"])
        self.assertIsNone(state["lastError"])
        self.assertIsInstance(state["lastSuccessAt"], float)


if __name__ == "__main__":
    unittest.main()
