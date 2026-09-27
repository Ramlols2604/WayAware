import json
from datetime import datetime, timezone

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.application.exposure import (
    CATEGORY_WEIGHTS,
    HIGHER_AT,
    LOWER_BELOW,
    exposure_level,
    exposure_score,
    route_categories,
    split_route,
    summarize_segments,
    top_categories,
)
from app.db.route_bounds import geodesic_meters
from app.db.spatial_queries import EXPOSURE_SEGMENT_SQL
from app.main import app
from app.schemas.crime import SELECTED_COMPLAINT_CATEGORIES
from tests.test_crime_along_route import configure_database, install_database

EARLIEST = datetime(2006, 1, 1, tzinfo=timezone.utc)
WINDOW = {
    "start": "2006-06-01T00:00:00Z",
    "end": "2026-06-01T00:00:00Z",
}


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def offset_north(lon: float, lat: float, meters: float) -> list[float]:
    low = lat
    high = lat + 1
    for _ in range(50):
        mid = (low + high) / 2
        if geodesic_meters(lon, lat, lon, mid) < meters:
            low = mid
        else:
            high = mid
    return [lon, high]


def offset_east(lon: float, lat: float, meters: float) -> list[float]:
    low = lon
    high = lon + 1
    for _ in range(50):
        mid = (low + high) / 2
        if geodesic_meters(lon, lat, mid, lat) < meters:
            low = mid
        else:
            high = mid
    return [high, lat]


def test_weights_cover_the_seven_selected_codes():
    selected = {ky_cd for ky_cd, _name in SELECTED_COMPLAINT_CATEGORIES}
    assert set(CATEGORY_WEIGHTS) == selected


def test_thresholds_use_the_weighted_count_not_the_largest_category():
    assert LOWER_BELOW == 80
    assert HIGHER_AT == 400
    assert exposure_level(exposure_score({101: 1}, 100)) == "lower"
    assert exposure_level(exposure_score({109: 79}, 100)) == "lower"
    assert exposure_level(exposure_score({105: 10}, 100)) == "moderate"
    assert exposure_level(exposure_score({109: 80}, 100)) == "moderate"
    assert exposure_level(exposure_score({109: 399}, 100)) == "moderate"
    assert exposure_level(exposure_score({109: 400}, 100)) == "higher"
    assert exposure_level(exposure_score({}, 100)) == "lower"


def test_short_route_is_scaled_instead_of_left_as_a_sliver():
    assert exposure_score({109: 4}, 40) == 10
    pieces = split_route([[-73.98, 40.75], offset_north(-73.98, 40.75, 40)])
    assert len(pieces) == 1
    assert pieces[0].length_m == pytest.approx(40, abs=0.05)


def test_equal_pieces_keep_bends_and_share_endpoints():
    start = [-73.99, 40.74]
    bend = offset_north(start[0], start[1], 30)
    end = offset_east(bend[0], bend[1], 200)
    pieces = split_route([start, bend, end])
    assert len(pieces) == 2
    assert pieces[0].length_m == pytest.approx(pieces[1].length_m, abs=0.05)
    assert pieces[0].coordinates[0] == pytest.approx(start)
    assert pieces[0].coordinates[-1] == pytest.approx(pieces[1].coordinates[0])
    assert pieces[1].coordinates[-1] == pytest.approx(end)
    flat = [point for piece in pieces for point in piece.coordinates]
    assert any(point == pytest.approx(bend) for point in flat)
    assert pieces[0].coordinates[-1] != pytest.approx(bend)


def test_counts_a_complaint_once_and_breaks_category_ties_by_code():
    pieces = split_route([[-73.98, 40.75], offset_north(-73.98, 40.75, 100)])
    rows = [
        {"id": 0, "source": "nypd_complaint", "source_id": "9", "ky_cd": 109},
        {"id": 0, "source": "nypd_complaint", "source_id": "9", "ky_cd": 105},
        {"id": 0, "source": "nypd_complaint", "source_id": "8", "ky_cd": 106},
        {"id": 0, "source": "nypd_complaint", "source_id": "7", "ky_cd": 106},
        {"id": 0, "source": "nypd_complaint", "source_id": "6", "ky_cd": 101},
        {"id": 0, "source": "nypd_complaint", "source_id": "5", "ky_cd": 101},
    ]
    segment = summarize_segments(pieces, rows)[0]
    assert segment.total_count == 5
    assert [item.ky_cd for item in segment.categories] == [101, 106, 105]
    assert segment.categories[0].count == 2
    assert segment.level == "lower"


