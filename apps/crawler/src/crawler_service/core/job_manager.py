"""Job manager for tracking crawl jobs."""

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from crawler_service.config import settings
from crawler_service.models.events import CrawlResult


class JobStatus(str, Enum):
    """Possible job statuses."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class CrawlJob:
    """Represents a crawl job."""

    id: str
    url: str
    limit: int
    max_depth: int
    same_domain: bool
    include_images: bool
    exclude_patterns: list[str]
    include_patterns: list[str]
    status: JobStatus = JobStatus.PENDING
    pages_completed: int = 0
    pages_total: int | None = None
    current_url: str | None = None
    started_at: int | None = None
    completed_at: int | None = None
    error: str | None = None
    result: CrawlResult | None = None
    task: asyncio.Task | None = field(default=None, repr=False)
    event_queue: asyncio.Queue | None = field(default=None, repr=False)
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event, repr=False)

    def to_dict(self) -> dict[str, Any]:
        """Convert job to dictionary for API response."""
        return {
            "id": self.id,
            "status": self.status.value,
            "url": self.url,
            "limit": self.limit,
            "pagesCompleted": self.pages_completed,
            "pagesTotal": self.pages_total,
            "currentUrl": self.current_url,
            "startedAt": self.started_at,
            "completedAt": self.completed_at,
            "error": self.error,
            "result": self.result.model_dump() if self.result else None,
        }


class JobManager:
    """Manages crawl jobs with in-memory storage."""

    def __init__(self):
        self._jobs: dict[str, CrawlJob] = {}
        self._semaphore = asyncio.Semaphore(settings.max_concurrent_crawls)
        self._lock = asyncio.Lock()

    @property
    def active_count(self) -> int:
        """Return count of active (running) jobs."""
        return sum(
            1 for job in self._jobs.values() if job.status == JobStatus.RUNNING
        )

    def create_job(
        self,
        url: str,
        limit: int,
        max_depth: int = 3,
        same_domain: bool = True,
        include_images: bool = True,
        exclude_patterns: list[str] | None = None,
        include_patterns: list[str] | None = None,
    ) -> CrawlJob:
        """Create a new crawl job."""
        job_id = str(uuid.uuid4())
        job = CrawlJob(
            id=job_id,
            url=url,
            limit=limit,
            max_depth=max_depth,
            same_domain=same_domain,
            include_images=include_images,
            exclude_patterns=exclude_patterns or [],
            include_patterns=include_patterns or [],
            event_queue=asyncio.Queue(),
        )
        self._jobs[job_id] = job
        return job

    def get_job(self, job_id: str) -> CrawlJob | None:
        """Get a job by ID."""
        return self._jobs.get(job_id)

    async def start_job(self, job_id: str) -> bool:
        """Mark a job as running."""
        job = self.get_job(job_id)
        if not job or job.status != JobStatus.PENDING:
            return False

        job.status = JobStatus.RUNNING
        job.started_at = int(time.time())
        return True

    async def complete_job(self, job_id: str, result: CrawlResult) -> bool:
        """Mark a job as completed with result."""
        job = self.get_job(job_id)
        if not job:
            return False

        job.status = JobStatus.COMPLETED
        job.completed_at = int(time.time())
        job.result = result
        return True

    async def fail_job(self, job_id: str, error: str) -> bool:
        """Mark a job as failed with error."""
        job = self.get_job(job_id)
        if not job:
            return False

        job.status = JobStatus.FAILED
        job.completed_at = int(time.time())
        job.error = error
        return True

    async def cancel_job(self, job_id: str) -> bool:
        """Cancel a running job."""
        job = self.get_job(job_id)
        if not job:
            return False

        if job.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
            return False

        # Signal cancellation
        job.cancel_event.set()

        # Cancel the task if running
        if job.task and not job.task.done():
            job.task.cancel()

        job.status = JobStatus.CANCELLED
        job.completed_at = int(time.time())
        return True

    def update_progress(
        self,
        job_id: str,
        pages_completed: int,
        pages_total: int | None = None,
        current_url: str | None = None,
    ):
        """Update job progress."""
        job = self.get_job(job_id)
        if job:
            job.pages_completed = pages_completed
            if pages_total is not None:
                job.pages_total = pages_total
            if current_url is not None:
                job.current_url = current_url

    async def acquire_slot(self) -> bool:
        """Acquire a crawl slot (respecting concurrency limit)."""
        return await self._semaphore.acquire()

    def release_slot(self):
        """Release a crawl slot."""
        self._semaphore.release()

    async def cleanup_loop(self):
        """Background task to cleanup expired jobs."""
        while True:
            try:
                await asyncio.sleep(settings.job_cleanup_interval)
                await self._cleanup_expired_jobs()
            except asyncio.CancelledError:
                break
            except Exception:
                # Log error but continue
                pass

    async def _cleanup_expired_jobs(self):
        """Remove jobs that have exceeded TTL."""
        current_time = int(time.time())
        expired_ids = []

        async with self._lock:
            for job_id, job in self._jobs.items():
                # Only cleanup completed/failed/cancelled jobs
                if job.status not in (
                    JobStatus.COMPLETED,
                    JobStatus.FAILED,
                    JobStatus.CANCELLED,
                ):
                    continue

                # Check if job has exceeded TTL
                if job.completed_at and (
                    current_time - job.completed_at > settings.job_ttl_seconds
                ):
                    expired_ids.append(job_id)

            for job_id in expired_ids:
                del self._jobs[job_id]

    async def shutdown(self):
        """Shutdown all running jobs."""
        for job_id in list(self._jobs.keys()):
            job = self._jobs.get(job_id)
            if job and job.status == JobStatus.RUNNING:
                await self.cancel_job(job_id)


# Global job manager instance
job_manager = JobManager()
