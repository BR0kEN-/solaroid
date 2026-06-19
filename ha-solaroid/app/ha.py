import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


HA_API_URL = "http://supervisor/core/api"


class HomeAssistantError(RuntimeError):
    pass


class HomeAssistantClient:
    def __init__(self, token: str | None = None, base_url: str = HA_API_URL) -> None:
        self.token = token or os.environ.get("SUPERVISOR_TOKEN", "")
        self.base_url = base_url.rstrip("/")
        if not self.token:
            raise HomeAssistantError("SUPERVISOR_TOKEN is not available")

    def state(self, entity_id: str) -> float:
        encoded = urllib.parse.quote(entity_id, safe="")
        request = urllib.request.Request(
            f"{self.base_url}/states/{encoded}",
            headers={"Authorization": f"Bearer {self.token}"},
        )

        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                data = json.load(response)
        except (urllib.error.URLError, json.JSONDecodeError) as error:
            raise HomeAssistantError(f"Failed to read {entity_id}") from error

        return parse_state(entity_id, data)


def parse_state(entity_id: str, data: dict[str, Any]) -> float:
    raw = data.get("state")
    if raw in (None, "", "unknown", "unavailable"):
        raise HomeAssistantError(f"{entity_id} is {raw or 'empty'}")

    try:
        value = float(str(raw).replace(",", "."))
    except ValueError as error:
        raise HomeAssistantError(f"{entity_id} is not numeric: {raw}") from error

    if value != value or value in (float("inf"), float("-inf")):
        raise HomeAssistantError(f"{entity_id} is not finite: {raw}")

    return value
