import json
from datetime import datetime, timedelta, timezone

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.db.crime import CONNECT_TIMEOUT_SECONDS, fetch_along_route
from app.db.spatial_queries import ALONG_ROUTE_BBOX_SQL
from app.main import app
from app.schemas.crime import (
    EXAMPLE_INCIDENT,
    EXAMPLE_REQUEST,
    SELECTED_COMPLAINT_CATEGORIES,
    AlongRouteRequest,
)

EARLIEST = datetime(2006, 1, 1, tzinfo=timezone.utc)
MAX_WINDOW_DAYS = 7320
DATABASE_URL = (
    "postgresql://wayaware_user:super-secret-db-password"
    "@db.internal.example:5432/wayaware"
)
SECRET_FRAGMENTS = (
    "super-secret-db-password",
    "db.internal.example",
    "wayaware_user",
    "postgresql://",
)


class FakeCursor:
    def __init__(self, rows=None, error=None):
        self.rows = [] if rows is None else rows
        self.error = error
        self.calls = []
        self._returned_rows = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        if self.error is not None and not str(sql).startswith("SET "):
            raise self.error

    def fetchall(self):
        if self._returned_rows:
            return []
        self._returned_rows = True
        return self.rows


class FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.closed = False
        self.read_only = False

    def cursor(self):
        return self._cursor

    def close(self):
        self.closed = True


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def configure_database(database_url=DATABASE_URL):
    app.dependency_overrides[get_settings] = lambda: Settings(
        mapbox_access_token=None,
        database_url=database_url,
        crime_earliest_occurred_at=EARLIEST,
        crime_max_window_days=MAX_WINDOW_DAYS,
    )


def request_body(**overrides):
    body = {
        "route": {
            "type": "LineString",
            "coordinates": [
                [-73.985858, 40.748196],
                [-73.961607, 40.807877],
            ],
        },
        "radius_m": 50,
        "start": "2016-06-01T00:00:00Z",
        "end": "2026-06-01T00:00:00Z",
        "limit": 100,
    }
    body.update(overrides)
    return body


def incident_row(
    source_id,
    ky_cd=109,
    occurred_at=None,
    ofns_desc="GRAND LARCENY",
    distance_m=12.5,
):
    if occurred_at is None:
        occurred_at = datetime(2026, 5, 15, 14, 30, tzinfo=timezone.utc)
    return {
        "source": "nypd_complaint",
        "source_id": source_id,
        "ky_cd": ky_cd,
        "ofns_desc": ofns_desc,
        "pd_desc": "LARCENY,GRAND FROM VEHICLE, UNATTENDED",
        "law_cat_cd": "FELONY",
        "occurred_at": occurred_at,
        "latitude": 40.752,
        "longitude": -73.981,
        "distance_m": distance_m,
    }


def install_database(monkeypatch, rows=None, error=None, connect_error=None):
    cursor = FakeCursor(rows=rows, error=error)
    connection = FakeConnection(cursor)
    calls = []

    def fake_connect(database_url, **kwargs):
        calls.append((database_url, kwargs))
        if connect_error is not None:
            raise connect_error
        return connection

    monkeypatch.setattr("app.db.crime.psycopg.connect", fake_connect)
    return {"calls": calls, "connection": connection, "cursor": cursor}


def assert_no_secrets(response):
    for fragment in SECRET_FRAGMENTS:
        assert fragment not in response.text


def _post_raw_json(client, body):
    payload = json.dumps(body, allow_nan=True).encode("utf-8")
    return client.post(
        "/crime/along-route",
        content=payload,
        headers={"content-type": "application/json"},
    )


# --- documented examples ---


def test_documented_examples_match_the_import_and_the_window():
    request = AlongRouteRequest.model_validate(EXAMPLE_REQUEST)
    span = request.end - request.start
    assert len(request.route.coordinates) >= 2
    assert len({tuple(pair) for pair in request.route.coordinates}) >= 2
    assert span <= timedelta(days=MAX_WINDOW_DAYS)
    assert span.days == 7305

    stored = datetime.fromisoformat(
        EXAMPLE_INCIDENT["stored_occurred_at"].replace("Z", "+00:00")
    )
    assert request.start <= stored < request.end
    assert stored.hour != 0
    assert EXAMPLE_INCIDENT["time_of_day_known"] is False

    descriptions = dict(SELECTED_COMPLAINT_CATEGORIES)
    assert len(descriptions) == 7
    ky_cd = EXAMPLE_INCIDENT["ky_cd"]
    assert descriptions[ky_cd] == EXAMPLE_INCIDENT["ofns_desc"]


