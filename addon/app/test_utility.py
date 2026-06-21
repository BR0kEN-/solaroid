import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from config import DtekConfig
from utility import Dtek, DtekFetchError, utility_payload


def item(date: str, energy_code: str, scale: str, value: float) -> dict[str, object]:
    return {
        "date": date,
        "energyCode": energy_code,
        "scale": scale,
        "value": value,
    }


class UtilityPayloadTest(unittest.TestCase):
    def test_uses_previous_reading_month_for_delta(self) -> None:
        payload = utility_payload(
            {
                "data": {
                    "items": [
                        item("01.06.2026", "01", "04", 100),
                        item("01.06.2026", "01", "05", 200),
                        item("01.06.2026", "03", "04", 300),
                        item("01.06.2026", "03", "05", 400),
                        item("01.07.2026", "01", "04", 150),
                        item("01.07.2026", "01", "05", 260),
                        item("01.07.2026", "03", "04", 330),
                        item("01.07.2026", "03", "05", 410),
                    ],
                },
            }
        )

        self.assertEqual(payload["month"], "2026-07")
        self.assertEqual(payload["import"], {"day": 50, "night": 60})
        self.assertEqual(payload["export"], {"day": 30, "night": 10})

    def test_failed_fetch_updates_failure_state_without_clearing_cached_payload(self) -> None:
        config = DtekConfig(
            phone="+380970000000",
            password="secret",
            accountId="120001234567",
            department="dnem",
            intervalMinutes=0,
            cookies={"incap": "cookie-secret"},
        )
        cached_payload = {"month": "2026-07", "import": {"day": 1, "night": 2}, "export": {"day": 3, "night": 4}}

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            path.write_text(json.dumps({"checkedAt": 0, "payload": cached_payload}), encoding="utf-8")

            with patch("utility.fetch_history", side_effect=RuntimeError("blocked secret cookie-secret")):
                with self.assertRaises(DtekFetchError) as first:
                    Dtek(config, path).get_values()
                with self.assertRaises(DtekFetchError) as second:
                    Dtek(config, path).get_values()

            state = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual(first.exception.failure_count, 1)
        self.assertEqual(second.exception.failure_count, 2)
        self.assertEqual(state["failureCount"], 2)
        self.assertEqual(state["payload"], cached_payload)
        self.assertNotIn("secret", state["lastError"])
        self.assertNotIn("cookie-secret", state["lastError"])

    def test_success_resets_failure_state(self) -> None:
        config = DtekConfig(
            phone="+380970000000",
            password="secret",
            accountId="120001234567",
            department="dnem",
            intervalMinutes=0,
            cookies={},
        )
        history = {
            "data": {
                "items": [
                    item("01.06.2026", "01", "04", 100),
                    item("01.06.2026", "01", "05", 200),
                    item("01.06.2026", "03", "04", 300),
                    item("01.06.2026", "03", "05", 400),
                    item("01.07.2026", "01", "04", 150),
                    item("01.07.2026", "01", "05", 260),
                    item("01.07.2026", "03", "04", 330),
                    item("01.07.2026", "03", "05", 410),
                ],
            },
        }

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

            with patch("utility.fetch_history", return_value=history):
                dtek = Dtek(config, path)
                payload = dtek.get_values()

            state = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual(payload, {"month": "2026-07", "import": {"day": 50, "night": 60}, "export": {"day": 30, "night": 10}})
        self.assertTrue(dtek.recovered_from_failure)
        self.assertEqual(state["failureCount"], 0)
        self.assertIsNone(state["lastFailureAt"])
        self.assertIsNone(state["lastError"])
        self.assertIsInstance(state["lastSuccessAt"], float)


if __name__ == "__main__":
    unittest.main()
