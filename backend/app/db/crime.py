"""Execute historical incident queries and close the connection afterward."""

from __future__ import annotations

import json
import math
from datetime import datetime
from time import monotonic
from typing import Any

import psycopg
from psycopg.rows import dict_row

from app.db.route_bounds import CandidateBounds, candidate_bounds, yearly_slices
from app.db.spatial_queries import (
    ALONG_ROUTE_BBOX_SQL,
    ALONG_ROUTE_LATITUDE_SQL,
    ALONG_ROUTE_SQL,
    EXPOSURE_SEGMENT_SQL,
)

CONNECT_TIMEOUT_SECONDS = 10
DATABASE_BUDGET_SECONDS = 15.0
STATEMENT_TIMEOUT = "15s"


class CrimeDatabaseError(Exception):
    """The historical incident query failed."""


def fetch_along_route(
    database_url: str,
    *,
    route_geojson: str,
    radius_m: float,
    start: datetime,
    end: datetime,
    limit_plus_one: int,
) -> list[dict[str, Any]]:
    """Return newest matches, or raise if the search cannot be finished.

    Slices share one repeatable-read snapshot and one budget. A timeout or an
    exhausted budget raises instead of returning a partial list.
    """
    try:
        coordinates = _coordinates(route_geojson)
        bounds = candidate_bounds(coordinates, radius_m)
    except (KeyError, TypeError, ValueError) as exc:
        raise CrimeDatabaseError("Historical incident query failed") from exc

    try:
        connection = psycopg.connect(
            database_url,
            connect_timeout=CONNECT_TIMEOUT_SECONDS,
            sslmode="require",
            options=f"-c statement_timeout={STATEMENT_TIMEOUT}",
            row_factory=dict_row,
        )
    except psycopg.Error as exc:
        raise CrimeDatabaseError("Historical incident query failed") from exc

    try:
        # One snapshot for every slice. A timestamp repair committed midway
        # through the request cannot add a row to one slice and remove it
        # from another.
        connection.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        connection.read_only = True
        deadline = monotonic() + DATABASE_BUDGET_SECONDS
        collected: list[dict[str, Any]] = []
        with connection.cursor() as cursor:
            for slice_start, slice_end in yearly_slices(start, end):
                if len(collected) >= limit_plus_one:
                    break
                remaining = deadline - monotonic()
                if remaining <= 0:
                    raise CrimeDatabaseError("Historical incident query failed")
                cursor.execute(_statement_timeout_sql(remaining))
                cursor.execute(
                    _sql_for(bounds),
                    _params(
                        route_geojson=route_geojson,
                        radius_m=radius_m,
                        start=slice_start,
                        end=slice_end,
                        limit_plus_one=limit_plus_one - len(collected),
                        bounds=bounds,
                    ),
                )
                collected.extend(cursor.fetchall())
        return collected
    except psycopg.Error as exc:
        raise CrimeDatabaseError("Historical incident query failed") from exc
    finally:
        connection.close()


def fetch_route_exposure(
    database_url: str,
    *,
    segments: list[dict[str, Any]],
    radius_m: float,
    start: datetime,
    end: datetime,
    codes: list[int],
) -> list[dict[str, Any]]:
    """Return every segment match, or raise without a partial list.

    The segments are the full route cut without gaps. Membership is the
    per-segment geography test in one statement. Connecting and executing
    share the 15 second budget.
    """
    if not segments:
        raise CrimeDatabaseError("Historical incident query failed")
    deadline = monotonic() + DATABASE_BUDGET_SECONDS
    try:
        connection = psycopg.connect(
            database_url,
            connect_timeout=CONNECT_TIMEOUT_SECONDS,
            sslmode="require",
            options=f"-c statement_timeout={STATEMENT_TIMEOUT}",
            row_factory=dict_row,
        )
    except psycopg.Error as exc:
        raise CrimeDatabaseError("Historical incident query failed") from exc

    try:
        connection.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        connection.read_only = True
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise CrimeDatabaseError("Historical incident query failed")
        with connection.cursor() as cursor:
            cursor.execute(_statement_timeout_sql(remaining))
            cursor.execute(
                EXPOSURE_SEGMENT_SQL,
                {
                    "segments": json.dumps(segments),
                    "radius_m": radius_m,
                    "start": start,
                    "end": end,
                    "codes": codes,
                },
            )
            return list(cursor.fetchall())
    except psycopg.Error as exc:
        raise CrimeDatabaseError("Historical incident query failed") from exc
    finally:
        connection.close()


def _statement_timeout_sql(remaining_seconds: float) -> str:
    milliseconds = math.ceil(remaining_seconds * 1000)
    milliseconds = min(int(DATABASE_BUDGET_SECONDS * 1000), max(1, milliseconds))
    # The value is this process's remaining budget, not request text.
    return "SET statement_timeout = '" + str(milliseconds) + "ms'"


def _sql_for(bounds: CandidateBounds | None) -> str:
    if bounds is None:
        return ALONG_ROUTE_SQL
    if bounds.min_lon is None or bounds.max_lon is None:
        return ALONG_ROUTE_LATITUDE_SQL
    return ALONG_ROUTE_BBOX_SQL


def _params(
    *,
    route_geojson: str,
    radius_m: float,
    start: datetime,
    end: datetime,
    limit_plus_one: int,
    bounds: CandidateBounds | None,
) -> dict[str, Any]:
    params: dict[str, Any] = {
        "route": route_geojson,
        "radius_m": radius_m,
        "start": start,
        "end": end,
        "limit_plus_one": limit_plus_one,
    }
    if bounds is None:
        return params
    params["min_lat"] = bounds.min_lat
    params["max_lat"] = bounds.max_lat
    if bounds.min_lon is not None and bounds.max_lon is not None:
        params["min_lon"] = bounds.min_lon
        params["max_lon"] = bounds.max_lon
    return params


def _coordinates(route_geojson: str) -> list[list[float]]:
    payload = json.loads(route_geojson)
    coordinates = payload["coordinates"]
    if not isinstance(coordinates, list):
        raise TypeError("coordinates")
    return coordinates
