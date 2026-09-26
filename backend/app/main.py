import math
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.routers.health import router as health_router
from app.routers.places import router as places_router
from app.routers.routes import router as routes_router

app = FastAPI()
app.include_router(health_router)
app.include_router(places_router)
app.include_router(routes_router)


def _sanitize_non_finite_floats(value: Any) -> Any:
    # Starlette's JSONResponse renders with allow_nan=False (strict JSON), so
    # a validation error that echoes a client-supplied inf/nan value back in
    # its "input" field would otherwise crash the response with an unhandled
    # ValueError instead of returning 422.
    if isinstance(value, float) and not math.isfinite(value):
        return repr(value)
    if isinstance(value, dict):
        return {k: _sanitize_non_finite_floats(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize_non_finite_floats(v) for v in value]
    return value


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=_sanitize_non_finite_floats(jsonable_encoder(exc.errors())),
    )
