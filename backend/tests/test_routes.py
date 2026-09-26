import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.integrations import mapbox
from app.main import app

ORIGIN = {"longitude": -73.9857, "latitude": 40.7484}
DESTINATION = {"longitude": -73.9616, "latitude": 40.8078}


class FakeResponse:
    def __init__(self, status_code=200, json_data=None):
        self.status_code = status_code
        self._json_data = json_data if json_data is not None else {}

    def json(self):
        return self._json_data


def make_route(coordinates=None, duration=612.3, distance=4830.1):
    if coordinates is None:
        coordinates = [
            [ORIGIN["longitude"], ORIGIN["latitude"]],
            [DESTINATION["longitude"], DESTINATION["latitude"]],
        ]
    return {
        "geometry": {"type": "LineString", "coordinates": coordinates},
        "duration": duration,
        "distance": distance,
        "weight": duration,
        "weight_name": "pedestrian",
        "legs": [],
    }


def directions_payload(routes=None, code="Ok"):
    if routes is None:
        routes = [make_route()]
    return {"code": code, "waypoints": [], "routes": routes, "uuid": "test-uuid"}


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def configure_token(token="test-mapbox-token"):
    app.dependency_overrides[get_settings] = lambda: Settings(mapbox_access_token=token)


def configure_no_token():
    app.dependency_overrides[get_settings] = lambda: Settings(mapbox_access_token=None)


def request_body(mode="walking"):
    return {"origin": dict(ORIGIN), "destination": dict(DESTINATION), "mode": mode}


# --- POST /routes: success ---


def test_create_route_single_result(client, monkeypatch):
    configure_token()
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append((url, params, timeout))
        return FakeResponse(json_data=directions_payload())

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.post("/routes", json=request_body(mode="walking"))

    assert response.status_code == 200
    body = response.json()
    assert len(body["routes"]) == 1
    route = body["routes"][0]
    assert route["duration_seconds"] == 612.3
    assert route["distance_meters"] == 4830.1
    assert route["geometry"]["type"] == "LineString"

    assert len(calls) == 1
    url, params, timeout = calls[0]
    assert (
        url == f"{mapbox.DIRECTIONS_BASE_URL}/walking/-73.9857,40.7484;-73.9616,40.8078"
    )
    assert params["access_token"] == "test-mapbox-token"
    assert params["geometries"] == "geojson"
    assert params["overview"] == "full"
    assert params["alternatives"] == "true"
    assert timeout == mapbox.REQUEST_TIMEOUT_SECONDS


