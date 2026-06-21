from dataclasses import dataclass
from functools import cached_property
from json import load as json_load
from pathlib import Path
from typing import Any


CONFIG_PATH = Path("/data/options.json")


@dataclass(frozen=True)
class DtekConfig:
    phone: str
    password: str
    accountId: str
    department: str
    intervalMinutes: int
    cookies: dict[str, str]

    @cached_property
    def url(self) -> str:
        return f"https://ok.dtek-{self.department}.com.ua/api"


@dataclass(frozen=True)
class NotificationsConfig:
    mobileServices: tuple[str, ...]


@dataclass(frozen=True)
class SolaroidConfig:
    api: str
    token: str
    intervalMinutes: int
    payload: dict[str, Any]
    dtek: DtekConfig
    notifications: NotificationsConfig

    @cached_property
    def url(self) -> str:
        return f"{self.api.rstrip('/')}/functions/v1/ingest"


def load_config(path: Path = CONFIG_PATH) -> SolaroidConfig:
    with path.open(encoding="utf-8") as file:
        data = json_load(file)

    data["dtek"]["cookies"] = {i["name"]: i["value"] for i in data["dtek"]["cookies"] or []}
    data["dtek"] = DtekConfig(**data["dtek"])

    data.setdefault("notifications", {"mobileServices": ("notify.notify_admins",)})
    data["notifications"] = NotificationsConfig(**data["notifications"])

    return SolaroidConfig(**data)
