"""API routes for crawler service."""

import asyncio
import secrets

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Header
from sse_starlette.sse import EventSourceResponse

from crawler_service.api.schemas import (
    CrawlRequest,
    CrawlStartResponse,
    CrawlStatusResponse,
    CrawlCancelResponse,
    ErrorResponse,
    JobStatus,
    DiscoverRequest,
    DiscoverResponse,
    CrawlPagesRequest,
    CrawlPagesStartResponse,
    SearchRequest,
    SearchResponse,
)
from crawler_service.config import settings
from crawler_service.core.crawler import execute_crawl, execute_selective_crawl
from crawler_service.core.discovery import discover_pages
from crawler_service.core.search import search_web
from crawler_service.core.job_manager import job_manager, JobStatus as JobStatusEnum
from crawler_service.core.sse_emitter import stream_events


async def require_api_key(x_api_key: str | None = Header(default=None)):
    """Require the X-API-Key header when CRAWLER_API_KEY is configured.

    When CRAWLER_API_KEY is unset the service runs in open mode (local dev
    default) and requests are allowed through — a warning is logged at
    startup. Set CRAWLER_API_KEY in any shared deployment.
    """
    if not settings.crawler_api_key:
        return
    if not x_api_key or not secrets.compare_digest(
        x_api_key, settings.crawler_api_key
    ):
        raise HTTPException(status_code=401, detail="Missing or invalid API key")


router = APIRouter(
    prefix="/crawl", tags=["crawl"], dependencies=[Depends(require_api_key)]
)


