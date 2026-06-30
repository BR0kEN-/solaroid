from base64 import b64encode
from dataclasses import dataclass
from functools import cached_property
from json import load as json_load
from pathlib import Path
from typing import Any


CONFIG_PATH = Path("/data/options.json")


@dataclass(frozen=True)
class DtekConfig:
    endpoint: str
    phone: str
    password: str
    accountId: str
    department: str
    intervalMinutes: int

    @cached_property
    def enabled(self) -> bool:
        return (
            self.endpoint != ""
            and self.password != ""
            and self.phone != "+380970000000"
            and self.accountId != ""
        )

    @cached_property
    def url(self) -> str:
        return f"{self.endpoint.rstrip('/')}/webhook/um?department={self.department}"

    @cached_property
    def auth(self) -> str:
        return b64encode(f"{self.accountId}:{self.phone}:{self.password}".encode("utf-8")).decode("ascii")


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

    data["dtek"].pop("cookies", None)
    data["dtek"] = DtekConfig(**data["dtek"])

    data.setdefault("notifications", {"mobileServices": ("notify.notify_admins",)})
    data["notifications"] = NotificationsConfig(**data["notifications"])

    return SolaroidConfig(**data)
