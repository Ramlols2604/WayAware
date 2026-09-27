"""Coordinate validation, the capped along-route query, and result shaping.

The returned incidents are for display and evidence. Scoring has to aggregate
the full corridor and must not use this truncated list.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from app.db.crime import CrimeDatabaseError, fetch_along_route
from app.schemas.crime import (
    AFFECTED_IMPORT_SOURCE,
    COVERAGE_DETAIL,
    SELECTED_COMPLAINT_CATEGORIES,
    TIMESTAMP_QUALITY_DETAIL,
    AlongRouteRequest,
    AlongRouteResponse,
    Coverage,
    CrimeCategory,
    CrimeWindow,
    RouteIncident,
    TimestampQuality,
)

# No source is confirmed. The complaint import stays unverified until its
# timestamp repair is confirmed, and a clock value is not that confirmation.
VERIFIED_TIMESTAMP_SOURCES: frozenset[str] = frozenset()


class CrimeConfigurationError(Exception):
    """Raised when historical incidents are not configured."""


class InvalidCrimeQuery(Exception):
    """Raised when the date window is outside the configured bounds."""


def time_of_day_known(source: str) -> bool:
    """Return whether this source has a confirmed incident clock time.

    Midnight is not treated as missing, and a non-midnight value is not
    treated as trustworthy. Records from the complaint import stay unverified
    until that repair is confirmed.
    """
    if source == AFFECTED_IMPORT_SOURCE:
        return False
    return source in VERIFIED_TIMESTAMP_SOURCES


def incidents_along_route(
    request: AlongRouteRequest,
    *,
    database_url: str | None,
    earliest: datetime,
    max_window_days: int,
) -> AlongRouteResponse:
    _validate_configured_bounds(earliest, max_window_days)
    _validate_window(request.start, request.end, earliest, max_window_days)
    if database_url is None or not database_url.strip():
        raise CrimeConfigurationError("Historical incidents are not configured")

    route_geojson = json.dumps(
        {
            "type": "LineString",
            "coordinates": request.route.coordinates,
        },
        allow_nan=False,
    )
    rows = fetch_along_route(
        database_url,
        route_geojson=route_geojson,
        radius_m=request.radius_m,
        start=request.start,
        end=request.end,
        limit_plus_one=request.limit + 1,
    )
    truncated = len(rows) > request.limit
    kept = rows[: request.limit]
    incidents = [_incident_from_row(row) for row in kept]
    return AlongRouteResponse(
        window=CrimeWindow(start=request.start, end=request.end),
        radius_m=request.radius_m,
        limit=request.limit,
        returned=len(incidents),
        truncated=truncated,
        coverage=Coverage(
            categories=[
                CrimeCategory(ky_cd=ky_cd, ofns_desc=description)
                for ky_cd, description in SELECTED_COMPLAINT_CATEGORIES
            ],
            detail=COVERAGE_DETAIL,
        ),
        timestamp_quality=TimestampQuality(
            time_of_day="unverified",
            detail=TIMESTAMP_QUALITY_DETAIL,
        ),
        incidents=incidents,
    )


def _validate_configured_bounds(earliest: datetime, max_window_days: int) -> None:
    if earliest.tzinfo is None or earliest.utcoffset() is None:
        raise CrimeConfigurationError("Historical incidents are not configured")
    if max_window_days < 1:
        raise CrimeConfigurationError("Historical incidents are not configured")


def _validate_window(
    start: datetime,
    end: datetime,
    earliest: datetime,
    max_window_days: int,
) -> None:
    if start.tzinfo is None or end.tzinfo is None:
        raise InvalidCrimeQuery("start and end must include a timezone")
    if start < earliest:
        raise InvalidCrimeQuery(
            "start must be on or after " + earliest.astimezone(timezone.utc).isoformat()
        )
    if end - start > timedelta(days=max_window_days):
        raise InvalidCrimeQuery(f"date window must be {max_window_days} days or fewer")


def _incident_from_row(row: dict[str, Any]) -> RouteIncident:
    try:
        source = str(row["source"])
        source_id = str(row["source_id"])
        ky_cd = int(row["ky_cd"])
        stored_occurred_at = row["occurred_at"]
        latitude = float(row["latitude"])
        longitude = float(row["longitude"])
        distance_m = float(row["distance_m"])
    except (KeyError, TypeError, ValueError) as exc:
        raise CrimeDatabaseError("Historical incident query failed") from exc
    if not isinstance(stored_occurred_at, datetime):
        raise CrimeDatabaseError("Historical incident query failed")
    if stored_occurred_at.tzinfo is None or stored_occurred_at.utcoffset() is None:
        raise CrimeDatabaseError("Historical incident query failed")
    return RouteIncident(
        source=source,
        source_id=source_id,
        ky_cd=ky_cd,
        ofns_desc=_optional_text(row.get("ofns_desc")),
        pd_desc=_optional_text(row.get("pd_desc")),
        law_cat_cd=_optional_text(row.get("law_cat_cd")),
        stored_occurred_at=stored_occurred_at,
        time_of_day_known=time_of_day_known(source),
        distance_m=distance_m,
        latitude=latitude,
        longitude=longitude,
    )


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)
