"""Request and response models for historical incidents along a route."""

from __future__ import annotations

import math
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MIN_POSITIONS = 2
MAX_POSITIONS = 2000
MAX_RADIUS_M = 200.0
MAX_LIMIT = 200

# NYPD complaint categories loaded into crime_incidents. ky_cd 101, 104, 105,
# 106, 107, 109, and 110 are the seven major felonies in the import.
SELECTED_COMPLAINT_CATEGORIES: tuple[tuple[int, str], ...] = (
    (101, "MURDER & NON-NEGL. MANSLAUGHTER"),
    (104, "RAPE"),
    (105, "ROBBERY"),
    (106, "FELONY ASSAULT"),
    (107, "BURGLARY"),
    (109, "GRAND LARCENY"),
    (110, "GRAND LARCENY OF MOTOR VEHICLE"),
)

COVERAGE_DETAIL = (
    "Coverage includes only the seven selected NYPD complaint categories, "
    "not all crime and not live incidents."
)

TIMESTAMP_QUALITY_DETAIL = (
    "Timestamps from the nypd_complaint import are unverified until the "
    "timestamp repair is confirmed. Quality is not inferred from midnight, "
    "and a non-midnight value is not treated as an actual incident time."
)

AFFECTED_IMPORT_SOURCE = "nypd_complaint"

# June 2006 through June 2026 is 7305 days, inside the 7320-day maximum.
# The incident instant is before the window end and is one of the seven
# imported categories. time_of_day_known stays false even though 14:30 is
# not midnight.
EXAMPLE_REQUEST: dict = {
    "route": {
        "type": "LineString",
        "coordinates": [
            [-73.985858, 40.748196],
            [-73.961607, 40.807877],
        ],
    },
    "radius_m": 50,
    "start": "2006-06-01T00:00:00Z",
    "end": "2026-06-01T00:00:00Z",
    "limit": 100,
}

EXAMPLE_INCIDENT: dict = {
    "source": AFFECTED_IMPORT_SOURCE,
    "source_id": "326096311",
    "ky_cd": 109,
    "ofns_desc": "GRAND LARCENY",
    "pd_desc": "LARCENY,GRAND FROM VEHICLE, UNATTENDED",
    "law_cat_cd": "FELONY",
    "stored_occurred_at": "2026-05-15T14:30:00Z",
    "time_of_day_known": False,
    "distance_m": 18.4,
    "latitude": 40.752,
    "longitude": -73.981,
}


def _aware(value: datetime, field_name: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must include a timezone")


class LineStringRoute(BaseModel):
    type: Literal["LineString"]
    coordinates: list[list[float]]

    @field_validator("coordinates")
    @classmethod
    def _validate_coordinates(cls, coordinates: list[list[float]]) -> list[list[float]]:
        count = len(coordinates)
        if count < MIN_POSITIONS or count > MAX_POSITIONS:
            raise ValueError(
                f"route must contain {MIN_POSITIONS} to {MAX_POSITIONS} "
                "coordinate pairs"
            )
        distinct: set[tuple[float, float]] = set()
        for pair in coordinates:
            if len(pair) != 2:
                raise ValueError("each position must be a longitude, latitude pair")
            longitude, latitude = pair
            if not math.isfinite(longitude) or not math.isfinite(latitude):
                raise ValueError("coordinates must be finite")
            if not -180.0 <= longitude <= 180.0:
                raise ValueError("longitude must be between -180 and 180")
            if not -90.0 <= latitude <= 90.0:
                raise ValueError("latitude must be between -90 and 90")
            distinct.add((longitude, latitude))
        if len(distinct) < 2:
            raise ValueError("route must contain at least two distinct points")
        return coordinates


class AlongRouteRequest(BaseModel):
    route: LineStringRoute
    radius_m: float = Field(default=50, gt=0, le=MAX_RADIUS_M)
    start: datetime
    end: datetime
    limit: int = Field(default=100, ge=1, le=MAX_LIMIT)

    model_config = ConfigDict(json_schema_extra={"examples": [EXAMPLE_REQUEST]})

    @model_validator(mode="after")
    def _validate_window(self) -> AlongRouteRequest:
        _aware(self.start, "start")
        _aware(self.end, "end")
        if self.start >= self.end:
            raise ValueError("start must be before end")
        return self


class CrimeCategory(BaseModel):
    ky_cd: int
    ofns_desc: str


class Coverage(BaseModel):
    categories: list[CrimeCategory]
    detail: str


class TimestampQuality(BaseModel):
    time_of_day: Literal["unverified"]
    detail: str


class CrimeWindow(BaseModel):
    start: datetime
    end: datetime


class RouteIncident(BaseModel):
    source: str
    source_id: str
    ky_cd: int
    ofns_desc: str | None
    pd_desc: str | None
    law_cat_cd: str | None
    stored_occurred_at: datetime
    time_of_day_known: bool
    distance_m: float
    latitude: float
    longitude: float


class RouteExposureRequest(BaseModel):
    route: LineStringRoute
    radius_m: float = Field(default=50, gt=0, le=MAX_RADIUS_M)
    start: datetime
    end: datetime

    @model_validator(mode="after")
    def _validate_window(self) -> RouteExposureRequest:
        _aware(self.start, "start")
        _aware(self.end, "end")
        if self.start >= self.end:
            raise ValueError("start must be before end")
        return self


ExposureLevel = Literal["lower", "moderate", "higher"]


class ExposureCategoryCount(BaseModel):
    ky_cd: int
    ofns_desc: str
    count: int = Field(ge=0)


class ExposureSegment(BaseModel):
    id: str
    geometry: LineStringRoute
    length_m: float = Field(gt=0)
    level: ExposureLevel
    total_count: int = Field(ge=0)
    categories: list[ExposureCategoryCount]


class RouteExposureResponse(BaseModel):
    assessment_status: Literal["assessed"]
    window: CrimeWindow
    radius_m: float
    coverage: Coverage
    segments: list[ExposureSegment]
    route_categories: list[ExposureCategoryCount]


class AlongRouteResponse(BaseModel):
    window: CrimeWindow
    radius_m: float
    limit: int
    returned: int
    truncated: bool
    coverage: Coverage
    timestamp_quality: TimestampQuality
    incidents: list[RouteIncident]

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "window": {
                        "start": EXAMPLE_REQUEST["start"],
                        "end": EXAMPLE_REQUEST["end"],
                    },
                    "radius_m": EXAMPLE_REQUEST["radius_m"],
                    "limit": EXAMPLE_REQUEST["limit"],
                    "returned": 1,
                    "truncated": False,
                    "coverage": {
                        "categories": [
                            {"ky_cd": ky_cd, "ofns_desc": description}
                            for ky_cd, description in SELECTED_COMPLAINT_CATEGORIES
                        ],
                        "detail": COVERAGE_DETAIL,
                    },
                    "timestamp_quality": {
                        "time_of_day": "unverified",
                        "detail": TIMESTAMP_QUALITY_DETAIL,
                    },
                    "incidents": [EXAMPLE_INCIDENT],
                }
            ]
        }
    )
