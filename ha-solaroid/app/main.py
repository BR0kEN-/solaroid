import logging
import time

from config import load_config, SolaroidConfig
from ha import HomeAssistantClient
from solaroid import build_payload, post_payload
from utility import get_utility_values


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def run_once(client: HomeAssistantClient, config: SolaroidConfig) -> None:
    utility = None

    try:
        utility = get_utility_values(config.dtek)
    except Exception:
        logging.exception("Utility meter fetch failed; posting HA values only")

    payload = build_payload(config.payload, client.state, utility)
    # result = post_payload(config.url, config.token, payload)
    logging.info("Posted payload: %s", payload)


def main() -> None:
    client = HomeAssistantClient()
    config = load_config()
    sleep_seconds = config.intervalMinutes * 60

    while True:
        try:
            run_once(client, config)
        except Exception:
            logging.exception("Sync failed")

        time.sleep(sleep_seconds)


if __name__ == "__main__":
    main()
