import logging
import random
import time
from typing import Any, Callable

import requests


StateReader = Callable[[str], float]
POST_RETRY_DELAYS_SECONDS = (20, 70)
POST_RETRY_JITTER = (0.8, 1.2)
POST_RETRYABLE_STATUS_CODES = {408, 429}


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


def is_retryable_status(status_code: int) -> bool:
    return status_code in POST_RETRYABLE_STATUS_CODES or 500 <= status_code <= 599


def post_error(error: requests.HTTPError) -> RuntimeError:
    body = error.response.text if error.response is not None else ""
    status_code = error.response.status_code if error.response is not None else "unknown"
    return RuntimeError(f"Solaroid POST failed: HTTP {status_code}: {body}")


def post_payload(url: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    attempts = len(POST_RETRY_DELAYS_SECONDS) + 1

    for attempt in range(attempts):
        try:
            response = requests.post(
                url,
                json=payload,
                headers=headers,
                timeout=30,
            )
            response.raise_for_status()
            result = response.json()
            if attempt:
                logging.info("Solaroid POST recovered on attempt %d/%d", attempt + 1, attempts)
            return result
        except requests.HTTPError as error:
            status_code = error.response.status_code if error.response is not None else 0
            if attempt >= len(POST_RETRY_DELAYS_SECONDS) or not is_retryable_status(status_code):
                raise post_error(error) from error
            category = f"HTTP {status_code}"
        except (requests.ConnectionError, requests.Timeout) as error:
            if attempt >= len(POST_RETRY_DELAYS_SECONDS):
                raise RuntimeError("Solaroid POST failed") from error
            category = error.__class__.__name__
        except (requests.RequestException, ValueError) as error:
            raise RuntimeError("Solaroid POST failed") from error

        delay = POST_RETRY_DELAYS_SECONDS[attempt] * random.uniform(*POST_RETRY_JITTER)
        logging.warning(
            "Solaroid POST attempt %d/%d failed (%s); retrying in %.1fs",
            attempt + 1,
            attempts,
            category,
            delay,
        )
        time.sleep(delay)

    raise RuntimeError("Solaroid POST failed")
