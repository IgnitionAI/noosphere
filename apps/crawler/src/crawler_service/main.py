"""FastAPI application for the crawler microservice."""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from crawler_service.api.routes import router
from crawler_service.config import settings
from crawler_service.core.job_manager import job_manager

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan: startup and shutdown."""
    if not settings.crawler_api_key and settings.environment != "development":
        raise RuntimeError("CRAWLER_API_KEY is required outside development")
    if not settings.crawler_api_key:
        logger.warning(
            "CRAWLER_API_KEY is not set: the crawler service accepts "
            "unauthenticated requests (open mode, intended for local dev "
            "only). Set CRAWLER_API_KEY in any shared deployment and keep "
            "the port bound to localhost or a private network."
        )

    # Startup: initialize crawler and start cleanup task
    cleanup_task = asyncio.create_task(job_manager.cleanup_loop())

    yield

    # Shutdown: cancel cleanup task and cleanup resources
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass

    # Cancel all running jobs
    await job_manager.shutdown()


app = FastAPI(
    title="Ignition Outbound Crawler",
    description="Private Crawl4AI/SearXNG web research service",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware. The Bun backend calls this service server-to-server (CORS
# does not apply); origins are restricted to CORS_ORIGINS (default: localhost)
# and credentials are disabled.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in settings.cors_origins.split(",")
        if origin.strip()
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(router)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "crawler-service",
        "version": "0.1.0",
        "active_jobs": job_manager.active_count,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "crawler_service.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
