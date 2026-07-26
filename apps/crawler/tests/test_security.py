"""Regression tests for the crawler-service security hardening.

Covers:
- SSRF guard on all three engines (CrawlerEngine, SelectiveCrawlerEngine,
  DiscoveryEngine): private URLs must never reach the browser.
- Redirect bypass: a public URL redirecting to a private target must have its
  content dropped.
- API-key authentication: 401 without X-API-Key when CRAWLER_API_KEY is set,
  open mode otherwise.
- Concurrency semaphore: 429 when saturated, and release_slot() is never
  called for a slot that was never acquired.

All URLs use literal IPs so no real DNS or network traffic happens.
"""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from crawler_service.config import settings
from crawler_service.core.crawler import CrawlerEngine, SelectiveCrawlerEngine
from crawler_service.core.discovery import DiscoveryEngine
from crawler_service.core.job_manager import CrawlJob, job_manager
from crawler_service.main import app

PRIVATE_URL = "http://169.254.169.254/latest/meta-data/"
PUBLIC_URL = "http://93.184.216.34/page"


def make_job(url: str = PUBLIC_URL) -> CrawlJob:
    """Build a crawl job without touching the global job manager."""
    return CrawlJob(
        id="test-job",
        url=url,
        limit=1,
        max_depth=1,
        same_domain=False,
        include_images=False,
        exclude_patterns=[],
        include_patterns=[],
        event_queue=None,  # SSEEmitter becomes a no-op
    )


class StubCrawler:
    """Stands in for AsyncWebCrawler: records arun() calls, returns a preset result."""

    def __init__(self, result=None):
        self.result = result
        self.calls: list[str] = []

    async def arun(self, url, config=None):
        self.calls.append(url)
        return self.result


def crawl_result(redirected_url: str | None = None, markdown: str = "content"):
    return SimpleNamespace(
        success=True,
        error_message=None,
        redirected_url=redirected_url,
        markdown=markdown,
        html="<html><head><title>t</title></head><body></body></html>",
        media={},
        links={},
    )


# ---------------------------------------------------------------------------
# 1. Private URLs rejected by all three engines
# ---------------------------------------------------------------------------


async def test_crawler_engine_blocks_private_url():
    engine = CrawlerEngine(make_job())
    stub = StubCrawler(crawl_result())
    await engine._crawl_page(stub, PRIVATE_URL, 0)
    assert stub.calls == []
    assert engine._results == []
    assert any("SSRF" in e for e in engine._errors)


async def test_selective_engine_blocks_private_url():
    engine = SelectiveCrawlerEngine(make_job(), [PRIVATE_URL])
    stub = StubCrawler(crawl_result())
    await engine._crawl_page(stub, PRIVATE_URL)
    assert stub.calls == []
    assert engine._results == []
    assert any("SSRF" in e for e in engine._errors)


async def test_discovery_engine_blocks_private_url():
    engine = DiscoveryEngine(start_url=PRIVATE_URL, same_domain=False)
    stub = StubCrawler(crawl_result())
    await engine._discover_page(stub, PRIVATE_URL, 0)
    assert stub.calls == []
    assert engine._discovered == []


def test_discovery_should_crawl_blocks_private_url():
    # Without the SSRF check this URL would pass every other filter.
    engine = DiscoveryEngine(start_url=PUBLIC_URL, same_domain=False)
    assert engine._should_crawl("http://169.254.169.254/internal") is False
    assert engine._should_crawl("http://10.0.0.5/internal") is False
    assert engine._should_crawl(PUBLIC_URL) is True


# ---------------------------------------------------------------------------
# 2. Redirect to a private target is rejected after the fetch
# ---------------------------------------------------------------------------


