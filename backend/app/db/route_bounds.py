"""Year slices and a conservative latitude/longitude candidate box.

ST_DWithin on geography follows the WGS84 geodesic, which can bow outside the
straight line between vertices and can cross the antimeridian. The candidate
box is used only when it is a superset of that corridor. Otherwise the query
falls back to the exact distance test and does not apply a box.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime

# Minimum meridional radius of the WGS84 ellipsoid. Dividing a ground distance
# by this radius overstates the change in degrees, so the pad is larger than
# the ellipsoid requires.
_MERIDIONAL_RADIUS_M = 6_335_439.327
_EQUATORIAL_RADIUS_M = 6_378_137.0
_METERS_PER_DEGREE_LAT = _MERIDIONAL_RADIUS_M * math.pi / 180.0
# Ground distance added on top of the requested radius. Two percent of the
# segment length covers the separation between a spherical arc and the WGS84
# geodesic, and the fixed term covers short-segment curvature.
_ELLIPSOID_MARGIN_FRACTION = 0.02
_ELLIPSOID_MARGIN_M = 50.0
_POLE_COSINE = 0.02


@dataclass(frozen=True)
class CandidateBounds:
    """Inclusive latitude/longitude ranges that contain the corridor.

    min_lon and max_lon are None when a single longitude range cannot be
    guaranteed, usually because a segment crosses the antimeridian or a pad
    reaches a pole. Latitude remains bounded in that case.
    """

    min_lat: float
    max_lat: float
    min_lon: float | None
    max_lon: float | None


def yearly_slices(start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
    """Return newest-first half-open slices that partition ``[start, end)``.

    Each slice is at most one calendar year. February 29 steps back to
    February 28, and the following slice begins at that same instant, so the
    partition has no gap and no overlap.
    """
    if start >= end:
        return []
    slices: list[tuple[datetime, datetime]] = []
    slice_end = end
    while slice_end > start:
        stepped = _one_year_earlier(slice_end)
        slice_start = stepped if stepped > start else start
        if slice_start >= slice_end:
            slice_start = start
        slices.append((slice_start, slice_end))
        if slice_start <= start:
            break
        slice_end = slice_start
    return slices


def candidate_bounds(
    coordinates: list[list[float]] | list[tuple[float, float]],
    radius_m: float,
) -> CandidateBounds | None:
    """Return a superset box for the corridor, or None when it cannot be proved.

    Coordinates are GeoJSON ``[longitude, latitude]`` pairs. None tells the
    query to skip the index prefilter and rely on ``ST_DWithin``.
    """
    if radius_m <= 0 or len(coordinates) < 2:
        return None
    min_lat = 90.0
    max_lat = -90.0
    min_lon: float | None = None
    max_lon: float | None = None
    longitude_open = False
    saw_segment = False
    for start, end in zip(coordinates, coordinates[1:], strict=False):
        if len(start) < 2 or len(end) < 2:
            return None
        cover = _segment_cover(
            float(start[0]),
            float(start[1]),
            float(end[0]),
            float(end[1]),
            radius_m,
        )
        if cover is None:
            return None
        saw_segment = True
        min_lat = min(min_lat, cover.min_lat)
        max_lat = max(max_lat, cover.max_lat)
        if cover.min_lon is None or cover.max_lon is None:
            longitude_open = True
        elif not longitude_open:
            min_lon = cover.min_lon if min_lon is None else min(min_lon, cover.min_lon)
            max_lon = cover.max_lon if max_lon is None else max(max_lon, cover.max_lon)
    if not saw_segment:
        return None
    min_lat = max(-90.0, min_lat)
    max_lat = min(90.0, max_lat)
    if longitude_open or min_lon is None or max_lon is None:
        return CandidateBounds(min_lat, max_lat, None, None)
    if min_lon < -180.0 or max_lon > 180.0 or max_lon - min_lon >= 360.0:
        return CandidateBounds(min_lat, max_lat, None, None)
    return CandidateBounds(min_lat, max_lat, min_lon, max_lon)


def _one_year_earlier(moment: datetime) -> datetime:
    try:
        return moment.replace(year=moment.year - 1)
    except ValueError:
        return moment.replace(year=moment.year - 1, day=28)


@dataclass(frozen=True)
class _SegmentCover:
    min_lat: float
    max_lat: float
    min_lon: float | None
    max_lon: float | None


def _segment_cover(
    lon1: float,
    lat1: float,
    lon2: float,
    lat2: float,
    radius_m: float,
) -> _SegmentCover | None:
    if not _valid_point(lon1, lat1) or not _valid_point(lon2, lat2):
        return None
    delta_lon = _short_delta_lon(lon1, lon2)
    if delta_lon is None:
        return None
    angular = _angular_distance(lat1, lat2, delta_lon)
    if angular >= math.pi:
        return None
    segment_m = angular * _EQUATORIAL_RADIUS_M
    guard_m = radius_m + (segment_m * _ELLIPSOID_MARGIN_FRACTION) + _ELLIPSOID_MARGIN_M
    lat_pad = guard_m / _METERS_PER_DEGREE_LAT
    if angular == 0.0:
        return _padded_cover(lat1, lat1, lon1, lon1, lat_pad, guard_m, crossed=False)
    bearing = _initial_bearing(lat1, lat2, delta_lon)
    min_lat, max_lat = _arc_latitude_extent(lat1, lat2, bearing, angular)
    crossed = abs(lon1 - lon2) > 180.0
    turns = _longitude_reverses(lat1, lon1, lat2, lon2, delta_lon)
    if crossed or turns:
        return _padded_cover(
            min_lat, max_lat, lon1, lon2, lat_pad, guard_m, crossed=True
        )
    west = min(lon1, lon2)
    east = max(lon1, lon2)
    return _padded_cover(min_lat, max_lat, west, east, lat_pad, guard_m, crossed=False)


def _padded_cover(
    min_lat: float,
    max_lat: float,
    west: float,
    east: float,
    lat_pad: float,
    guard_m: float,
    *,
    crossed: bool,
) -> _SegmentCover:
    padded_min = min_lat - lat_pad
    padded_max = max_lat + lat_pad
    reaches_pole = padded_min <= -90.0 or padded_max >= 90.0
    padded_min = max(-90.0, padded_min)
    padded_max = min(90.0, padded_max)
    if crossed or reaches_pole:
        return _SegmentCover(padded_min, padded_max, None, None)
    edge_lat = max(abs(padded_min), abs(padded_max))
    lon_pad = _degrees_lon(guard_m, edge_lat)
    if lon_pad >= 180.0:
        return _SegmentCover(padded_min, padded_max, None, None)
    padded_west = west - lon_pad
    padded_east = east + lon_pad
    if padded_west < -180.0 or padded_east > 180.0:
        return _SegmentCover(padded_min, padded_max, None, None)
    return _SegmentCover(padded_min, padded_max, padded_west, padded_east)


def _arc_latitude_extent(
    lat1: float, lat2: float, bearing: float, angular: float
) -> tuple[float, float]:
    latitudes = [lat1, lat2]
    phi1 = math.radians(lat1)
    numer = math.cos(phi1) * math.cos(bearing)
    denom = math.sin(phi1)
    if abs(numer) > 1e-12 or abs(denom) > 1e-12:
        delta_star = math.atan2(numer, denom)
        # The great circle has two latitude extrema, half a turn apart.
        # atan2 returns one of them; the other may lie on this arc.
        for turn in (delta_star, delta_star + math.pi, delta_star - math.pi):
            if not 0.0 < turn < angular:
                continue
            sine = math.sin(phi1) * math.cos(turn) + math.cos(phi1) * math.sin(
                turn
            ) * math.cos(bearing)
            latitudes.append(math.degrees(math.asin(min(1.0, max(-1.0, sine)))))
    return min(latitudes), max(latitudes)


def _longitude_reverses(
    lat1: float, lon1: float, lat2: float, lon2: float, delta_lon: float
) -> bool:
    initial = _initial_bearing(lat1, lat2, delta_lon)
    back = _initial_bearing(lat2, lat1, -delta_lon)
    final = (back + math.pi) % (2.0 * math.pi)
    return math.sin(initial) * math.sin(final) < 0.0


def _degrees_lon(guard_m: float, latitude: float) -> float:
    cosine = math.cos(math.radians(latitude))
    if cosine <= _POLE_COSINE:
        return 180.0
    return guard_m / (_MERIDIONAL_RADIUS_M * cosine * math.pi / 180.0)


def _valid_point(lon: float, lat: float) -> bool:
    return (
        math.isfinite(lon)
        and math.isfinite(lat)
        and -180.0 <= lon <= 180.0
        and -90.0 <= lat <= 90.0
    )


def _short_delta_lon(lon1: float, lon2: float) -> float | None:
    delta = (lon2 - lon1 + 180.0) % 360.0 - 180.0
    if abs(delta) >= 180.0:
        return None
    return delta


def _angular_distance(lat1: float, lat2: float, delta_lon: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = phi2 - phi1
    d_lon = math.radians(delta_lon)
    haversine = (
        math.sin(d_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lon / 2.0) ** 2
    )
    return 2.0 * math.asin(min(1.0, math.sqrt(haversine)))


def _initial_bearing(lat1: float, lat2: float, delta_lon: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_lon = math.radians(delta_lon)
    y = math.sin(d_lon) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(
        d_lon
    )
    return math.atan2(y, x)
