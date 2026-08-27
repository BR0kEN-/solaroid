from types import SimpleNamespace

import pytest

from solaroid import ha
from solaroid.ha import get_instance_name, HomeAssistantError


def test_get_instance_name_reads_and_trims_location_name(monkeypatch: pytest.MonkeyPatch) -> None:
    response = SimpleNamespace(json=lambda: {"location_name": "  Bondas  "})
    monkeypatch.setattr(ha, "_ha_request", lambda method, path: response)

    assert get_instance_name() == "Bondas"


@pytest.mark.parametrize("location_name", [None, "", "   ", 42])
def test_get_instance_name_rejects_missing_or_invalid_name(
    monkeypatch: pytest.MonkeyPatch,
    location_name: object,
) -> None:
    response = SimpleNamespace(json=lambda: {"location_name": location_name})
    monkeypatch.setattr(ha, "_ha_request", lambda method, path: response)

    with pytest.raises(HomeAssistantError, match="Failed to read Home Assistant instance name"):
        get_instance_name()