async def test_crawler_engine_drops_content_after_private_redirect():
    engine = CrawlerEngine(make_job())
    stub = StubCrawler(crawl_result(redirected_url=PRIVATE_URL, markdown="secret"))
    await engine._crawl_page(stub, PUBLIC_URL, 0)
    assert stub.calls == [PUBLIC_URL]  # fetch happened, content dropped
    assert engine._results == []
    assert any("redirect" in e.lower() for e in engine._errors)


async def test_selective_engine_drops_content_after_private_redirect():
    engine = SelectiveCrawlerEngine(make_job(), [PUBLIC_URL])
    stub = StubCrawler(crawl_result(redirected_url=PRIVATE_URL, markdown="secret"))
    await engine._crawl_page(stub, PUBLIC_URL)
    assert stub.calls == [PUBLIC_URL]
    assert engine._results == []
    assert any("redirect" in e.lower() for e in engine._errors)


async def test_discovery_engine_drops_page_after_private_redirect():
    engine = DiscoveryEngine(start_url=PUBLIC_URL, same_domain=False)
    stub = StubCrawler(crawl_result(redirected_url=PRIVATE_URL))
    await engine._discover_page(stub, PUBLIC_URL, 0)
    assert stub.calls == [PUBLIC_URL]
    assert engine._discovered == []


async def test_crawler_engine_keeps_content_after_public_redirect():
    engine = CrawlerEngine(make_job())
    stub = StubCrawler(crawl_result(redirected_url="http://1.1.1.1/other"))
    await engine._crawl_page(stub, PUBLIC_URL, 0)
    assert len(engine._results) == 1
    assert engine._errors == []


# ---------------------------------------------------------------------------
# 3. API-key authentication
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    return TestClient(app)


def test_401_without_api_key_when_configured(client: TestClient, monkeypatch):
    monkeypatch.setattr(settings, "crawler_api_key", "test-secret")

    # Missing header
    assert client.post("/crawl", json={"url": "not-a-url"}).status_code == 401
    # Wrong key
    assert (
        client.post(
            "/crawl",
            json={"url": "not-a-url"},
            headers={"X-API-Key": "wrong"},
        ).status_code
        == 401
    )
    # Other endpoints are protected too
    assert client.get("/crawl/some-job").status_code == 401
    assert (
        client.post("/crawl/pages", json={"urls": ["https://example.com"]}).status_code
        == 401
    )

    # Correct key → auth passes (the body is invalid, hence 422 not 401)
    assert (
        client.post(
            "/crawl",
            json={"url": "not-a-url"},
            headers={"X-API-Key": "test-secret"},
        ).status_code
        == 422
    )


def test_open_mode_when_no_api_key_configured(client: TestClient, monkeypatch):
    monkeypatch.setattr(settings, "crawler_api_key", "")
    response = client.post("/crawl", json={"url": "not-a-url"})
    assert response.status_code == 422  # validation error, not an auth error


def test_health_stays_open_when_api_key_configured(client: TestClient, monkeypatch):
    monkeypatch.setattr(settings, "crawler_api_key", "test-secret")
    assert client.get("/health").status_code == 200


# ---------------------------------------------------------------------------
# 4. Concurrency semaphore: no release without acquire
# ---------------------------------------------------------------------------


def test_start_crawl_429_when_slots_exhausted(client: TestClient, monkeypatch):
    monkeypatch.setattr(job_manager, "_semaphore", asyncio.Semaphore(0))

    response = client.post("/crawl", json={"url": "https://example.com", "limit": 1})

    assert response.status_code == 429
    # No slot was acquired, so none may be released (a release would bump the
    # value to 1 and silently widen the concurrency limit).
    assert job_manager._semaphore._value == 0
    assert job_manager.active_count == 0


def test_crawl_pages_429_when_slots_exhausted(client: TestClient, monkeypatch):
    monkeypatch.setattr(job_manager, "_semaphore", asyncio.Semaphore(0))

    response = client.post("/crawl/pages", json={"urls": ["https://example.com"]})

    assert response.status_code == 429
    assert job_manager._semaphore._value == 0
    assert job_manager.active_count == 0
