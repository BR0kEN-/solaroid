import logging
import time
from datetime import datetime, time as datetime_time, timedelta
from typing import Any, Callable

from config import load_config, SolaroidConfig
from ha import call_service, get_entity_state, HomeAssistantError, CallService
from solaroid import build_payload, post_payload
from utility import Dtek, UtilityMeterFetchError, UtilityMeter


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

UTILITY_METER_FAILURE_NOTIFICATION_ID = "solaroid_utility_meter_fetch_failed"
DATETIME_FORMAT = "%Y-%m-%d %H:%M:%S"
INGEST_INTERVAL_SECONDS = 20 * 60
INGEST_ANCHOR_HOUR = 23
INGEST_ANCHOR_MINUTE = 59
INGEST_ANCHOR_SECOND = 50
INGEST_SLOTS_PER_DAY = 24 * 60 * 60 // INGEST_INTERVAL_SECONDS


def utility_meter_failure_message(error: UtilityMeterFetchError) -> dict[str, str]:
    last_success = time.strftime(DATETIME_FORMAT, time.localtime(error.last_success_at)) if error.last_success_at else "never"

    return {
        "title": "Solaroid: Utility Meter fetch failed",
        "message": (
            f"{error.message}\n"
            f"Failures: {error.failure_count}\n"
            f"Last successful utility meter fetch: {last_success}"
        ),
    }


def utility_meter_notify_failure(
    error: UtilityMeterFetchError,
    config: SolaroidConfig,
    service_call: CallService = call_service,
) -> None:
    message = utility_meter_failure_message(error)

    try:
        service_call(
            "persistent_notification.create",
            {
                **message,
                "notification_id": UTILITY_METER_FAILURE_NOTIFICATION_ID,
            },
        )

        if error.failure_count == 1:
            for service in config.notifications.mobileServices:
                service_call(service, message)
    except HomeAssistantError:
        logging.exception("Utility Meter: Failure notification failed")


def utility_meter_dismiss_failure_notification(service_call: CallService = call_service) -> None:
    try:
        service_call(
            "persistent_notification.dismiss",
            {
                "notification_id": UTILITY_METER_FAILURE_NOTIFICATION_ID,
            },
        )
    except HomeAssistantError:
        logging.warning("Utility Meter: Failure notification dismiss failed")


def ingest_failure_message(error: Exception) -> dict[str, str]:
    return {
        "title": "Solaroid: Ingest failed",
        "message": f"{error.__class__.__name__}: {error}",
    }


def notify_ingest_failure(
    error: Exception,
    config: SolaroidConfig,
    service_call: CallService = call_service,
) -> None:
    try:
        for service in config.notifications.mobileServices:
            service_call(service, ingest_failure_message(error))
    except HomeAssistantError:
        logging.exception("Ingest failure notification failed")


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
    um: UtilityMeter,
    config: SolaroidConfig,
    read_state: Callable[[str], float] = get_entity_state,
    post: Callable[[str, str, dict[str, Any]], dict[str, Any]] = post_payload,
    service_call: CallService = call_service,
) -> None:
    utility = None

    try:
        utility = um.get_values()

        if um.recovered_from_failure:
            utility_meter_dismiss_failure_notification(service_call)
    except UtilityMeterFetchError as error:
        logging.warning("Utility meter fetch failed; posting HA values only: %s", error.message)
        utility_meter_notify_failure(error, config, service_call)

    payload = build_payload(config.payload, read_state, utility)
    result = post(config.url, config.token, payload)
    logging.info("Posted payload: %s (%s)", result, payload)


def run_with_ingest_failure_notification(
    um: UtilityMeter,
    config: SolaroidConfig,
    read_state: Callable[[str], float] = get_entity_state,
    post: Callable[[str, str, dict[str, Any]], dict[str, Any]] = post_payload,
    service_call: CallService = call_service,
) -> bool:
    try:
        run_once(um, config, read_state, post, service_call)
        return True
    except Exception as error:
        logging.exception("Sync failed")
        notify_ingest_failure(error, config, service_call)
        return False


def main() -> None:
    config = load_config()
    um = Dtek(config.dtek)
    slot = datetime.now()

    while True:
        shot_at = datetime.now()
        logging.info("Ingest shot at %s (drift %.3fs)", shot_at.strftime(DATETIME_FORMAT), (shot_at - slot).total_seconds())
        run_with_ingest_failure_notification(um, config)

        slot = next_ingest_slot(datetime.now())
        logging.info("Next ingest shot planned at %s", slot.strftime(DATETIME_FORMAT))
        time.sleep(max(0, (slot - datetime.now()).total_seconds()))


if __name__ == "__main__":
    main()
