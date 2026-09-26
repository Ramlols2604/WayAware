import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from app.application.places import (
    InvalidPlacesQuery,
    PlaceNotFound,
    PlacesConfigurationError,
    PlacesProviderError,
    retrieve_place,
    search_places,
)
from app.config import Settings, get_settings
from app.schemas.places import (
    PlaceDetail,
    PlaceSuggestion,
    RetrieveResponse,
    SearchResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/places", tags=["places"])


# Registered before /{mapbox_id} so "search" is never matched as a mapbox_id.
@router.get("/search", response_model=SearchResponse)
def search(
    q: str = Query(...),
    session_token: str = Query(...),
    settings: Settings = Depends(get_settings),
) -> SearchResponse:
    try:
        result = search_places(q, session_token, settings.mapbox_access_token)
    except PlacesConfigurationError as exc:
        raise HTTPException(
            status_code=503, detail="Place search is not configured"
        ) from exc
    except InvalidPlacesQuery as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except PlacesProviderError as exc:
        logger.warning("Mapbox suggest failed: %s", exc)
        raise HTTPException(
            status_code=502, detail="Place search provider failed"
        ) from exc

    return SearchResponse(
        suggestions=[
            PlaceSuggestion(
                mapbox_id=s.mapbox_id,
                name=s.name,
                place_formatted=s.place_formatted,
                full_address=s.full_address,
                feature_type=s.feature_type,
            )
            for s in result.suggestions
        ],
        attribution=result.attribution,
    )


@router.get("/{mapbox_id}", response_model=RetrieveResponse)
def retrieve(
    mapbox_id: str,
    session_token: str = Query(...),
    settings: Settings = Depends(get_settings),
) -> RetrieveResponse:
    try:
        result = retrieve_place(mapbox_id, session_token, settings.mapbox_access_token)
    except PlacesConfigurationError as exc:
        raise HTTPException(
            status_code=503, detail="Place search is not configured"
        ) from exc
    except InvalidPlacesQuery as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except PlaceNotFound as exc:
        raise HTTPException(status_code=404, detail="Place not found") from exc
    except PlacesProviderError as exc:
        logger.warning("Mapbox retrieve failed: %s", exc)
        raise HTTPException(
            status_code=502, detail="Place lookup provider failed"
        ) from exc

    return RetrieveResponse(
        place=PlaceDetail(
            mapbox_id=result.place.mapbox_id,
            name=result.place.name,
            full_address=result.place.full_address,
            feature_type=result.place.feature_type,
            longitude=result.place.longitude,
            latitude=result.place.latitude,
        ),
        attribution=result.attribution,
    )
