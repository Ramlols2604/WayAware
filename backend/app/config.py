from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolved from this file's location so the .env is found regardless of the
# directory the app is launched from.
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    mapbox_access_token: str | None = None

    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")


def get_settings() -> Settings:
    return Settings()
