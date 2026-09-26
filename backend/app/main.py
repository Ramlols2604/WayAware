from fastapi import FastAPI

from app.routers.health import router as health_router
from app.routers.places import router as places_router

app = FastAPI()
app.include_router(health_router)
app.include_router(places_router)
