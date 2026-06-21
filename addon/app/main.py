import logging
import time
from datetime import datetime, time as datetime_time, timedelta
from typing import Any, Callable

from config import load_config, SolaroidConfig
from ha import call_service, get_entity_state, HomeAssistantError
from solaroid import build_payload, post_payload
from utility import Dtek, DtekFetchError


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

DTEK_FAILURE_NOTIFICATION_ID = "solaroid_dtek_fetch_failed"
DTEK_FAILURE_TITLE = "Solaroid: DTEK fetch failed"
INGEST_INTERVAL_SECONDS = 20 * 60
INGEST_ANCHOR_HOUR = 23
INGEST_ANCHOR_MINUTE = 59
INGEST_ANCHOR_SECOND = 50
INGEST_SLOTS_PER_DAY = 24 * 60 * 60 // INGEST_INTERVAL_SECONDS


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


def ingest_anchor(day: datetime) -> datetime:
    return datetime.combine(
        day.date(),
        datetime_time(INGEST_ANCHOR_HOUR, INGEST_ANCHOR_MINUTE, INGEST_ANCHOR_SECOND),
    )


def daily_ingest_slots(day: datetime) -> list[datetime]:
    anchor = ingest_anchor(day)
    return [
        anchor - timedelta(seconds=INGEST_INTERVAL_SECONDS * index)
        for index in range(INGEST_SLOTS_PER_DAY - 1, -1, -1)
    ]


def next_ingest_slot(now: datetime) -> datetime:
    for slot in daily_ingest_slots(now):
        if slot >= now:
            return slot

    return daily_ingest_slots(now + timedelta(days=1))[0]


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

    while True:
        slot = next_ingest_slot(datetime.now())
        sleep_seconds = max(0, (slot - datetime.now()).total_seconds())
        logging.info("Next ingest shot planned at %s", slot.strftime("%Y-%m-%d %H:%M:%S"))
        time.sleep(sleep_seconds)
        shot_at = datetime.now()
        logging.info("Ingest shot at %s (drift %.3fs)", shot_at.strftime("%Y-%m-%d %H:%M:%S"), (shot_at - slot).total_seconds())

        # noinspection PyBroadException
        try:
            run_once(dtek, config)
        except:
            logging.exception("Sync failed")


if __name__ == "__main__":
    main()