def test_documented_request_returns_metadata(client, monkeypatch):
    configure_database()
    installed = install_database(monkeypatch, rows=[incident_row("326096311")])

    response = client.post("/crime/along-route", json=EXAMPLE_REQUEST)

    assert response.status_code == 200
    body = response.json()
    assert body["returned"] == 1
    assert body["truncated"] is False
    assert body["coverage"]["detail"].startswith("Coverage includes only the seven")
    assert [item["ky_cd"] for item in body["coverage"]["categories"]] == [
        101,
        104,
        105,
        106,
        107,
        109,
        110,
    ]
    assert body["timestamp_quality"]["time_of_day"] == "unverified"
    assert "midnight" in body["timestamp_quality"]["detail"]
    incident = body["incidents"][0]
    assert incident["ky_cd"] == 109
    assert incident["ofns_desc"] == "GRAND LARCENY"
    assert incident["time_of_day_known"] is False
    assert incident["source"] == "nypd_complaint"
    assert_no_secrets(response)

    sql, params = installed["cursor"].calls[1]
    assert sql == ALONG_ROUTE_BBOX_SQL
    assert params["limit_plus_one"] == 101
    assert params["start"] == datetime(2025, 6, 1, tzinfo=timezone.utc)
    assert params["end"] == datetime(2026, 6, 1, tzinfo=timezone.utc)
    assert params["min_lat"] <= 40.748196
    assert params["max_lat"] >= 40.807877
    assert params["min_lon"] <= -73.985858
    assert params["max_lon"] >= -73.961607
    assert "-73.985858" not in sql
    assert "ORDER BY occurred_at DESC, source, source_id" in sql
    assert (
        installed["connection"].isolation_level
        == psycopg.IsolationLevel.REPEATABLE_READ
    )


# --- validation ---


def test_rejects_fewer_than_two_coordinates(client, monkeypatch):
    configure_database()
    installed = install_database(monkeypatch)
    body = request_body()
    body["route"]["coordinates"] = [[-73.985858, 40.748196]]

    response = client.post("/crime/along-route", json=body)

    assert response.status_code == 422
    assert installed["calls"] == []


def test_rejects_more_than_two_thousand_coordinates(client, monkeypatch):
    configure_database()
    installed = install_database(monkeypatch)
    body = request_body()
    body["route"]["coordinates"] = [
        [-73.99 + (index * 0.00001), 40.74] for index in range(2001)
    ]

    response = client.post("/crime/along-route", json=body)

    assert response.status_code == 422
    assert installed["calls"] == []


def test_rejects_non_finite_coordinates(client, monkeypatch):
    configure_database()
    installed = install_database(monkeypatch)
    body = request_body()
    body["route"]["coordinates"] = [[-73.985858, 40.748196], [float("nan"), 40.75]]

    response = _post_raw_json(client, body)

    assert response.status_code == 422
    assert installed["calls"] == []
    assert_no_secrets(response)


def test_rejects_out_of_range_coordinates(client, monkeypatch):
    configure_database()
    installed = install_database(monkeypatch)
    body = request_body()
    body["route"]["coordinates"] = [[181.0, 40.75], [-73.96, 91.0]]

    response = client.post("/crime/along-route", json=body)

    assert response.status_code == 422
    assert installed["calls"] == []


def test_rejects_a_line_with_no_distinct_points(client, monkeypatch):
    configure_database()
    installed = install_database(monkeypatch)
    body = request_body()
    body["route"]["coordinates"] = [
        [-73.985858, 40.748196],
        [-73.985858, 40.748196],
    ]

    response = client.post("/crime/along-route", json=body)

    assert response.status_code == 422
    assert installed["calls"] == []


