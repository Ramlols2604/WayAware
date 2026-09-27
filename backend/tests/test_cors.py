from fastapi.testclient import TestClient

from app.main import app

FRONTEND_ORIGIN = "http://localhost:8443"


def test_routes_preflight_allows_frontend_origin_and_content_type():
    with TestClient(app) as client:
        response = client.options(
            "/routes",
            headers={
                "Origin": FRONTEND_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == FRONTEND_ORIGIN
    assert "POST" in response.headers["access-control-allow-methods"]
    assert "content-type" in response.headers["access-control-allow-headers"].lower()
    # Credentials must stay disabled: no session cookies are used, and this
    # header must never be present alongside a non-wildcard origin unless a
    # credentialed flow is deliberately supported.
    assert "access-control-allow-credentials" not in response.headers


def test_crime_along_route_preflight_allows_frontend_origin_and_content_type():
    with TestClient(app) as client:
        response = client.options(
            "/crime/along-route",
            headers={
                "Origin": FRONTEND_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == FRONTEND_ORIGIN
    assert "POST" in response.headers["access-control-allow-methods"]
    assert "content-type" in response.headers["access-control-allow-headers"].lower()
    assert "access-control-allow-credentials" not in response.headers


def test_places_search_preflight_allows_frontend_origin():
    with TestClient(app) as client:
        response = client.options(
            "/places/search",
            headers={
                "Origin": FRONTEND_ORIGIN,
                "Access-Control-Request-Method": "GET",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == FRONTEND_ORIGIN


def test_actual_request_from_frontend_origin_gets_cors_header():
    with TestClient(app) as client:
        response = client.get("/health", headers={"Origin": FRONTEND_ORIGIN})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == FRONTEND_ORIGIN


def test_disallowed_origin_does_not_get_cors_header():
    with TestClient(app) as client:
        response = client.get("/health", headers={"Origin": "http://evil.example"})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers
