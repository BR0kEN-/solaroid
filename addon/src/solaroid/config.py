from base64 import b64encode
from dataclasses import dataclass
from functools import cached_property
from json import load as json_load
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


CONFIG_PATH = Path("/data/options.json")


@dataclass(frozen=True)
class DtekConfig:
    endpoint: str
    phone: str
    password: str
    intervalMinutes: int
    cf_access_client_id: str = ""
    cf_access_client_secret: str = ""

    def __post_init__(self) -> None:
        if self.enabled and self.uses_cloudflare_access:
            if not self.cf_access_client_id or not self.cf_access_client_secret:
                raise ValueError(
                    "dtek.cf_access_client_id and dtek.cf_access_client_secret "
                    "are required for HTTPS endpoints"
                )

    @cached_property
    def enabled(self) -> bool:
        return (
            self.endpoint != ""
            and self.phone != "+380970000000"
            and self.password != ""
        )

    @cached_property
    def auth(self) -> str:
        return b64encode(f"{self.phone}:{self.password}".encode("utf-8")).decode("ascii")

    @cached_property
    def uses_cloudflare_access(self) -> bool:
        return urlsplit(self.endpoint).scheme.lower() == "https"

    @cached_property
    def cf_access_headers(self) -> dict[str, str]:
        if not self.uses_cloudflare_access:
            return {}

        return {
            "CF-Access-Client-Id": self.cf_access_client_id,
            "CF-Access-Client-Secret": self.cf_access_client_secret,
        }


@dataclass(frozen=True)
class NotificationsConfig:
    mobileServices: tuple[str, ...]


@dataclass(frozen=True)
class SolaroidConfig:
    api: str
    token: str
    payload: dict[str, Any]
    dtek: DtekConfig
    notifications: NotificationsConfig

    @cached_property
    def url(self) -> str:
        return f"{self.api.rstrip('/')}/functions/v1/ingest"


def load_config(path: Path = CONFIG_PATH) -> SolaroidConfig:
    with path.open(encoding="utf-8") as file:
        data = json_load(file)

    data["dtek"].pop("accountId", None)
    data["dtek"].pop("cookies", None)
    data["dtek"].pop("department", None)
    data["dtek"] = DtekConfig(**data["dtek"])

    data.setdefault("notifications", {"mobileServices": ("notify.notify_admins",)})
    data["notifications"] = NotificationsConfig(**data["notifications"])

    return SolaroidConfig(**data)