def test_rejects_naive_timestamps(client, monkeypatch):
    configure_database()
    installed = install_database(monkeypatch)
    body = request_body(start="2026-05-01T00:00:00", end="2026-06-01T00:00:00Z")

    response = client.post("/crime/along-route", json=body)

    assert response.status_code == 422
    assert installed["calls"] == []


def test_rejects_start_that_is_not_before_end(client, monkeypatch):
    configure_database()
    installed = install_database(monkeypatch)

    same = client.post(
        "/crime/along-route",
        json=request_body(start="2026-06-01T00:00:00Z", end="2026-06-01T00:00:00Z"),
    )
    reversed_window = client.post(
        "/crime/along-route",
        json=request_body(start="2026-06-02T00:00:00Z", end="2026-06-01T00:00:00Z"),
    )

    assert same.status_code == 422
    assert reversed_window.status_code == 422
    assert installed["calls"] == []


def test_rejects_radius_and_limit_outside_bounds(client, monkeypatch):
    configure_database()
    installed = install_database(monkeypatch)

    responses = [
        client.post("/crime/along-route", json=request_body(radius_m=0)),
        client.post("/crime/along-route", json=request_body(radius_m=-1)),
        client.post("/crime/along-route", json=request_body(radius_m=200.1)),
        client.post("/crime/along-route", json=request_body(limit=0)),
        client.post("/crime/along-route", json=request_body(limit=201)),
    ]

    assert [response.status_code for response in responses] == [422] * 5
    assert installed["calls"] == []


