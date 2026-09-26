import logging

from fastapi import APIRouter, Depends, HTTPException

from app.application.routes import (
    RoutesConfigurationError,
    RoutesProviderError,
    plan_route,
)
from app.config import Settings, get_settings
from app.schemas.routes import RouteCandidate, RouteRequest, RouteResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/routes", tags=["routes"])


@router.post("", response_model=RouteResponse)
def create_route(
    request: RouteRequest,
    settings: Settings = Depends(get_settings),
) -> RouteResponse:
    try:
        result = plan_route(
            request.origin,
            request.destination,
            request.mode,
            settings.mapbox_access_token,
        )
    except RoutesConfigurationError as exc:
        raise HTTPException(
            status_code=503, detail="Route planning is not configured"
        ) from exc
    except RoutesProviderError as exc:
        logger.warning("Mapbox directions failed: %s", exc)
        raise HTTPException(
            status_code=502, detail="Route planning provider failed"
        ) from exc

    return RouteResponse(
        routes=[
            RouteCandidate(
                geometry=r.geometry,
                duration_seconds=r.duration_seconds,
                distance_meters=r.distance_meters,
            )
            for r in result.routes
        ]
    )
