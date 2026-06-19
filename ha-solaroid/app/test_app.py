import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from config import load_config
from ha import HomeAssistantError, parse_state
from solaroid import build_payload, post_payload
from utility import get_utility_values, should_check, utility_payload


class AddonTest(unittest.TestCase):
    def test_config_parse(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "options.json"
            path.write_text(
                json.dumps(
                    {
                        "solaroid": {
                            "api": "https://example.supabase.co",
                            "token": "secret",
                            "payload": {"today": {"production": "sensor.production"}},
                        }
                    }
                ),
                encoding="utf-8",
            )

            config = load_config(path)

        self.assertEqual(config.interval_minutes, 20)
        self.assertEqual(config.utility.interval_minutes, 60)
        self.assertEqual(config.url, "https://example.supabase.co/functions/v1/ingest")
        self.assertEqual(config.utility.url, "https://ok.dtek-dnem.com.ua/api")

    def test_parse_state(self) -> None:
        self.assertEqual(parse_state("sensor.test", {"state": "12.5"}), 12.5)
        with self.assertRaises(HomeAssistantError):
            parse_state("sensor.test", {"state": "unavailable"})

    def test_build_payload_with_utility(self) -> None:
        mapping = {
            "today": {
                "production": "sensor.today",
            },
            "thisMonth": {
                "production": "sensor.month",
            },
        }
        states = {
            "sensor.today": 1,
            "sensor.month": 2,
        }

        payload = build_payload(
            mapping,
            lambda entity_id: states[entity_id],
            {
                "import": {"day": 3, "night": 4},
                "export": {"day": 5, "night": 6},
            },
        )

        self.assertEqual(payload["today"]["production"], 1)
        self.assertEqual(payload["thisMonth"]["utility"]["export"]["night"], 6)

    def test_build_payload_without_utility(self) -> None:
        payload = build_payload(
            {"thisMonth": {"production": "sensor.month"}},
            lambda entity_id: {"sensor.month": 2}[entity_id],
        )

        self.assertNotIn("utility", payload["thisMonth"])

    def test_post_payload(self) -> None:
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=None)
        response.read = Mock(return_value=b'{"ok":true}')

        with patch("urllib.request.urlopen", return_value=response) as urlopen:
            result = post_payload("https://example.test/functions/v1/ingest", "TOKEN", {"today": {"production": 1}})

        self.assertEqual(result, {"ok": True})
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://example.test/functions/v1/ingest")
        self.assertEqual(request.headers["Authorization"], "Bearer TOKEN")
        self.assertEqual(request.get_method(), "POST")

    def test_cached_utility_not_used_outside_window(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            path.write_text(json.dumps({"checkedAt": 1, "payload": {"import": {"day": 1}}}), encoding="utf-8")
            config = load_config(
                write_options(
                    Path(directory),
                    utility={"enabled": True},
                )
            ).utility

            with patch("utility.should_check", return_value=False):
                self.assertIsNone(get_utility_values(config, path))

    def test_utility_parser(self) -> None:
        payload = {
            "data": {
                "items": [
                    {"date": "01.05.2026", "energyCode": "01", "scale": "04", "value": "10"},
                    {"date": "01.05.2026", "energyCode": "01", "scale": "05", "value": "20"},
                    {"date": "01.05.2026", "energyCode": "03", "scale": "04", "value": "30"},
                    {"date": "01.05.2026", "energyCode": "03", "scale": "05", "value": "40"},
                    {"date": "01.06.2026", "energyCode": "01", "scale": "04", "value": "15"},
                    {"date": "01.06.2026", "energyCode": "01", "scale": "05", "value": "28"},
                    {"date": "01.06.2026", "energyCode": "03", "scale": "04", "value": "44"},
                    {"date": "01.06.2026", "energyCode": "03", "scale": "05", "value": "55"},
                ]
            }
        }

        self.assertEqual(
            utility_payload(payload),
            {
                "import": {"day": 5.0, "night": 8.0},
                "export": {"day": 14.0, "night": 15.0},
            },
        )

    def test_check_window(self) -> None:
        from datetime import date

        self.assertTrue(should_check(date(2026, 6, 1)))
        self.assertTrue(should_check(date(2026, 6, 29)))
        self.assertFalse(should_check(date(2026, 6, 10)))

def write_options(directory: Path, utility: dict[str, object] | None = None) -> Path:
    path = directory / "options.json"
    payload = {
        "solaroid": {
            "api": "https://example.supabase.co",
            "token": "secret",
            "utility": utility or {},
            "payload": {"today": {"production": "sensor.production"}},
        }
    }
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


if __name__ == "__main__":
    unittest.main()
