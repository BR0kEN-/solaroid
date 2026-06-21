import logging
import time
from typing import Any, Callable

from config import load_config, SolaroidConfig
from ha import call_service, get_entity_state, HomeAssistantError
from solaroid import build_payload, post_payload
from utility import Dtek, DtekFetchError


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

DTEK_FAILURE_NOTIFICATION_ID = "solaroid_dtek_fetch_failed"
DTEK_FAILURE_TITLE = "Solaroid: DTEK fetch failed"


def dtek_failure_message(error: DtekFetchError) -> str:
    last_success = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(error.last_success_at)) if error.last_success_at else "never"
    return (
        f"{error.message}\n"
        f"Failures: {error.failure_count}\n"
        f"Last successful DTEK fetch: {last_success}\n"
        "Update DTEK Incapsula cookies in the Solaroid add-on config."
    )


def notify_dtek_failure(
    error: DtekFetchError,
    config: SolaroidConfig,
    service_call: Callable[[str, dict[str, Any]], None] = call_service,
) -> None:
    message = dtek_failure_message(error)

    try:
        service_call(
            "persistent_notification.create",
            {
                "notification_id": DTEK_FAILURE_NOTIFICATION_ID,
                "title": DTEK_FAILURE_TITLE,
                "message": message,
            },
        )

        if error.failure_count == 1:
            for service in config.notifications.mobileServices:
                service_call(service, {"title": DTEK_FAILURE_TITLE, "message": message})
    except HomeAssistantError:
        logging.exception("DTEK failure notification failed")


def dismiss_dtek_failure_notification(service_call: Callable[[str, dict[str, Any]], None] = call_service) -> None:
    try:
        service_call("persistent_notification.dismiss", {"notification_id": DTEK_FAILURE_NOTIFICATION_ID})
    except HomeAssistantError:
        logging.warning("DTEK failure notification dismiss failed")


def run_once(
    dtek: Dtek,
    config: SolaroidConfig,
    read_state: Callable[[str], float] = get_entity_state,
    post: Callable[[str, str, dict[str, Any]], dict[str, Any]] = post_payload,
    service_call: Callable[[str, dict[str, Any]], None] = call_service,
) -> None:
    utility = None

    try:
        utility = dtek.get_values()
        if utility is not None and dtek.recovered_from_failure:
            dismiss_dtek_failure_notification(service_call)
    except DtekFetchError as error:
        logging.warning("Utility meter fetch failed; posting HA values only: %s", error.message)
        notify_dtek_failure(error, config, service_call)

    payload = build_payload(config.payload, read_state, utility)
    result = post(config.url, config.token, payload)
    logging.info("Posted payload: %s (%s)", result, payload)


def main() -> None:
    config = load_config()
    dtek = Dtek(config.dtek)
    sleep_seconds = config.intervalMinutes * 60

    while True:
        # noinspection PyBroadException
        try:
            run_once(dtek, config)
        except:
            logging.exception("Sync failed")

        time.sleep(sleep_seconds)


if __name__ == "__main__":
    main()
