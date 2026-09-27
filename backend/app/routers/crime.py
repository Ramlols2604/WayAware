import logging

from fastapi import APIRouter, Depends, HTTPException

from app.application.crime import (
    CrimeConfigurationError,
    InvalidCrimeQuery,
    incidents_along_route,
)
from app.config import Settings, get_settings
from app.db.crime import CrimeDatabaseError
from app.schemas.crime import AlongRouteRequest, AlongRouteResponse

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
