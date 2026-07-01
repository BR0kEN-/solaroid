from typing import Any, Callable

import requests


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
    normalize_taxes_payload(payload)
    if utility:
        payload.setdefault("thisMonth", {})["utility"] = utility
    return payload


def normalize_taxes_payload(payload: dict[str, Any]) -> None:
    this_month = payload.get("thisMonth")
    if not isinstance(this_month, dict):
        return

    monetary = this_month.get("monetary")
    if not isinstance(monetary, dict):
        return
    export = monetary.get("export")
    if not isinstance(export, dict):
        return

    export["taxes"] = normalize_taxes(export.get("taxes"))


def normalize_taxes(taxes: Any) -> list[list[Any]]:
    if not isinstance(taxes, list):
        return []
    normalized: list[list[Any]] = []
    for tax in taxes:
        if isinstance(tax, list) and len(tax) == 2:
            normalized.append(tax)
        elif isinstance(tax, dict) and "type" in tax and "value" in tax:
            normalized.append([tax["type"], tax["value"]])
    return normalized


def post_payload(url: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    try:
        response = requests.post(
            url,
            json=payload,
            headers=headers,
            timeout=30,
        )
        response.raise_for_status()
        return response.json()
    except requests.HTTPError as error:
        body = error.response.text if error.response is not None else ""
        status_code = error.response.status_code if error.response is not None else "unknown"
        raise RuntimeError(f"Solaroid POST failed: HTTP {status_code}: {body}") from error
    except (requests.RequestException, ValueError) as error:
        raise RuntimeError("Solaroid POST failed") from error
