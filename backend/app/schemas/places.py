from pydantic import BaseModel


class PlaceSuggestion(BaseModel):
    mapbox_id: str
    name: str
    place_formatted: str | None = None
    full_address: str | None = None
    feature_type: str | None = None


class SearchResponse(BaseModel):
    suggestions: list[PlaceSuggestion]
    attribution: str


class PlaceDetail(BaseModel):
    mapbox_id: str
    name: str
    full_address: str | None = None
    feature_type: str | None = None
    longitude: float
    latitude: float


class RetrieveResponse(BaseModel):
    place: PlaceDetail
    attribution: str
