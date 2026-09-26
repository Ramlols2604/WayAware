"""Orchestration for route planning: configuration checks and error translation.

Coordinate and mode validation happen in app.schemas.routes (pydantic), so
this module does not repeat them. Request parameters and Mapbox response
parsing live in app.integrations.mapbox; this module only checks
configuration and maps provider outcomes to application-level errors.
"""

from __future__ import annotations

from app.integrations.mapbox import (
    DirectionsResult,
    MapboxClient,
    MapboxRequestError,
    MapboxResponseError,
    MapboxTimeoutError,
)
from app.schemas.routes import Coordinates, RouteMode


class RoutesConfigurationError(Exception):
    """Raised when the Mapbox integration is not configured."""


class RoutesProviderError(Exception):
    """Raised when the Mapbox provider fails or returns something unusable."""


def plan_route(
    origin: Coordinates,
    destination: Coordinates,
    mode: RouteMode,
    access_token: str | None,
) -> DirectionsResult:
    if not access_token:
        raise RoutesConfigurationError("Mapbox access token is not configured")

    client = MapboxClient(access_token)
    try:
        return client.directions(
            (origin.longitude, origin.latitude),
            (destination.longitude, destination.latitude),
            profile=mode.value,
        )
    except MapboxTimeoutError as exc:
        raise RoutesProviderError("Mapbox directions timed out") from exc
    except (MapboxRequestError, MapboxResponseError) as exc:
        raise RoutesProviderError("Mapbox directions failed") from exc