def test_create_route_multiple_alternatives(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        return FakeResponse(
            json_data=directions_payload(
                routes=[
                    make_route(duration=600.0, distance=4500.0),
                    make_route(duration=700.0, distance=5200.0),
                ]
            )
        )

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.post("/routes", json=request_body(mode="driving"))

    assert response.status_code == 200
    body = response.json()
    assert len(body["routes"]) == 2
    assert body["routes"][0]["duration_seconds"] == 600.0
    assert body["routes"][1]["duration_seconds"] == 700.0


def test_create_route_preserves_longitude_latitude_ordering(client, monkeypatch):
    configure_token()
    captured = {}

    def fake_get(url, params=None, timeout=None):
        captured["url"] = url
        return FakeResponse(
            json_data=directions_payload(
                routes=[
                    make_route(
                        coordinates=[
                            [-73.9857, 40.7484],
                            [-73.97, 40.76],
                            [-73.9616, 40.8078],
                        ]
                    )
                ]
            )
        )

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.post("/routes", json=request_body(mode="walking"))

    assert response.status_code == 200
    # URL coordinates are "lon,lat;lon,lat" -- origin then destination, each
    # longitude before latitude.
    assert "-73.9857,40.7484;-73.9616,40.8078" in captured["url"]
    coords = response.json()["routes"][0]["geometry"]["coordinates"]
    assert coords[0] == [-73.9857, 40.7484]
    assert coords[-1] == [-73.9616, 40.8078]


# --- POST /routes: request validation (schema-level, no mock needed) ---


def test_create_route_rejects_invalid_longitude(client):
    configure_token()
    body = request_body()
    body["origin"]["longitude"] = 200.0
    response = client.post("/routes", json=body)
    assert response.status_code == 422


def test_create_route_rejects_invalid_latitude(client):
    configure_token()
    body = request_body()
    body["destination"]["latitude"] = -95.0
    response = client.post("/routes", json=body)
    assert response.status_code == 422


def _post_raw_json(client, body: dict):
    # httpx's `json=` param serializes with allow_nan=False and refuses to
    # even build a request containing inf/nan, so send raw bytes (Python's
    # json module permits the non-standard NaN/Infinity tokens) to reach the
    # server and exercise our own schema-level rejection of them.
    import json

    payload = json.dumps(body, allow_nan=True).encode("utf-8")
    return client.post(
        "/routes", content=payload, headers={"content-type": "application/json"}
    )


def test_create_route_rejects_non_finite_coordinate(client):
    configure_token()
    body = request_body()
    body["origin"]["latitude"] = float("inf")
    response = _post_raw_json(client, body)
    assert response.status_code == 422


def test_create_route_rejects_nan_coordinate(client):
    configure_token()
    body = request_body()
    body["origin"]["longitude"] = float("nan")
    response = _post_raw_json(client, body)
    assert response.status_code == 422


def test_create_route_rejects_invalid_mode(client):
    configure_token()
    response = client.post("/routes", json=request_body(mode="flying"))
    assert response.status_code == 422


# --- POST /routes: configuration ---


def test_create_route_missing_credentials_returns_503(client):
    configure_no_token()
    response = client.post("/routes", json=request_body())
    assert response.status_code == 503
    assert "test-mapbox-token" not in response.text


# --- POST /routes: explicit no-route outcomes ---


def test_create_route_no_route_code_returns_empty_list(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        return FakeResponse(
            json_data={"code": "NoRoute", "routes": [], "waypoints": []}
        )

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.post("/routes", json=request_body())
    assert response.status_code == 200
    assert response.json() == {"routes": []}


def test_create_route_no_segment_code_returns_empty_list(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        return FakeResponse(
            json_data={
                "code": "NoSegment",
                "message": "Could not find a matching segment",
                "routes": [],
            }
        )

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.post("/routes", json=request_body())
    assert response.status_code == 200
    assert response.json() == {"routes": []}


# --- POST /routes: provider failures (never silently treated as empty) ---


def test_create_route_unknown_provider_code_returns_502(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        return FakeResponse(json_data={"code": "SomethingNew", "routes": []})

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.post("/routes", json=request_body())
    assert response.status_code == 502


def test_create_route_ok_with_no_routes_returns_502(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        return FakeResponse(json_data={"code": "Ok", "routes": []})

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.post("/routes", json=request_body())
    assert response.status_code == 502


def test_create_route_malformed_geometry_type_returns_502(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        route = make_route()
        route["geometry"]["type"] = "Point"
        return FakeResponse(json_data=directions_payload(routes=[route]))

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.post("/routes", json=request_body())
    assert response.status_code == 502


def test_create_route_geometry_with_too_few_points_returns_502(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        route = make_route(coordinates=[[-73.9857, 40.7484]])
        return FakeResponse(json_data=directions_payload(routes=[route]))

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.post("/routes", json=request_body())
    assert response.status_code == 502


def test_create_route_geometry_with_invalid_coordinate_pair_returns_502(
    client, monkeypatch
):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        route = make_route(coordinates=[[-73.9857, 40.7484], [float("nan"), 40.8078]])
        return FakeResponse(json_data=directions_payload(routes=[route]))

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.post("/routes", json=request_body())
    assert response.status_code == 502


def test_create_route_negative_duration_returns_502(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        route = make_route(duration=-1.0)
        return FakeResponse(json_data=directions_payload(routes=[route]))

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.post("/routes", json=request_body())
    assert response.status_code == 502


def test_create_route_negative_distance_returns_502(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        route = make_route(distance=-1.0)
        return FakeResponse(json_data=directions_payload(routes=[route]))

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.post("/routes", json=request_body())
    assert response.status_code == 502


def test_create_route_provider_timeout_returns_502(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        raise httpx.TimeoutException("timed out")

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.post("/routes", json=request_body())
    assert response.status_code == 502
    assert "test-mapbox-token" not in response.text


def test_create_route_provider_upstream_failure_returns_502(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        return FakeResponse(status_code=500, json_data={"message": "server exploded"})

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.post("/routes", json=request_body())
    assert response.status_code == 502
    assert "server exploded" not in response.text


# --- regression ---


def test_health_still_works(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
