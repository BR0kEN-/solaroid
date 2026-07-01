from solaroid.solaroid import build_payload


def test_normalizes_taxes_only() -> None:
    payload = build_payload(
        {
            "today": {
                "production": "sensor.today_production",
                "export": {
                    "day": "sensor.today_export_day",
                    "night": "sensor.today_export_night",
                },
            },
            "thisMonth": {
                "production": "sensor.month_production",
                "export": {
                    "day": "sensor.month_export_day",
                    "night": "sensor.month_export_night",
                },
                "monetary": {
                    "export": {
                        "day": "input.export_day",
                        "night": "input.export_night",
                        "taxes": [
                            {"type": "vat", "value": 18},
                            {"type": "mil", "value": 5},
                        ],
                    },
                },
            },
        },
        lambda entity_id: {
            "sensor.today_production": 10,
            "sensor.today_export_day": 4,
            "sensor.today_export_night": 1,
            "sensor.month_production": 100,
            "sensor.month_export_day": 25,
            "sensor.month_export_night": 5,
            "input.export_day": 6,
            "input.export_night": 6,
        }[entity_id],
    )

    assert payload["today"]["export"] == {"day": 4, "night": 1}
    assert payload["thisMonth"]["export"] == {"day": 25, "night": 5}
    assert payload["thisMonth"]["monetary"]["export"]["day"] == 6
    assert payload["thisMonth"]["monetary"]["export"]["taxes"] == [["vat", 18], ["mil", 5]]
