from types import SimpleNamespace

import pytest

from crawler_service.config import settings
from crawler_service.api.schemas import CrawlRequest
from crawler_service.core import search
from crawler_service.core.request_safety import install_safe_request_interceptor


class FakeResponse:
    def __init__(self, payload=None, text=""):
        self._payload = payload or {}
        self.text = text

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class FakeClient:
    def __init__(self, response, **_kwargs):
        self.response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, *_args, **_kwargs):
        return self.response

    async def get(self, *_args, **_kwargs):
        return self.response


async def test_searxng_is_primary_and_returns_normalized_metadata(monkeypatch):
    monkeypatch.setattr(settings, "searxng_url", "http://searxng:8080")
    monkeypatch.setattr(
        search.httpx,
        "AsyncClient",
        lambda **kwargs: FakeClient(
            FakeResponse(
                {
                    "results": [
                        {
                            "url": "https://example.com/product",
                            "title": "Example",
                            "content": "Public product evidence",
                        }
                    ]
                }
            ),
            **kwargs,
        ),
    )

    async def allowed(_url):
        return True

    monkeypatch.setattr(search, "is_url_allowed_async", allowed)
    results, provider, errors = await search.search_web("example", 5)

    assert provider == "searxng"
    assert errors == []
    assert results[0].provider == "searxng"
    assert results[0].contentHash
    assert results[0].collectedAt


async def test_duckduckgo_fallback_can_be_disabled(monkeypatch):
    monkeypatch.setattr(settings, "search_fallback_enabled", False)

    class FailingClient(FakeClient):
        async def get(self, *_args, **_kwargs):
            raise RuntimeError("searxng unavailable")

    monkeypatch.setattr(
        search.httpx,
        "AsyncClient",
        lambda **kwargs: FailingClient(FakeResponse(), **kwargs),
    )

    with pytest.raises(search.SearchProviderError):
        await search.search_web("example", 5)


async def test_browser_interceptor_aborts_private_request_before_navigation(monkeypatch):
    handlers = []

    class FakePage:
        async def route(self, _pattern, handler):
            handlers.append(handler)

    async def allowed(url):
        return url == "https://example.com/public"

    monkeypatch.setattr(
        "crawler_service.core.request_safety.is_url_allowed_async",
        allowed,
    )
    await install_safe_request_interceptor(FakePage())

    actions = []

    class FakeRoute:
        async def continue_(self):
            actions.append("continue")

        async def abort(self, reason):
            actions.append(f"abort:{reason}")

    await handlers[0](FakeRoute(), SimpleNamespace(url="http://169.254.169.254/"))
    await handlers[0](FakeRoute(), SimpleNamespace(url="https://example.com/public"))

    assert actions == ["abort:blockedbyclient", "continue"]


def test_crawl_limits_and_regex_guards_are_enforced():
    with pytest.raises(ValueError):
        CrawlRequest(url="https://example.com", limit=301)
    with pytest.raises(ValueError):
        CrawlRequest(
            url="https://example.com",
            includePatterns=["(.*)+(.*)+"],
        )
