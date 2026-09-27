"""Score historical exposure along the full selected route.

Weights and thresholds are provisional project assumptions, not validated
danger estimates. Every route uses these same settings. Time of day is not
an input while complaint timestamps remain unverified.

The route is split into equal geodesic pieces near 100 m. The piece count is
``max(1, floor(length / 100 + 1/2))``, so a short tail is not left as its own
segment. A route shorter than 150 m stays one segment. The internal score is
``weighted count * (100 / segment length)``. A short whole route is scaled up
to the 100 m comparison; it is not dropped.

Category weights, per complaint after ``source`` and ``source_id`` are counted
once in that segment:

- 101 murder and non-negligent manslaughter: 25
- 104 rape: 15
- 105 robbery: 8
- 106 felony assault: 8
- 107 burglary: 3
- 109 grand larceny: 1
- 110 grand larceny of a motor vehicle: 1

One murder weighs the same as 25 grand larcenies. Ten robberies reach the
moderate band. Four hundred grand larcenies on a 100 m piece reach the higher
band. The color uses every included category. The summary ranking uses the
raw category counts, with ascending ``ky_cd`` as the tie-breaker.

Below 80 is lower exposure, below 400 is moderate, and 400 or more is higher.
Empty pieces score 0 and stay in the lower band. Nothing in these bands forces
a route to contain every color.

Membership is PostGIS ``ST_DWithin`` on geography. The latitude and longitude
box only limits the index lookup. Neighboring 50 m corridors
overlap, so one complaint may be counted in each segment it touches. Those
segment totals must not be added together as a unique route total.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.application.crime import CrimeConfigurationError, require_historical_window
from app.db.crime import CrimeDatabaseError, fetch_route_exposure
from app.db.route_bounds import _METERS_PER_DEGREE_LAT, geodesic_meters
from app.schemas.crime import (
    COVERAGE_DETAIL,
    SELECTED_COMPLAINT_CATEGORIES,
    Coverage,
    CrimeCategory,
    CrimeWindow,
    ExposureCategoryCount,
    ExposureLevel,
    ExposureSegment,
    RouteComparisonRequest,
    RouteComparisonResponse,
    RouteExposureRequest,
    RouteExposureResponse,
)

TARGET_SEGMENT_M = 100.0
LOWER_BELOW = 80.0
HIGHER_AT = 400.0
TOP_CATEGORY_LIMIT = 3
ROUTE_CATEGORY_LIMIT = 5
COMPARISON_BUDGET_SECONDS = 20.0
MAX_COMPARISON_ROUTES = 3
# Extra ground distance around each piece so the latitude/longitude prefilter
# contains the 50 m geography corridor. ST_DWithin is still the exact test.
# Twenty-five meters matched the wider proved corridor box on real walking
# and driving routes and kept the assessment inside the 15 second budget.
PREFILTER_MARGIN_M = 25.0

# Provisional assumptions. Changing a weight changes every route.
CATEGORY_WEIGHTS: dict[int, int] = {
    101: 25,
    104: 15,
    105: 8,
    106: 8,
    107: 3,
    109: 1,
    110: 1,
}

CATEGORY_NAMES = dict(SELECTED_COMPLAINT_CATEGORIES)


@dataclass(frozen=True)
class RoutePiece:
    index: int
    length_m: float
    coordinates: list[list[float]]


def exposure_level(score: float) -> ExposureLevel:
    """Map an internal score to a color band."""
    if score < LOWER_BELOW:
        return "lower"
    if score < HIGHER_AT:
        return "moderate"
    return "higher"


def exposure_score(counts: dict[int, int], length_m: float) -> float:
    """Return the length-adjusted weighted count. The caller does not display it."""
    if length_m <= 0:
        raise ValueError("segment length")
    weighted = sum(CATEGORY_WEIGHTS[ky_cd] * count for ky_cd, count in counts.items())
    return weighted * (TARGET_SEGMENT_M / length_m)


def top_categories(
    counts: dict[int, int],
    *,
    limit: int | None = TOP_CATEGORY_LIMIT,
) -> list[tuple[int, int]]:
    """Rank by complaint count, then by ascending offense code."""
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    if limit is not None:
        ranked = ranked[:limit]
    return [(ky_cd, count) for ky_cd, count in ranked if count > 0]


def comparison_weight(
    pieces: list[RoutePiece],
    rows: list[dict[str, Any]],
) -> int:
    """Weight each complaint once. Extra route length does not reduce it."""
    unique: dict[tuple[str, str], int] = {}
    for choices in _one_category_per_complaint(pieces, rows):
        for key, ky_cd in choices.items():
            current = unique.get(key)
            if current is None or ky_cd < current:
                unique[key] = ky_cd
    return sum(CATEGORY_WEIGHTS[ky_cd] for ky_cd in unique.values())


def compare_routes(
    request: RouteComparisonRequest,
    *,
    database_url: str | None,
    earliest: datetime,
    max_window_days: int,
) -> RouteComparisonResponse:
    """Score every candidate in one read-only snapshot.

    A timeout or database error raises. Callers must not treat that as zero.
    """
    require_historical_window(request.start, request.end, earliest, max_window_days)
    if database_url is None or not database_url.strip():
        raise CrimeConfigurationError("Historical incidents are not configured")
    if len(request.routes) > MAX_COMPARISON_ROUTES:
        raise CrimeDatabaseError("Historical incident query failed")

    grouped: list[list[RoutePiece]] = []
    payload: list[dict[str, Any]] = []
    try:
        for route_index, route in enumerate(request.routes):
            pieces = split_route(route.coordinates)
            grouped.append(pieces)
            for piece in pieces:
                payload.append(_segment_query(piece, request.radius_m, route_index))
    except ValueError as exc:
        raise CrimeDatabaseError("Historical incident query failed") from exc

    rows = fetch_route_exposure(
        database_url,
        segments=payload,
        radius_m=request.radius_m,
        start=request.start,
        end=request.end,
        codes=list(CATEGORY_WEIGHTS),
        budget_seconds=COMPARISON_BUDGET_SECONDS,
    )
    grouped_rows: list[list[dict[str, Any]]] = [[] for _ in grouped]
    for row in rows:
        try:
            route_index = int(row["route_index"])
        except (KeyError, TypeError, ValueError) as exc:
            raise CrimeDatabaseError("Historical incident query failed") from exc
        if route_index < 0 or route_index >= len(grouped):
            raise CrimeDatabaseError("Historical incident query failed")
        grouped_rows[route_index].append(row)
    return RouteComparisonResponse(
        weights=[
            comparison_weight(pieces, route_rows)
            for pieces, route_rows in zip(grouped, grouped_rows, strict=True)
        ]
    )


def route_categories(
    pieces: list[RoutePiece],
    rows: list[dict[str, Any]],
) -> list[ExposureCategoryCount]:
    """Count each complaint once along the full route.

    Neighboring corridors can contain the same complaint. Segment totals keep
    that overlap. This list does not. The lower offense code wins when one
    complaint has more than one included code. Rank is count, then code.
    """
    unique: dict[tuple[str, str], int] = {}
    for choices in _one_category_per_complaint(pieces, rows):
        for key, ky_cd in choices.items():
            current = unique.get(key)
            if current is None or ky_cd < current:
                unique[key] = ky_cd
    counts: dict[int, int] = {}
    for ky_cd in unique.values():
        counts[ky_cd] = counts.get(ky_cd, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [
        ExposureCategoryCount(
            ky_cd=ky_cd,
            ofns_desc=CATEGORY_NAMES[ky_cd],
            count=count,
        )
        for ky_cd, count in ranked[:ROUTE_CATEGORY_LIMIT]
        if count > 0
    ]


def split_route(coordinates: list[list[float]]) -> list[RoutePiece]:
    """Cut the full line into equal pieces, keeping every bend."""
    points, distances = _measured_path(coordinates)
    total = distances[-1]
    count = max(1, int(math.floor(total / TARGET_SEGMENT_M + 0.5)))
    step = total / count
    pieces: list[RoutePiece] = []
    for index in range(count):
        start = step * index
        end = total if index == count - 1 else step * (index + 1)
        pieces.append(
            RoutePiece(
                index=index,
                length_m=end - start,
                coordinates=_line_between(points, distances, start, end),
            )
        )
    return pieces


def summarize_segments(
    pieces: list[RoutePiece],
    rows: list[dict[str, Any]],
) -> list[ExposureSegment]:
    """Build assessed segments. Raises if a row cannot be counted completely.

    Each segment keeps every positive category count. The color still uses all
    seven included categories. Choosing which of those counts to show is separate.
    """
    chosen = _one_category_per_complaint(pieces, rows)
    segments: list[ExposureSegment] = []
    for piece in pieces:
        counts: dict[int, int] = {}
        for ky_cd in chosen[piece.index].values():
            counts[ky_cd] = counts.get(ky_cd, 0) + 1
        level = exposure_level(exposure_score(counts, piece.length_m))
        categories = [
            ExposureCategoryCount(
                ky_cd=ky_cd,
                ofns_desc=CATEGORY_NAMES[ky_cd],
                count=count,
            )
            for ky_cd, count in top_categories(counts, limit=None)
        ]
        segments.append(
            ExposureSegment(
                id=str(piece.index),
                geometry={
                    "type": "LineString",
                    "coordinates": piece.coordinates,
                },
                length_m=piece.length_m,
                level=level,
                total_count=sum(counts.values()),
                categories=categories,
            )
        )
    return segments


def assess_route(
    request: RouteExposureRequest,
    *,
    database_url: str | None,
    earliest: datetime,
    max_window_days: int,
) -> RouteExposureResponse:
    """Assess every matching complaint near the full route geometry."""
    require_historical_window(request.start, request.end, earliest, max_window_days)
    if database_url is None or not database_url.strip():
        raise CrimeConfigurationError("Historical incidents are not configured")

    try:
        pieces = split_route(request.route.coordinates)
        payload = [_segment_query(piece, request.radius_m) for piece in pieces]
    except ValueError as exc:
        raise CrimeDatabaseError("Historical incident query failed") from exc
    rows = fetch_route_exposure(
        database_url,
        segments=payload,
        radius_m=request.radius_m,
        start=request.start,
        end=request.end,
        codes=list(CATEGORY_WEIGHTS),
    )
    return RouteExposureResponse(
        assessment_status="assessed",
        window=CrimeWindow(start=request.start, end=request.end),
        radius_m=request.radius_m,
        coverage=Coverage(
            categories=[
                CrimeCategory(ky_cd=ky_cd, ofns_desc=name)
                for ky_cd, name in SELECTED_COMPLAINT_CATEGORIES
            ],
            detail=COVERAGE_DETAIL,
        ),
        segments=summarize_segments(pieces, rows),
        route_categories=route_categories(pieces, rows),
    )


def _one_category_per_complaint(
    pieces: list[RoutePiece],
    rows: list[dict[str, Any]],
) -> list[dict[tuple[str, str], int]]:
    chosen: list[dict[tuple[str, str], int]] = [{} for _ in pieces]
    valid = {piece.index for piece in pieces}
    for row in rows:
        try:
            index = int(row["id"])
            key = (str(row["source"]), str(row["source_id"]))
            ky_cd = int(row["ky_cd"])
        except (KeyError, TypeError, ValueError) as exc:
            raise CrimeDatabaseError("Historical incident query failed") from exc
        if index not in valid or ky_cd not in CATEGORY_WEIGHTS:
            raise CrimeDatabaseError("Historical incident query failed")
        current = chosen[index].get(key)
        if current is None or ky_cd < current:
            chosen[index][key] = ky_cd
    return chosen


def _segment_query(
    piece: RoutePiece,
    radius_m: float,
    route_index: int = 0,
) -> dict[str, Any]:
    latitudes = [point[1] for point in piece.coordinates]
    longitudes = [point[0] for point in piece.coordinates]
    guard_m = radius_m + PREFILTER_MARGIN_M
    lat_pad = guard_m / _METERS_PER_DEGREE_LAT
    edge_lat = max(abs(min(latitudes) - lat_pad), abs(max(latitudes) + lat_pad))
    cosine = math.cos(math.radians(min(edge_lat, 89.0)))
    if cosine < 0.2:
        raise ValueError("segment bounds")
    lon_pad = guard_m / (_METERS_PER_DEGREE_LAT * cosine)
    min_lon = min(longitudes) - lon_pad
    max_lon = max(longitudes) + lon_pad
    if min_lon < -180.0 or max_lon > 180.0:
        raise ValueError("segment bounds")
    return {
        "route_index": route_index,
        "id": piece.index,
        "min_lat": min(latitudes) - lat_pad,
        "max_lat": max(latitudes) + lat_pad,
        "min_lon": min_lon,
        "max_lon": max_lon,
        "line": {"type": "LineString", "coordinates": piece.coordinates},
    }


def _measured_path(
    coordinates: list[list[float]],
) -> tuple[list[list[float]], list[float]]:
    points = [coordinates[0]]
    distances = [0.0]
    for start, end in zip(coordinates, coordinates[1:], strict=False):
        length = geodesic_meters(
            float(start[0]), float(start[1]), float(end[0]), float(end[1])
        )
        if length <= 0:
            continue
        points.append(end)
        distances.append(distances[-1] + length)
    if distances[-1] <= 0 or len(points) < 2:
        raise ValueError("route length")
    return points, distances


def _point_at(
    points: list[list[float]],
    distances: list[float],
    distance: float,
) -> list[float]:
    if distance <= distances[0]:
        return list(points[0])
    if distance >= distances[-1]:
        return list(points[-1])
    for index in range(1, len(distances)):
        if distances[index] < distance:
            continue
        span = distances[index] - distances[index - 1]
        fraction = 0.0 if span == 0 else (distance - distances[index - 1]) / span
        start = points[index - 1]
        end = points[index]
        return [
            start[0] + (end[0] - start[0]) * fraction,
            start[1] + (end[1] - start[1]) * fraction,
        ]
    return list(points[-1])


def _line_between(
    points: list[list[float]],
    distances: list[float],
    start: float,
    end: float,
) -> list[list[float]]:
    line = [_point_at(points, distances, start)]
    for point, distance in zip(points, distances, strict=False):
        if start < distance < end:
            line.append(list(point))
    finish = _point_at(points, distances, end)
    if not _same_point(line[-1], finish):
        line.append(finish)
    if len(line) < 2:
        line.append(finish)
    return line


def _same_point(left: list[float], right: list[float]) -> bool:
    return abs(left[0] - right[0]) < 1e-12 and abs(left[1] - right[1]) < 1e-12