def test_rejects_a_window_longer_than_the_configured_maximum(client, monkeypatch):
    configure_database()
    installed = install_database(monkeypatch)
    start = EARLIEST
    end = start + timedelta(days=MAX_WINDOW_DAYS + 1)

    response = client.post(
        "/crime/along-route",
        json=request_body(start=start.isoformat(), end=end.isoformat()),
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "date window must be 7320 days or fewer"
    assert installed["calls"] == []
    assert_no_secrets(response)


def test_rejects_a_start_before_the_configured_earliest_date(client, monkeypatch):
    configure_database()
    installed = install_database(monkeypatch)
    start = EARLIEST - timedelta(seconds=1)

    response = client.post(
        "/crime/along-route",
        json=request_body(
            start=start.isoformat(),
            end=(EARLIEST + timedelta(days=1)).isoformat(),
        ),
    )

    assert response.status_code == 422
    assert "2006-01-01" in response.json()["detail"]
    assert installed["calls"] == []


def test_accepts_the_maximum_radius_limit_and_window(client, monkeypatch):
    configure_database()
    installed = install_database(monkeypatch, rows=[])
    start = EARLIEST
    end = start + timedelta(days=MAX_WINDOW_DAYS)

    response = client.post(
        "/crime/along-route",
        json=request_body(
            radius_m=200,
            limit=200,
            start=start.isoformat(),
            end=end.isoformat(),
        ),
    )

    assert response.status_code == 200
    assert response.json()["returned"] == 0
    assert response.json()["truncated"] is False
    assert installed["cursor"].calls[1][1]["limit_plus_one"] == 201
    assert installed["connection"].closed is True
    assert installed["connection"].read_only is True
    assert (
        installed["connection"].isolation_level
        == psycopg.IsolationLevel.REPEATABLE_READ
    )
    assert installed["calls"][0][1]["connect_timeout"] == CONNECT_TIMEOUT_SECONDS
    assert installed["calls"][0][1]["sslmode"] == "require"
    assert "statement_timeout=15s" in installed["calls"][0][1]["options"]
    timeout_sql = installed["cursor"].calls[0][0]
    assert timeout_sql.startswith("SET statement_timeout = '")
    millis = int(
        timeout_sql.removeprefix("SET statement_timeout = '").removesuffix("ms'")
    )
    assert 0 < millis <= 15_000


# --- results ---


def test_limit_plus_one_truncation_preserves_query_order(client, monkeypatch):
    configure_database()
    rows = [
        incident_row("later", occurred_at=datetime(2026, 5, 2, tzinfo=timezone.utc)),
        incident_row(
            "middle", occurred_at=datetime(2026, 5, 2, 14, 30, tzinfo=timezone.utc)
        ),
        incident_row("earlier", occurred_at=datetime(2020, 1, 1, tzinfo=timezone.utc)),
    ]
    install_database(monkeypatch, rows=rows)

    response = client.post("/crime/along-route", json=request_body(limit=2))

    assert response.status_code == 200
    body = response.json()
    assert body["truncated"] is True
    assert body["returned"] == 2
    assert body["limit"] == 2
    assert [item["source_id"] for item in body["incidents"]] == ["later", "middle"]
    assert [item["time_of_day_known"] for item in body["incidents"]] == [False, False]
    assert body["incidents"][0]["ky_cd"] == 109


def test_non_midnight_values_stay_unverified(client, monkeypatch):
    configure_database()
    install_database(
        monkeypatch,
        rows=[
            incident_row(
                "afternoon",
                occurred_at=datetime(2024, 8, 1, 14, 30, tzinfo=timezone.utc),
            )
        ],
    )

    response = client.post("/crime/along-route", json=request_body())

    assert response.status_code == 200
    incident = response.json()["incidents"][0]
    assert incident["stored_occurred_at"].startswith("2024-08-01T14:30:00")
    assert incident["time_of_day_known"] is False


# --- database errors and configuration ---


def test_missing_database_url_does_not_block_health_or_connect(client, monkeypatch):
    configure_database(database_url=None)
    installed = install_database(monkeypatch)

    health = client.get("/health")
    crime = client.post("/crime/along-route", json=request_body())

    app.dependency_overrides[get_settings] = lambda: Settings(
        mapbox_access_token=None,
        database_url="   ",
        crime_earliest_occurred_at=EARLIEST,
        crime_max_window_days=MAX_WINDOW_DAYS,
    )
    blank = client.post("/crime/along-route", json=request_body())

    assert health.status_code == 200
    assert health.json() == {"status": "ok"}
    assert crime.status_code == 503
    assert crime.json()["detail"] == "Historical incidents are not configured"
    assert blank.status_code == 503
    assert installed["calls"] == []
    assert_no_secrets(crime)
    assert_no_secrets(blank)


def test_connection_failure_is_a_clean_502(client, monkeypatch):
    configure_database()
    install_database(
        monkeypatch,
        connect_error=psycopg.OperationalError(
            "connection to db.internal.example failed for user "
            "wayaware_user password super-secret-db-password"
        ),
    )

    response = client.post("/crime/along-route", json=request_body())

    assert response.status_code == 502
    assert response.json() == {"detail": "Historical incident query failed"}
    assert_no_secrets(response)


def test_statement_timeout_closes_the_connection(client, monkeypatch):
    configure_database()
    installed = install_database(
        monkeypatch,
        error=psycopg.errors.QueryCanceled(
            "canceling statement due to statement timeout at db.internal.example"
        ),
    )

    response = client.post("/crime/along-route", json=request_body())

    assert response.status_code == 502
    assert response.json() == {"detail": "Historical incident query failed"}
    assert installed["connection"].closed is True
    assert_no_secrets(response)


def test_stops_after_the_limit_is_filled(client, monkeypatch):
    configure_database()
    rows = [
        incident_row(str(index), occurred_at=datetime(2026, 5, 1, tzinfo=timezone.utc))
        for index in range(101)
    ]
    installed = install_database(monkeypatch, rows=rows)

    response = client.post("/crime/along-route", json=request_body(limit=100))

    assert response.status_code == 200
    assert response.json()["truncated"] is True
    assert response.json()["returned"] == 100
    selects = [
        call
        for call in installed["cursor"].calls
        if not str(call[0]).startswith("SET ")
    ]
    assert len(selects) == 1
    assert selects[0][1]["limit_plus_one"] == 101


def test_later_slice_requests_only_the_remaining_rows(monkeypatch):
    batches = [
        [incident_row("newer", occurred_at=datetime(2026, 1, 2, tzinfo=timezone.utc))],
        [incident_row("older", occurred_at=datetime(2025, 1, 2, tzinfo=timezone.utc))],
    ]
    cursor = BatchCursor(batches)
    connection = FakeConnection(cursor)

    def fake_connect(database_url, **kwargs):
        return connection

    monkeypatch.setattr("app.db.crime.psycopg.connect", fake_connect)
    route = json.dumps(
        {
            "type": "LineString",
            "coordinates": [[-73.985858, 40.748196], [-73.961607, 40.807877]],
        }
    )

    rows = fetch_along_route(
        DATABASE_URL,
        route_geojson=route,
        radius_m=50,
        start=datetime(2024, 6, 1, tzinfo=timezone.utc),
        end=datetime(2026, 6, 1, tzinfo=timezone.utc),
        limit_plus_one=101,
    )

    selects = [call for call in cursor.calls if not str(call[0]).startswith("SET ")]
    assert len(selects) == 2
    assert selects[0][1]["limit_plus_one"] == 101
    assert selects[1][1]["limit_plus_one"] == 100
    assert selects[0][1]["start"] == selects[1][1]["end"]
    assert selects[0][1]["start"] == datetime(2025, 6, 1, tzinfo=timezone.utc)
    assert selects[1][1]["start"] == datetime(2024, 6, 1, tzinfo=timezone.utc)
    assert [row["source_id"] for row in rows] == ["newer", "older"]
    assert connection.isolation_level == psycopg.IsolationLevel.REPEATABLE_READ
    assert connection.read_only is True


def test_timeout_on_a_later_slice_does_not_return_partial_rows(client, monkeypatch):
    configure_database()
    cursor = BatchCursor(
        [
            [
                incident_row(
                    "partial", occurred_at=datetime(2026, 5, 1, tzinfo=timezone.utc)
                )
            ]
        ],
        error_on_select=2,
    )
    connection = FakeConnection(cursor)

    def fake_connect(database_url, **kwargs):
        return connection

    monkeypatch.setattr("app.db.crime.psycopg.connect", fake_connect)

    response = client.post(
        "/crime/along-route",
        json=request_body(
            start="2024-06-01T00:00:00Z",
            end="2026-06-01T00:00:00Z",
        ),
    )

    assert response.status_code == 502
    assert response.json() == {"detail": "Historical incident query failed"}
    assert connection.closed is True
    assert_no_secrets(response)


def test_exhausted_budget_does_not_return_an_incomplete_search(client, monkeypatch):
    configure_database()
    cursor = BatchCursor(
        [
            [
                incident_row(
                    "partial", occurred_at=datetime(2026, 5, 1, tzinfo=timezone.utc)
                )
            ]
        ]
    )
    connection = FakeConnection(cursor)
    ticks = {"count": 0}

    def fake_clock():
        ticks["count"] += 1
        if ticks["count"] <= 2:
            return 0.0
        return 20.0

    def fake_connect(database_url, **kwargs):
        return connection

    monkeypatch.setattr("app.db.crime.psycopg.connect", fake_connect)
    monkeypatch.setattr("app.db.crime.monotonic", fake_clock)

    response = client.post(
        "/crime/along-route",
        json=request_body(
            start="2024-06-01T00:00:00Z",
            end="2026-06-01T00:00:00Z",
        ),
    )

    selects = [call for call in cursor.calls if not str(call[0]).startswith("SET ")]
    assert response.status_code == 502
    assert response.json() == {"detail": "Historical incident query failed"}
    assert len(selects) == 1
    assert connection.closed is True
    assert_no_secrets(response)


class BatchCursor:
    def __init__(self, batches, error_on_select=None):
        self.batches = [list(batch) for batch in batches]
        self.error_on_select = error_on_select
        self.calls = []
        self._selects = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        if str(sql).startswith("SET "):
            return
        self._selects += 1
        if self.error_on_select == self._selects:
            raise psycopg.errors.QueryCanceled(
                "canceling statement due to statement timeout"
            )

    def fetchall(self):
        if not self.batches:
            return []
        return self.batches.pop(0)


def test_malformed_row_is_a_clean_502(client, monkeypatch):
    configure_database()
    row = incident_row("broken")
    row["distance_m"] = None
    installed = install_database(monkeypatch, rows=[row])

    response = client.post("/crime/along-route", json=request_body())

    assert response.status_code == 502
    assert response.json() == {"detail": "Historical incident query failed"}
    assert installed["connection"].closed is True
    assert_no_secrets(response)