def test_route_categories_count_a_shared_complaint_once():
    pieces = split_route([[-73.98, 40.75], offset_north(-73.98, 40.75, 200)])
    assert len(pieces) == 2
    rows = [
        {"id": 0, "source": "nypd_complaint", "source_id": "shared", "ky_cd": 109},
        {"id": 1, "source": "nypd_complaint", "source_id": "shared", "ky_cd": 105},
        {"id": 0, "source": "nypd_complaint", "source_id": "a", "ky_cd": 106},
        {"id": 0, "source": "nypd_complaint", "source_id": "b", "ky_cd": 106},
        {"id": 1, "source": "nypd_complaint", "source_id": "c", "ky_cd": 109},
        {"id": 0, "source": "nypd_complaint", "source_id": "d", "ky_cd": 109},
        {"id": 1, "source": "nypd_complaint", "source_id": "e", "ky_cd": 107},
        {"id": 0, "source": "nypd_complaint", "source_id": "f", "ky_cd": 107},
        {"id": 1, "source": "nypd_complaint", "source_id": "g", "ky_cd": 101},
        {"id": 0, "source": "nypd_complaint", "source_id": "h", "ky_cd": 104},
        {"id": 1, "source": "nypd_complaint", "source_id": "i", "ky_cd": 110},
    ]
    categories = route_categories(pieces, rows)
    # The shared complaint keeps code 105, so grand larceny stays at 2.
    # Equal counts keep the lower offense code, which drops 105 and 110.
    assert [(item.ky_cd, item.count) for item in categories] == [
        (106, 2),
        (107, 2),
        (109, 2),
        (101, 1),
        (104, 1),
    ]
    segments = summarize_segments(pieces, rows)
    assert sum(segment.total_count for segment in segments) == 11


def test_overlap_stays_on_each_segment():
    pieces = split_route(
        [[-73.98, 40.75], offset_north(-73.98, 40.75, 200)]
    )
    assert len(pieces) == 2
    rows = [
        {"id": 0, "source": "nypd_complaint", "source_id": "1", "ky_cd": 109},
        {"id": 1, "source": "nypd_complaint", "source_id": "1", "ky_cd": 109},
    ]
    segments = summarize_segments(pieces, rows)
    assert [segment.total_count for segment in segments] == [1, 1]
    assert sum(segment.total_count for segment in segments) == 2


def test_zero_matches_stay_in_the_lower_band_with_no_categories():
    pieces = split_route([[-73.98, 40.75], offset_north(-73.98, 40.75, 80)])
    segment = summarize_segments(pieces, [])[0]
    assert segment.total_count == 0
    assert segment.categories == []
    assert segment.level == "lower"


def test_category_rank_prefers_count_then_code():
    assert top_categories({109: 10, 105: 2, 101: 2, 110: 1}) == [
        (109, 10),
        (101, 2),
        (105, 2),
    ]


def test_query_filters_codes_and_uses_geography_distance():
    assert "ky_cd = ANY(%(codes)s)" in EXPOSURE_SEGMENT_SQL
    assert "ST_DWithin" in EXPOSURE_SEGMENT_SQL
    assert "LIMIT" not in EXPOSURE_SEGMENT_SQL


def test_assessed_route_hides_the_numeric_score(client, monkeypatch):
    configure_database()
    install_database(
        monkeypatch,
        rows=[
            {"id": 0, "source": "nypd_complaint", "source_id": "1", "ky_cd": 109},
            {"id": 0, "source": "nypd_complaint", "source_id": "1", "ky_cd": 109},
            {"id": 0, "source": "nypd_complaint", "source_id": "2", "ky_cd": 105},
        ],
    )
    response = client.post(
        "/crime/route-exposure",
        json={
            "route": {
                "type": "LineString",
                "coordinates": [[-73.98, 40.75], offset_north(-73.98, 40.75, 80)],
            },
            "radius_m": 50,
            **WINDOW,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["assessment_status"] == "assessed"
    assert "score" not in json.dumps(body)
    segment = body["segments"][0]
    assert segment["total_count"] == 2
    assert segment["level"] == "lower"
    assert segment["categories"][0]["ky_cd"] == 105
    assert segment["categories"][0]["count"] == 1
    assert [(item["ky_cd"], item["count"]) for item in body["route_categories"]] == [
        (105, 1),
        (109, 1),
    ]


def test_database_failure_does_not_return_colors(client, monkeypatch):
    configure_database()
    install_database(monkeypatch, error=psycopg.OperationalError("timeout"))
    response = client.post(
        "/crime/route-exposure",
        json={
            "route": {
                "type": "LineString",
                "coordinates": [[-73.98, 40.75], [-73.97, 40.76]],
            },
            "radius_m": 50,
            **WINDOW,
        },
    )
    assert response.status_code == 502
    assert "segments" not in response.json()
