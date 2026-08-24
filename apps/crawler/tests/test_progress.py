"""Regression tests for crawler job progress projections."""

from types import SimpleNamespace

import pytest

from crawler_service.config import settings
from crawler_service.core import crawler as crawler_module
from crawler_service.core.crawler import execute_crawl, execute_selective_crawl
from crawler_service.core.job_manager import JobStatus, job_manager


PUBLIC_URL = "http://93.184.216.34/page"


class StubCrawler:
    async def arun(self, url, config=None):
        return SimpleNamespace(
            success=True,
            error_message=None,
            redirected_url=None,
            markdown="public content",
            html="<html><head><title>Example</title></head></html>",
            media={},
            links={},
        )


class StubAsyncWebCrawler:
    def __init__(self, *args, **kwargs):
        self.crawler = StubCrawler()

    async def __aenter__(self):
        return self.crawler

    async def __aexit__(self, *_args):
        return None


class FailingAsyncWebCrawler(StubAsyncWebCrawler):
    def __init__(self, *args, **kwargs):
        self.crawler = SimpleNamespace(
            arun=self._arun,
        )

    async def _arun(self, url, config=None):
        return SimpleNamespace(
            success=False,
            error_message="upstream unavailable",
            redirected_url=None,
            markdown="",
            html="",
            media={},
            links={},
        )


def make_job(url: str = PUBLIC_URL):
    return job_manager.create_job(
        url=url,
        limit=1,
        max_depth=0,
        same_domain=False,
        include_images=False,
    )


async def run_and_cleanup(job, runner):
    await job_manager.start_job(job.id)
    try:
        await runner(job)
    finally:
        job_manager._jobs.pop(job.id, None)


@pytest.fixture(autouse=True)
def stub_browser_and_network(monkeypatch):
    monkeypatch.setattr(crawler_module, "AsyncWebCrawler", StubAsyncWebCrawler)
    monkeypatch.setattr(crawler_module, "configure_safe_crawler", lambda _crawler: None)
    monkeypatch.setattr(crawler_module, "is_url_allowed_async", lambda _url: _allowed())
    monkeypatch.setattr(settings, "rate_limit_delay", 0)


async def _allowed():
    return True


@pytest.mark.asyncio
async def test_selective_crawl_reports_successfully_completed_pages():
    job = make_job()

    await run_and_cleanup(
        job,
        lambda current: execute_selective_crawl(current, [PUBLIC_URL]),
    )

    assert job.status is JobStatus.COMPLETED
    assert job.pages_completed == 1
    assert job.to_dict()["pagesCompleted"] == 1
    assert job.result is not None
    assert job.result.pagesCount == 1


@pytest.mark.asyncio
async def test_regular_crawl_reports_successfully_completed_pages():
    job = make_job()

    await run_and_cleanup(job, execute_crawl)

    assert job.status is JobStatus.COMPLETED
    assert job.pages_completed == 1
    assert job.to_dict()["pagesCompleted"] == 1
    assert job.result is not None
    assert job.result.pagesCount == 1


@pytest.mark.asyncio
async def test_failed_selective_page_is_not_counted_as_completed(monkeypatch):
    monkeypatch.setattr(crawler_module, "AsyncWebCrawler", FailingAsyncWebCrawler)
    job = make_job()

    await run_and_cleanup(
        job,
        lambda current: execute_selective_crawl(current, [PUBLIC_URL]),
    )

    assert job.status is JobStatus.COMPLETED
    assert job.pages_completed == 0
    assert job.result is not None
    assert job.result.pagesCount == 0
    assert job.result.errors
