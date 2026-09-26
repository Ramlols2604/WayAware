"""Orchestration for destination search: validation and error translation.

Request parameters and Mapbox response parsing live in
app.integrations.mapbox; this module only validates input, checks
configuration, and maps provider outcomes to application-level errors.
"""

from __future__ import annotations

import uuid

from app.integrations.mapbox import (
    MapboxClient,
    MapboxPlaceNotFoundError,
    MapboxRequestError,
    MapboxResponseError,
    MapboxTimeoutError,
    RetrieveResult,
    SuggestResult,
)

MAX_QUERY_LENGTH = 256


class PlacesConfigurationError(Exception):
    """Raised when the Mapbox integration is not configured."""


class InvalidPlacesQuery(Exception):
    """Raised when caller-supplied input fails validation."""


class PlaceNotFound(Exception):
    """Raised when Mapbox has no place for the given mapbox_id."""


class PlacesProviderError(Exception):
    """Raised when the Mapbox provider fails or returns something unusable."""


def _clean_query(q: str) -> str:
    trimmed = q.strip()
    if not trimmed:
        raise InvalidPlacesQuery("Query must not be blank")
    if len(trimmed) > MAX_QUERY_LENGTH:
        raise InvalidPlacesQuery(
            f"Query must be {MAX_QUERY_LENGTH} characters or fewer"
        )
    return trimmed


def _validate_session_token(session_token: str) -> str:
    try:
        parsed = uuid.UUID(session_token)
    except ValueError as exc:
        raise InvalidPlacesQuery("session_token must be a valid UUIDv4") from exc
    if parsed.version != 4:
        raise InvalidPlacesQuery("session_token must be a valid UUIDv4")
    return session_token


def search_places(
    q: str, session_token: str, access_token: str | None
) -> SuggestResult:
    if not access_token:
        raise PlacesConfigurationError("Mapbox access token is not configured")

    query = _clean_query(q)
    token = _validate_session_token(session_token)

    client = MapboxClient(access_token)
    try:
        return client.suggest(query, token)
    except MapboxTimeoutError as exc:
        raise PlacesProviderError("Mapbox search timed out") from exc
    except (MapboxRequestError, MapboxResponseError) as exc:
        raise PlacesProviderError("Mapbox search failed") from exc


def retrieve_place(
    mapbox_id: str, session_token: str, access_token: str | None
) -> RetrieveResult:
    if not access_token:
        raise PlacesConfigurationError("Mapbox access token is not configured")

    mapbox_id = mapbox_id.strip()
    if not mapbox_id:
        raise InvalidPlacesQuery("mapbox_id must not be blank")
    token = _validate_session_token(session_token)

    client = MapboxClient(access_token)
    try:
        return client.retrieve(mapbox_id, token)
    except MapboxTimeoutError as exc:
        raise PlacesProviderError("Mapbox retrieve timed out") from exc
    except MapboxPlaceNotFoundError as exc:
        raise PlaceNotFound(str(exc)) from exc
    except (MapboxRequestError, MapboxResponseError) as exc:
        raise PlacesProviderError("Mapbox retrieve failed") from exc