@router.post(
    "",
    response_model=CrawlStartResponse,
    responses={
        429: {"model": ErrorResponse, "description": "Too many concurrent crawls"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def start_crawl(
    request: CrawlRequest,
    background_tasks: BackgroundTasks,
):
    """Start a new crawl job.

    Returns a job ID that can be used to track progress via SSE or polling.
    """
    # Acquire a concurrency slot BEFORE creating anything. Starting a job
    # without holding a slot — and releasing one on completion — would inflate
    # the semaphore and make the concurrent-browser limit meaningless.
    try:
        acquired = await asyncio.wait_for(
            job_manager.acquire_slot(),
            timeout=0.1,  # Don't wait, just check
        )
    except asyncio.TimeoutError:
        acquired = False

    if not acquired:
        raise HTTPException(
            status_code=429,
            detail="Too many concurrent crawls. Please try again later.",
        )

    # Create the job
    job = job_manager.create_job(
        url=str(request.url),
        limit=request.limit,
        max_depth=request.maxDepth,
        same_domain=request.sameDomain,
        include_images=request.includeImages,
        exclude_patterns=request.excludePatterns,
        include_patterns=request.includePatterns,
    )

    # Start the job
    await job_manager.start_job(job.id)

    # Create background task. The slot is released only here, i.e. only when
    # it was actually acquired above.
    async def run_crawl():
        try:
            await asyncio.wait_for(execute_crawl(job), timeout=settings.crawl_timeout)
        except asyncio.TimeoutError:
            await job_manager.fail_job(job.id, "Crawler job timed out")
        finally:
            job_manager.release_slot()

    # Store task reference
    job.task = asyncio.create_task(run_crawl())

    return CrawlStartResponse(
        success=True,
        id=job.id,
        message="Crawl started",
    )


@router.get(
    "/{job_id}",
    response_model=CrawlStatusResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Job not found"},
    },
)
async def get_crawl_status(job_id: str):
    """Get the status of a crawl job.

    Use this endpoint for polling-based status checks.
    For real-time updates, use the /stream endpoint instead.
    """
    job = job_manager.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return CrawlStatusResponse(
        id=job.id,
        status=JobStatus(job.status.value),
        url=job.url,
        limit=job.limit,
        pagesCompleted=job.pages_completed,
        pagesTotal=job.pages_total,
        currentUrl=job.current_url,
        startedAt=job.started_at,
        completedAt=job.completed_at,
        error=job.error,
        result=job.result.model_dump() if job.result else None,
    )


@router.get(
    "/{job_id}/stream",
    responses={
        404: {"model": ErrorResponse, "description": "Job not found"},
    },
)
async def stream_crawl_events(job_id: str):
    """Stream crawl events in real-time using SSE.

    Returns a Server-Sent Events stream with progress updates.

    Event types:
    - started: Crawl has begun
    - progress: Page count update
    - page_crawled: Individual page completed
    - metric: Metric value update
    - warning: Non-fatal issue encountered
    - error: Fatal error occurred
    - completed: Crawl finished successfully
    - cancelled: Crawl was cancelled
    - heartbeat: Keep-alive ping
    """
    job = job_manager.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # If job is already complete, return status instead of streaming
    if job.status in (
        JobStatusEnum.COMPLETED,
        JobStatusEnum.FAILED,
        JobStatusEnum.CANCELLED,
    ):
        # Return a single completed/error event
        async def completed_stream():
            if job.status == JobStatusEnum.COMPLETED and job.result:
                from crawler_service.models.events import CompletedEvent
                event = CompletedEvent(result=job.result)
                yield {"data": event.model_dump_json()}
            elif job.status == JobStatusEnum.FAILED:
                from crawler_service.models.events import ErrorEvent
                event = ErrorEvent(message=job.error or "Unknown error")
                yield {"data": event.model_dump_json()}
            else:
                from crawler_service.models.events import CancelledEvent
                event = CancelledEvent(pagesCompleted=job.pages_completed)
                yield {"data": event.model_dump_json()}

        return EventSourceResponse(completed_stream())

    # Stream live events
    async def event_generator():
        async for event_str in stream_events(job):
            # sse-starlette expects data without the "data: " prefix
            yield {"data": event_str.replace("data: ", "").strip()}

    return EventSourceResponse(event_generator())


@router.delete(
    "/{job_id}",
    response_model=CrawlCancelResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Job not found"},
        400: {"model": ErrorResponse, "description": "Job cannot be cancelled"},
    },
)
async def cancel_crawl(job_id: str):
    """Cancel a running crawl job.

    Only pending or running jobs can be cancelled.
    """
    job = job_manager.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    success = await job_manager.cancel_job(job_id)

    if not success:
        raise HTTPException(
            status_code=400,
            detail="Job cannot be cancelled (already completed or failed)",
        )

    return CrawlCancelResponse(
        success=True,
        message="Crawl cancelled",
    )


# === Discovery Endpoints ===


@router.post(
    "/discover",
    response_model=DiscoverResponse,
    responses={
        500: {"model": ErrorResponse, "description": "Discovery failed"},
    },
)
async def discover_site(request: DiscoverRequest):
    """Discover all pages on a website without extracting content.

    This is a fast operation that only finds links. Use this to let users
    select which pages to crawl before starting the full crawl.

    Returns a list of discovered pages with their URLs and titles.
    """
    try:
        pages, duration = await asyncio.wait_for(
            discover_pages(
                url=str(request.url),
                max_pages=request.maxPages,
                max_depth=request.maxDepth,
                same_domain=request.sameDomain,
                exclude_patterns=request.excludePatterns,
                include_patterns=request.includePatterns,
            ),
            timeout=settings.crawl_timeout,
        )

        return DiscoverResponse(
            success=True,
            url=str(request.url),
            pages=pages,
            totalFound=len(pages),
            duration=duration,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/pages",
    response_model=CrawlPagesStartResponse,
    responses={
        429: {"model": ErrorResponse, "description": "Too many concurrent crawls"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def crawl_selected_pages(request: CrawlPagesRequest):
    """Crawl a specific list of URLs (selective crawl).

    Use this after discovery to crawl only the pages the user selected.
    Returns a job ID for tracking progress.
    """
    urls = [str(u) for u in request.urls]

    # Acquire a concurrency slot BEFORE creating anything — same rule as
    # /crawl: no slot, no job, and release_slot() is only called for slots
    # that were actually acquired.
    try:
        acquired = await asyncio.wait_for(
            job_manager.acquire_slot(),
            timeout=0.1,
        )
    except asyncio.TimeoutError:
        acquired = False

    if not acquired:
        raise HTTPException(
            status_code=429,
            detail="Too many concurrent crawls. Please try again later.",
        )

    # Create job for selective crawl
    job = job_manager.create_job(
        url=urls[0],  # First URL as reference
        limit=len(urls),
        max_depth=1,  # Not relevant for selective crawl
        same_domain=False,  # We already have the URLs
        include_images=request.includeImages,
        exclude_patterns=[],
        include_patterns=[],
    )

    # Start the job
    await job_manager.start_job(job.id)

    # Create background task for selective crawl
    async def run_selective_crawl():
        try:
            await asyncio.wait_for(
                execute_selective_crawl(job, urls),
                timeout=settings.crawl_timeout,
            )
        except asyncio.TimeoutError:
            await job_manager.fail_job(job.id, "Crawler job timed out")
        finally:
            job_manager.release_slot()

    job.task = asyncio.create_task(run_selective_crawl())

    return CrawlPagesStartResponse(
        success=True,
        id=job.id,
        urlCount=len(urls),
        message=f"Crawling {len(urls)} selected pages",
    )


# === Web Search Endpoint ===


@router.post(
    "/search",
    response_model=SearchResponse,
    responses={
        500: {"model": ErrorResponse, "description": "Search failed"},
    },
)
async def web_search(request: SearchRequest):
    """Search with private SearXNG and a controlled DuckDuckGo fallback."""
    import time

    start = time.time()
    try:
        results, provider, errors = await search_web(
            query=request.query,
            limit=request.limit,
            search_depth=request.searchDepth,
        )

        duration = time.time() - start
        return SearchResponse(
            success=True,
            query=request.query,
            results=results,
            totalResults=len(results),
            duration=round(duration, 3),
            provider=provider,
            correlationId=request.correlationId,
            errors=errors,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
