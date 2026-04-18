from fastapi import APIRouter

from app.api.routes import auth, deployments, health, uploads, stuff

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(stuff.router, prefix="/stuff", tags=["stuff"])
api_router.include_router(auth.router)
api_router.include_router(uploads.router)
api_router.include_router(deployments.router)
