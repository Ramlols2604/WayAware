"""Execute historical incident queries and close the connection afterward."""

from __future__ import annotations

from datetime import datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row

from app.db.spatial_queries import ALONG_ROUTE_SQL

CONNECT_TIMEOUT_SECONDS = 10
STATEMENT_TIMEOUT = "15s"
# Session timeout is a fixed setting, not request data.
SET_STATEMENT_TIMEOUT_SQL = "SET statement_timeout = '" + STATEMENT_TIMEOUT + "'"


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
        connection.read_only = True
        with connection.cursor() as cursor:
            cursor.execute(SET_STATEMENT_TIMEOUT_SQL)
            cursor.execute(
                ALONG_ROUTE_SQL,
                {
                    "route": route_geojson,
                    "radius_m": radius_m,
                    "start": start,
                    "end": end,
                    "limit_plus_one": limit_plus_one,
                },
            )
            return list(cursor.fetchall())
    except psycopg.Error as exc:
        raise CrimeDatabaseError("Historical incident query failed") from exc
    finally:
        connection.close()
