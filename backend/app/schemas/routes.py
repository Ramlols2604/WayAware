from __future__ import annotations

import math
from enum import Enum

from pydantic import BaseModel, field_validator


class RouteMode(str, Enum):
    walking = "walking"
    driving = "driving"


class Coordinates(BaseModel):
    longitude: float
    latitude: float

    @field_validator("longitude")
    @classmethod
    def _validate_longitude(cls, v: float) -> float:
        if not math.isfinite(v):
            raise ValueError("longitude must be a finite number")
        if not -180.0 <= v <= 180.0:
            raise ValueError("longitude must be between -180 and 180")
        return v

    @field_validator("latitude")
    @classmethod
    def _validate_latitude(cls, v: float) -> float:
        if not math.isfinite(v):
            raise ValueError("latitude must be a finite number")
        if not -90.0 <= v <= 90.0:
            raise ValueError("latitude must be between -90 and 90")
        return v


class RouteRequest(BaseModel):
    origin: Coordinates
    destination: Coordinates
    mode: RouteMode


class RouteCandidate(BaseModel):
    geometry: dict
    duration_seconds: float
    distance_meters: float


class RouteResponse(BaseModel):
    routes: list[RouteCandidate]
