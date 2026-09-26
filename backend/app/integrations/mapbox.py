"""Mapbox Search Box API client: request parameters and response parsing.

Uses the /suggest and /retrieve endpoints, constrained to a bounding box
around the NYC area. The bounding box is a rectangle, not the city's exact
boundary, so it may include nearby non-NYC areas and can clip parts of the
city near its edges.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

SEARCH_BOX_BASE_URL = "https://api.mapbox.com/search/searchbox/v1"
REQUEST_TIMEOUT_SECONDS = 5.0

# Rough NYC-area bounding box (west, south, east, north), covering the five
# boroughs with margin. This constrains search to the NYC area; it does not
# enforce exact city boundaries.
NYC_BBOX = (-74.26, 40.49, -73.68, 40.92)
# Biases ranking toward Manhattan without restricting results to it.
NYC_PROXIMITY = (-73.9857, 40.7484)
NYC_COUNTRY = "us"
PLACE_TYPES = "address,poi"


class MapboxTimeoutError(Exception):
    """The Mapbox request timed out."""


class MapboxRequestError(Exception):
    """The Mapbox request failed (network error or non-2xx response)."""


class MapboxResponseError(Exception):
    """The Mapbox response was missing expected fields or malformed."""


class MapboxPlaceNotFoundError(Exception):
    """Mapbox had no place for the given mapbox_id."""


@dataclass(frozen=True)
class Suggestion:
    mapbox_id: str
    name: str
    place_formatted: str | None
    full_address: str | None
    feature_type: str | None


@dataclass(frozen=True)
class SuggestResult:
    suggestions: list[Suggestion]
    attribution: str


@dataclass(frozen=True)
class PlaceDetail:
    mapbox_id: str
    name: str
    full_address: str | None
    feature_type: str | None
    longitude: float
    latitude: float


@dataclass(frozen=True)
class RetrieveResult:
    place: PlaceDetail
    attribution: str


class MapboxClient:
    def __init__(self, access_token: str) -> None:
        self._access_token = access_token

    def suggest(self, query: str, session_token: str) -> SuggestResult:
        params = {
            "q": query,
            "access_token": self._access_token,
            "session_token": session_token,
            "bbox": ",".join(str(v) for v in NYC_BBOX),
            "proximity": ",".join(str(v) for v in NYC_PROXIMITY),
            "country": NYC_COUNTRY,
            "types": PLACE_TYPES,
        }
        data = self._get(f"{SEARCH_BOX_BASE_URL}/suggest", params)
        return self._parse_suggest(data)

    def retrieve(self, mapbox_id: str, session_token: str) -> RetrieveResult:
        params = {
            "access_token": self._access_token,
            "session_token": session_token,
        }
        data = self._get(f"{SEARCH_BOX_BASE_URL}/retrieve/{mapbox_id}", params)
        return self._parse_retrieve(data)

    def _get(self, url: str, params: dict[str, str]) -> dict:
        try:
            response = httpx.get(url, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
        except httpx.TimeoutException as exc:
            raise MapboxTimeoutError("Mapbox request timed out") from exc
        except httpx.HTTPError as exc:
            raise MapboxRequestError("Mapbox request failed") from exc

        if response.status_code >= 400:
            logger.warning("Mapbox returned status %s", response.status_code)
            raise MapboxRequestError(f"Mapbox returned status {response.status_code}")

        try:
            return response.json()
        except ValueError as exc:
            raise MapboxResponseError("Mapbox response was not valid JSON") from exc

    @staticmethod
    def _parse_suggest(data: dict) -> SuggestResult:
        raw_suggestions = data.get("suggestions")
        if raw_suggestions is None:
            raise MapboxResponseError("Mapbox suggest response missing 'suggestions'")

        suggestions: list[Suggestion] = []
        for item in raw_suggestions:
            mapbox_id = item.get("mapbox_id")
            name = item.get("name")
            if not mapbox_id or not name:
                logger.warning("Skipping malformed Mapbox suggestion")
                continue
            suggestions.append(
                Suggestion(
                    mapbox_id=mapbox_id,
                    name=name,
                    place_formatted=item.get("place_formatted"),
                    full_address=item.get("full_address"),
                    feature_type=item.get("feature_type"),
                )
            )

        attribution = data.get("attribution", "")
        return SuggestResult(suggestions=suggestions, attribution=attribution)

    @staticmethod
    def _parse_retrieve(data: dict) -> RetrieveResult:
        features = data.get("features")
        if features is None:
            raise MapboxResponseError("Mapbox retrieve response missing 'features'")
        if not features:
            raise MapboxPlaceNotFoundError("No place found for the given mapbox_id")

        feature = features[0]
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates")
        properties = feature.get("properties") or {}

        if not coordinates or len(coordinates) != 2:
            raise MapboxResponseError("Mapbox retrieve response missing coordinates")

        # GeoJSON coordinates are [longitude, latitude], in that order.
        longitude, latitude = coordinates

        mapbox_id = properties.get("mapbox_id")
        name = properties.get("name")
        if not mapbox_id or not name:
            raise MapboxResponseError("Mapbox retrieve response missing place fields")

        place = PlaceDetail(
            mapbox_id=mapbox_id,
            name=name,
            full_address=properties.get("full_address"),
            feature_type=properties.get("feature_type"),
            longitude=longitude,
            latitude=latitude,
        )
        attribution = data.get("attribution", "")
        return RetrieveResult(place=place, attribution=attribution)
