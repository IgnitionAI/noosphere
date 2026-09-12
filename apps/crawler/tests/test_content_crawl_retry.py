"""Bounded retries must never duplicate a crawl whose outcome is still pending."""
import asyncio
import pytest
from crawler_service.core.job_manager import JobManager, JobStatus
from crawler_service.models.events import CrawlResult, CrawledPage
from crawler_service.api.schemas import CrawlPagesRequest
from crawler_service.api import routes


def create(manager, **kwargs):
    return manager.create_job(url="https://example.com/source", limit=1, idempotency_key="editorial-source-key", **kwargs)


def test_retries_confirmed_failures_but_retains_their_history_and_bounds_attempts():
    manager = JobManager()
    previous = create(manager)
    for _ in range(2):
        previous.status = JobStatus.FAILED
        assert create(manager).id == previous.id
        current = create(manager, retry_failed=True)
        assert current.id != previous.id
        assert manager.get_job(previous.id) is previous
        previous = current
    previous.status = JobStatus.FAILED
    assert create(manager, retry_failed=True).id == previous.id


@pytest.mark.parametrize("status", [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.CANCELLED])
def test_does_not_duplicate_pending_work_or_override_cancellation(status):
    manager = JobManager()
    job = create(manager)
    job.status = status
    assert create(manager, retry_failed=True).id == job.id


def test_completed_empty_extraction_can_retry_but_successful_content_is_retained():
    manager = JobManager()
    job = create(manager)
    job.status = JobStatus.COMPLETED
    job.result = CrawlResult(pagesCount=0, data=[], errors=["extraction failed"], duration=1)
    successful = create(manager, retry_failed=True)
    assert successful.id != job.id
    successful.status = JobStatus.COMPLETED
    successful.result = CrawlResult(pagesCount=1, data=[CrawledPage(url=successful.url, markdown="Read content")], errors=[], duration=1)
    assert create(manager, retry_failed=True).id == successful.id


@pytest.mark.asyncio
async def test_selective_endpoint_retries_a_failed_job_and_reuses_the_live_retry(monkeypatch):
    manager = JobManager()
    failed = create(manager)
    failed.status = JobStatus.FAILED
    monkeypatch.setattr(routes, "job_manager", manager)
    waiting = asyncio.Event()
    async def execute(job, urls):
        await waiting.wait()
    monkeypatch.setattr(routes, "execute_selective_crawl", execute)
    request = CrawlPagesRequest(urls=["https://example.com/source"], idempotencyKey="editorial-source-key", retryFailed=True)
    first = await routes.crawl_selected_pages(request)
    try:
        assert first.id != failed.id
        second = await routes.crawl_selected_pages(request)
        assert second.id == first.id
    finally:
        job = manager.get_job(first.id)
        if job.task:
            job.task.cancel()
            await asyncio.gather(job.task, return_exceptions=True)


@pytest.mark.asyncio
async def test_simultaneous_failed_retries_schedule_only_one_replacement(monkeypatch):
    manager = JobManager()
    failed = create(manager)
    failed.status = JobStatus.FAILED
    monkeypatch.setattr(routes, "job_manager", manager)
    entered = 0
    released = 0
    executions = 0
    barrier = asyncio.Event()
    waiting = asyncio.Event()

    async def acquire():
        nonlocal entered
        entered += 1
        if entered == 2:
            barrier.set()
        await barrier.wait()
        return True

    def release():
        nonlocal released
        released += 1

    async def execute(job, urls):
        nonlocal executions
        executions += 1
        await waiting.wait()

    monkeypatch.setattr(manager, "acquire_slot", acquire)
    monkeypatch.setattr(manager, "release_slot", release)
    monkeypatch.setattr(routes, "execute_selective_crawl", execute)
    request = CrawlPagesRequest(urls=["https://example.com/source"], idempotencyKey="editorial-source-key", retryFailed=True)
    first, second = await asyncio.gather(routes.crawl_selected_pages(request), routes.crawl_selected_pages(request))
    await asyncio.sleep(0)
    try:
        assert first.id == second.id
        assert first.id != failed.id
        assert executions == 1
        assert released == 1
    finally:
        task = manager.get_job(first.id).task
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    assert released == 2
