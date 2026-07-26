"""SSE event emitter for streaming crawl progress."""

import asyncio
import json
from typing import AsyncGenerator

from crawler_service.config import settings
from crawler_service.core.job_manager import CrawlJob, JobStatus
from crawler_service.models.events import (
    BaseEvent,
    CompletedEvent,
    CancelledEvent,
    ErrorEvent,
    HeartbeatEvent,
    MetricEvent,
    PageCrawledEvent,
    ProgressEvent,
    StartedEvent,
    WarningEvent,
)


class SSEEmitter:
    """Emits Server-Sent Events for a crawl job."""

    def __init__(self, job: CrawlJob):
        self.job = job
        self._queue = job.event_queue

    async def emit(self, event: BaseEvent):
        """Emit an event to the queue."""
        if self._queue:
            await self._queue.put(event)

    async def emit_started(self, metadata: dict | None = None):
        """Emit started event."""
        await self.emit(
            StartedEvent(
                metadata=metadata or {"url": self.job.url, "limit": self.job.limit}
            )
        )

    async def emit_progress(self, current: int, total: int, current_url: str):
        """Emit progress event."""
        await self.emit(
            ProgressEvent(current=current, total=total, currentUrl=current_url)
        )

    async def emit_page_crawled(
        self,
        url: str,
        title: str | None = None,
        content_length: int = 0,
        images_count: int = 0,
    ):
        """Emit page crawled event."""
        await self.emit(
            PageCrawledEvent(
                url=url,
                title=title,
                contentLength=content_length,
                imagesCount=images_count,
            )
        )

    async def emit_metric(self, key: str, value: int | float):
        """Emit metric event."""
        await self.emit(MetricEvent(key=key, value=value))

    async def emit_warning(self, message: str, url: str | None = None):
        """Emit warning event."""
        await self.emit(WarningEvent(message=message, url=url))

    async def emit_error(self, message: str, url: str | None = None):
        """Emit error event."""
        await self.emit(ErrorEvent(message=message, url=url))

    async def emit_completed(self, result):
        """Emit completed event with result."""
        await self.emit(CompletedEvent(result=result))

    async def emit_cancelled(self, pages_completed: int = 0):
        """Emit cancelled event."""
        await self.emit(CancelledEvent(pagesCompleted=pages_completed))

    async def close(self):
        """Signal end of stream."""
        if self._queue:
            await self._queue.put(None)


async def stream_events(job: CrawlJob) -> AsyncGenerator[str, None]:
    """Generate SSE events from job queue.

    Yields SSE-formatted strings for each event.
    """
    queue = job.event_queue
    if not queue:
        return

    heartbeat_task = asyncio.create_task(_heartbeat_sender(queue))

    try:
        while True:
            try:
                # Wait for event with timeout for heartbeat
                event = await asyncio.wait_for(
                    queue.get(), timeout=settings.sse_heartbeat_interval
                )

                # None signals end of stream
                if event is None:
                    break

                # Format as SSE
                yield _format_sse(event)

                # Check if this is a terminal event
                if isinstance(
                    event, (CompletedEvent, CancelledEvent, ErrorEvent)
                ) and isinstance(event, (CompletedEvent, CancelledEvent)):
                    break

            except asyncio.TimeoutError:
                # Send heartbeat on timeout
                yield _format_sse(HeartbeatEvent())

            # Check if job is no longer running
            if job.status not in (JobStatus.PENDING, JobStatus.RUNNING):
                break

    finally:
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass


async def _heartbeat_sender(queue: asyncio.Queue):
    """Send periodic heartbeats to keep connection alive."""
    try:
        while True:
            await asyncio.sleep(settings.sse_heartbeat_interval)
            await queue.put(HeartbeatEvent())
    except asyncio.CancelledError:
        pass


def _format_sse(event: BaseEvent) -> str:
    """Format an event as SSE data."""
    data = event.model_dump_json()
    return f"data: {data}\n\n"
