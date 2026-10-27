from fastapi import APIRouter

from app.api import cluster, connections, health, import_export, queries


def build_api_router() -> APIRouter:
    router = APIRouter(prefix="/api")
    router.include_router(health.router)
    router.include_router(connections.router)
    router.include_router(cluster.router)
    router.include_router(queries.router)
    router.include_router(import_export.router)
    return router
