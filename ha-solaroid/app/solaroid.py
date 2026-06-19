import json
import urllib.error
import urllib.request
from typing import Any, Callable


StateReader = Callable[[str], float]


def entity_value(mapping: Any, read_state: StateReader) -> Any:
    if isinstance(mapping, str):
        return read_state(mapping)
    if isinstance(mapping, list):
        return mapping
    if isinstance(mapping, dict):
        return {key: entity_value(value, read_state) for key, value in mapping.items()}
    return mapping


def build_payload(mapping: dict[str, Any], read_state: StateReader, utility: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = entity_value(mapping, read_state)
    if utility:
        payload.setdefault("thisMonth", {})["utility"] = utility
    return payload


def post_payload(url: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Solaroid POST failed: HTTP {error.code}: {body}") from error
    except (urllib.error.URLError, json.JSONDecodeError) as error:
        raise RuntimeError("Solaroid POST failed") from error
