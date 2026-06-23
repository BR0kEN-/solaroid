from os import environ
from typing import Any, Callable, TypeAlias

from requests import request, Response, utils as requests_utils

CallService: TypeAlias = Callable[[str, dict[str, Any]], None]


class HomeAssistantError(RuntimeError):
    pass


def _ha_request(method: str, path: str, json: dict | None = None) -> Response:
    response = request(
        method=method,
        url=f"http://supervisor/core/api{path}",
        headers={"Authorization": f"Bearer {environ.get('SUPERVISOR_TOKEN')}"},
        timeout=15,
        json=json,
    )

    response.raise_for_status()
    return response


def _parse_state(data: dict[str, Any]) -> float:
    raw = data.get("state")

    if raw in (None, "", "unknown", "unavailable"):
        raise ValueError(f"Value is '{raw}'")

    try:
        value = float(str(raw).replace(",", "."))
    except ValueError as error:
        raise ValueError(f"Value is not numeric: {raw}") from error

    if value != value or value in (float("inf"), float("-inf")):
        raise ValueError(f"Value is not finite: {raw}")

    return value


def get_entity_state(entity_id: str) -> float:
    try:
        return _parse_state(_ha_request("get", f"/states/{requests_utils.quote(entity_id, safe='')}").json())
    except Exception as error:
        raise HomeAssistantError(f"Failed to read {entity_id}") from error


def call_service(service: str, data: dict[str, Any]) -> None:
    try:
        domain, name = service.split(".", 1)
    except ValueError as error:
        raise HomeAssistantError(f"Invalid service: {service}") from error

    try:
        _ha_request("post",f"/services/{domain}/{name}", data)
    except Exception as error:
        raise HomeAssistantError(f"Failed to call {service}") from error
