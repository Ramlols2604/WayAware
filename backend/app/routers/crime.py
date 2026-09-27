import logging

from fastapi import APIRouter, Depends, HTTPException

from app.application.crime import (
    CrimeConfigurationError,
    InvalidCrimeQuery,
    incidents_along_route,
)
from app.application.exposure import assess_route
from app.config import Settings, get_settings
from app.db.crime import CrimeDatabaseError
from app.schemas.crime import (
    AlongRouteRequest,
    AlongRouteResponse,
    RouteExposureRequest,
    RouteExposureResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/crime", tags=["crime"])


@router.post("/along-route", response_model=AlongRouteResponse)
def along_route(
    request: AlongRouteRequest,
    settings: Settings = Depends(get_settings),
) -> AlongRouteResponse:
    """Return a capped list of imported complaints along a route.

    The list is for display and evidence. It is not a complete aggregate
    and must not be used for scoring.
    """
    try:
        return incidents_along_route(
            request,
            database_url=settings.database_url,
            earliest=settings.crime_earliest_occurred_at,
            max_window_days=settings.crime_max_window_days,
        )
    except CrimeConfigurationError as exc:
        raise HTTPException(
            status_code=503, detail="Historical incidents are not configured"
        ) from exc
    except InvalidCrimeQuery as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except CrimeDatabaseError as exc:
        logger.warning("Historical incident query failed")
        raise HTTPException(
            status_code=502, detail="Historical incident query failed"
        ) from exc


@router.post("/route-exposure", response_model=RouteExposureResponse)
def route_exposure(
    request: RouteExposureRequest,
    settings: Settings = Depends(get_settings),
) -> RouteExposureResponse:
    """Color the full route from every matching complaint in the corridor.

    The response is one complete assessment. A database failure does not
    return gray segments or zero counts.
    """
    try:
        return assess_route(
            request,
            database_url=settings.database_url,
            earliest=settings.crime_earliest_occurred_at,
            max_window_days=settings.crime_max_window_days,
        )
    except CrimeConfigurationError as exc:
        raise HTTPException(
            status_code=503, detail="Historical incidents are not configured"
        ) from exc
    except InvalidCrimeQuery as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except CrimeDatabaseError as exc:
        logger.warning("Historical exposure query failed")
        raise HTTPException(
            status_code=502, detail="Historical incident query failed"
        ) from exc
