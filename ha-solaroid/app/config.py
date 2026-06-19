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

    @cached_property
    def url(self) -> str:
        return f"https://ok.dtek-{self.department}.com.ua/api"


@dataclass(frozen=True)
class SolaroidConfig:
    api: str
    token: str
    intervalMinutes: int
    payload: dict[str, Any]
    dtek: DtekConfig

    @cached_property
    def url(self) -> str:
        return f"{self.api.rstrip('/')}/functions/v1/ingest"


def load_config(path: Path = CONFIG_PATH) -> SolaroidConfig:
    with path.open(encoding="utf-8") as file:
        data = json_load(file)

    data["dtek"] = DtekConfig(**data["dtek"])

    return SolaroidConfig(**data)
