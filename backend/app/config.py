from datetime import datetime, timezone
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolved from this file's location so the .env is found regardless of the
# directory the app is launched from.
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"

# 20 years including leap days. A June 2006–June 2026 span is 7305 days, so
# it fits. The January 2006–June 2026 span is 7456 days and does not.
_DEFAULT_MAX_WINDOW_DAYS = 7320
_DEFAULT_EARLIEST = datetime(2006, 1, 1, tzinfo=timezone.utc)


class Settings(BaseSettings):
    mapbox_access_token: str | None = None
    database_url: str | None = None
    crime_earliest_occurred_at: datetime = _DEFAULT_EARLIEST
    crime_max_window_days: int = _DEFAULT_MAX_WINDOW_DAYS

    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")


def get_settings() -> Settings:
    return Settings()
