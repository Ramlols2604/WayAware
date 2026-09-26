import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.integrations import mapbox
from app.main import app

VALID_TOKEN = str(uuid.uuid4())


class FakeResponse:
    def __init__(self, status_code=200, json_data=None):
        self.status_code = status_code
        self._json_data = json_data if json_data is not None else {}

    def json(self):
        return self._json_data


def suggest_payload():
    return {
        "suggestions": [
            {
                "mapbox_id": "abc123",
                "name": "Empire State Building",
                "place_formatted": "New York, NY",
                "full_address": "20 W 34th St, New York, NY",
                "feature_type": "poi",
            }
        ],
        "attribution": "© Mapbox",
    }


def retrieve_payload(longitude=-73.9857, latitude=40.7484):
    return {
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [longitude, latitude]},
                "properties": {
                    "mapbox_id": "abc123",
                    "name": "Empire State Building",
                    "full_address": "20 W 34th St, New York, NY",
                    "feature_type": "poi",
                },
            }
        ],
        "attribution": "© Mapbox",
    }


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def configure_token(token="test-mapbox-token"):
    app.dependency_overrides[get_settings] = lambda: Settings(mapbox_access_token=token)


def configure_no_token():
    app.dependency_overrides[get_settings] = lambda: Settings(mapbox_access_token=None)


# --- /places/search ---


def test_search_success_returns_suggestions_and_attribution(client, monkeypatch):
    configure_token()
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append((url, params, timeout))
        return FakeResponse(json_data=suggest_payload())

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.get(
        "/places/search", params={"q": "Empire State", "session_token": VALID_TOKEN}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["attribution"] == "© Mapbox"
    assert body["suggestions"] == [
        {
            "mapbox_id": "abc123",
            "name": "Empire State Building",
            "place_formatted": "New York, NY",
            "full_address": "20 W 34th St, New York, NY",
            "feature_type": "poi",
        }
    ]

    assert len(calls) == 1
    url, params, timeout = calls[0]
    assert url == f"{mapbox.SEARCH_BOX_BASE_URL}/suggest"
    assert params["q"] == "Empire State"
    assert params["session_token"] == VALID_TOKEN
    assert params["access_token"] == "test-mapbox-token"
    assert params["bbox"] == ",".join(str(v) for v in mapbox.NYC_BBOX)
    assert params["proximity"] == ",".join(str(v) for v in mapbox.NYC_PROXIMITY)
    assert params["country"] == mapbox.NYC_COUNTRY
    assert params["types"] == mapbox.PLACE_TYPES
    assert timeout == mapbox.REQUEST_TIMEOUT_SECONDS


def test_search_trims_query(client, monkeypatch):
    configure_token()
    captured = {}

    def fake_get(url, params=None, timeout=None):
        captured["q"] = params["q"]
        return FakeResponse(json_data=suggest_payload())

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.get(
        "/places/search",
        params={"q": "  Empire State  ", "session_token": VALID_TOKEN},
    )

    assert response.status_code == 200
    assert captured["q"] == "Empire State"


def test_search_empty_results(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        return FakeResponse(json_data={"suggestions": [], "attribution": "© Mapbox"})

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.get(
        "/places/search", params={"q": "asdfghjkl", "session_token": VALID_TOKEN}
    )

    assert response.status_code == 200
    assert response.json() == {"suggestions": [], "attribution": "© Mapbox"}


def test_search_rejects_blank_query(client):
    configure_token()
    response = client.get(
        "/places/search", params={"q": "   ", "session_token": VALID_TOKEN}
    )
    assert response.status_code == 422


def test_search_rejects_query_over_256_chars(client):
    configure_token()
    response = client.get(
        "/places/search",
        params={"q": "a" * 257, "session_token": VALID_TOKEN},
    )
    assert response.status_code == 422


def test_search_rejects_invalid_session_token(client):
    configure_token()
    response = client.get(
        "/places/search", params={"q": "Empire State", "session_token": "not-a-uuid"}
    )
    assert response.status_code == 422


def test_search_missing_credentials_returns_503(client):
    configure_no_token()
    response = client.get(
        "/places/search", params={"q": "Empire State", "session_token": VALID_TOKEN}
    )
    assert response.status_code == 503
    assert "test-mapbox-token" not in response.text


def test_search_provider_timeout_returns_502(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        raise httpx.TimeoutException("timed out")

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.get(
        "/places/search", params={"q": "Empire State", "session_token": VALID_TOKEN}
    )
    assert response.status_code == 502
    assert "test-mapbox-token" not in response.text


def test_search_provider_upstream_failure_returns_502(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        return FakeResponse(status_code=500, json_data={"error": "server exploded"})

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.get(
        "/places/search", params={"q": "Empire State", "session_token": VALID_TOKEN}
    )
    assert response.status_code == 502
    assert "server exploded" not in response.text


# --- /places/{mapbox_id} ---


def test_retrieve_success_returns_place_with_correct_lon_lat_order(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        assert url == f"{mapbox.SEARCH_BOX_BASE_URL}/retrieve/abc123"
        assert params["session_token"] == VALID_TOKEN
        assert params["access_token"] == "test-mapbox-token"
        return FakeResponse(json_data=retrieve_payload(longitude=-73.5, latitude=40.1))

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.get("/places/abc123", params={"session_token": VALID_TOKEN})

    assert response.status_code == 200
    body = response.json()
    assert body["place"]["longitude"] == -73.5
    assert body["place"]["latitude"] == 40.1
    assert body["place"]["mapbox_id"] == "abc123"
    assert body["attribution"] == "© Mapbox"


def test_retrieve_not_found_returns_404(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        return FakeResponse(json_data={"features": [], "attribution": "© Mapbox"})

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.get(
        "/places/does-not-exist", params={"session_token": VALID_TOKEN}
    )
    assert response.status_code == 404


def test_retrieve_malformed_response_returns_502(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        return FakeResponse(json_data={"features": [{"type": "Feature"}]})

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.get("/places/abc123", params={"session_token": VALID_TOKEN})
    assert response.status_code == 502


def test_retrieve_missing_credentials_returns_503(client):
    configure_no_token()
    response = client.get("/places/abc123", params={"session_token": VALID_TOKEN})
    assert response.status_code == 503


def test_retrieve_rejects_invalid_session_token(client):
    configure_token()
    response = client.get("/places/abc123", params={"session_token": "not-a-uuid"})
    assert response.status_code == 422


def test_retrieve_provider_timeout_returns_502(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        raise httpx.TimeoutException("timed out")

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.get("/places/abc123", params={"session_token": VALID_TOKEN})
    assert response.status_code == 502


def test_retrieve_provider_upstream_failure_returns_502(client, monkeypatch):
    configure_token()

    def fake_get(url, params=None, timeout=None):
        return FakeResponse(status_code=503, json_data={"error": "internal detail"})

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.get("/places/abc123", params={"session_token": VALID_TOKEN})
    assert response.status_code == 502
    assert "internal detail" not in response.text


# --- regression ---


def test_health_still_works(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_search_registered_before_mapbox_id_catchall(client, monkeypatch):
    configure_token()
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append(url)
        return FakeResponse(json_data=suggest_payload())

    monkeypatch.setattr(mapbox.httpx, "get", fake_get)

    response = client.get(
        "/places/search", params={"q": "Empire State", "session_token": VALID_TOKEN}
    )

    # "/places/search" must hit /suggest, not be swallowed by
    # "/places/{mapbox_id}" (which would call /retrieve/search).
    assert response.status_code == 200
    assert calls == [f"{mapbox.SEARCH_BOX_BASE_URL}/suggest"]
