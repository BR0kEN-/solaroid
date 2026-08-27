import pytest
import requests

from solaroid import solaroid
from solaroid.solaroid import build_payload, post_payload


def response(status: int, body: str) -> requests.Response:
    result = requests.Response()
    result.status_code = status
    result._content = body.encode()
    return result


def post_sequence(
    monkeypatch: pytest.MonkeyPatch,
    results: list[requests.Response | Exception],
) -> tuple[list[dict[str, object]], list[float]]:
    calls: list[dict[str, object]] = []
    sleeps: list[float] = []

    def post(url: str, **kwargs: object) -> requests.Response:
        calls.append({"url": url, **kwargs})
        result = results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(solaroid.requests, "post", post)
    monkeypatch.setattr(solaroid.random, "uniform", lambda _minimum, _maximum: 1.0)
    monkeypatch.setattr(solaroid.time, "sleep", sleeps.append)
    return calls, sleeps


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


def test_post_payload_succeeds_without_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    calls, sleeps = post_sequence(monkeypatch, [response(200, '{"ok":true}')])
    payload = {"value": 1}

    result = post_payload("https://example.test", "token", payload)

    assert result == {"ok": True}
    assert len(calls) == 1
    assert calls[0]["json"] is payload
    assert sleeps == []


def test_post_payload_retries_503_with_same_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    calls, sleeps = post_sequence(
        monkeypatch,
        [response(503, '{"ok":false}'), response(200, '{"ok":true}')],
    )
    payload = {"value": 1}

    result = post_payload("https://example.test", "token", payload)

    assert result == {"ok": True}
    assert len(calls) == 2
    assert all(call["json"] is payload for call in calls)
    assert sleeps == [20]


def test_post_payload_retries_transport_and_server_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    calls, sleeps = post_sequence(
        monkeypatch,
        [requests.ConnectionError("offline"), response(500, "failed"), response(200, '{"ok":true}')],
    )

    result = post_payload("https://example.test", "token", {"value": 1})

    assert result == {"ok": True}
    assert len(calls) == 3
    assert sleeps == [20, 70]


def test_post_payload_raises_after_retry_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    calls, sleeps = post_sequence(
        monkeypatch,
        [response(503, "temporary") for _index in range(3)],
    )

    with pytest.raises(RuntimeError, match=r"HTTP 503: temporary"):
        post_payload("https://example.test", "token", {"value": 1})

    assert len(calls) == 3
    assert sleeps == [20, 70]


def test_post_payload_does_not_retry_regular_4xx(monkeypatch: pytest.MonkeyPatch) -> None:
    calls, sleeps = post_sequence(monkeypatch, [response(400, "invalid")])

    with pytest.raises(RuntimeError, match=r"HTTP 400: invalid"):
        post_payload("https://example.test", "token", {"value": 1})

    assert len(calls) == 1
    assert sleeps == []
