"""Self-hosted SearXNG search with an explicit DuckDuckGo fallback."""

import hashlib
import re
from datetime import datetime, timezone
from html import unescape
from urllib.parse import parse_qs, urlparse

import httpx

from crawler_service.api.schemas import SearchResult
from crawler_service.config import settings
from crawler_service.core.url_safety import is_url_allowed_async

DUCKDUCKGO_URL = "https://html.duckduckgo.com/html/"
_RESULT_LINK_RE = re.compile(
    r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
    re.DOTALL,
)
_RESULT_SNIPPET_RE = re.compile(
    r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>',
    re.DOTALL,
)
_HTML_TAG_RE = re.compile(r"<[^>]+>")


class SearchProviderError(RuntimeError):
    """Raised when a configured search provider cannot return results."""


def _strip_html(text: str) -> str:
    return unescape(_HTML_TAG_RE.sub("", text)).strip()


def _content_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _collected_at() -> str:
    return datetime.now(timezone.utc).isoformat()


def _extract_real_url(ddg_url: str) -> str:
    if "uddg=" in ddg_url:
        parsed = urlparse(ddg_url)
        params = parse_qs(parsed.query)
        real_url = params.get("uddg", [""])[0]
        if "duckduckgo.com/y.js" in real_url:
            return ""
        return real_url
    if "duckduckgo.com" in ddg_url:
        return ""
    return ddg_url


async def search_searxng(
    query: str,
    limit: int,
) -> list[SearchResult]:
    async with httpx.AsyncClient(
        timeout=20.0,
        follow_redirects=False,
        headers={
            "User-Agent": settings.outbound_user_agent,
        },
    ) as client:
        response = await client.get(
            f"{settings.searxng_url.rstrip('/')}/search",
            params={
                "q": query,
                "format": "json",
                "categories": "general",
                "safesearch": 1,
            },
        )
        response.raise_for_status()
        payload = response.json()

    results: list[SearchResult] = []
    for item in payload.get("results", []):
        url = str(item.get("url", "")).strip()
        title = str(item.get("title", "")).strip()
        description = str(item.get("content") or item.get("description") or "").strip()
        if not url or not title or not await is_url_allowed_async(url):
            continue
        results.append(
            SearchResult(
                url=url,
                canonicalUrl=url,
                title=title,
                description=description,
                contentHash=_content_hash(description),
                collectedAt=_collected_at(),
                provider="searxng",
            )
        )
    return results[:limit]


async def search_duckduckgo(query: str, limit: int) -> list[SearchResult]:
    async with httpx.AsyncClient(
        timeout=15.0,
        follow_redirects=True,
        headers={"User-Agent": settings.outbound_user_agent},
    ) as client:
        response = await client.get(DUCKDUCKGO_URL, params={"q": query})
        response.raise_for_status()

    links = _RESULT_LINK_RE.findall(response.text)
    snippets = _RESULT_SNIPPET_RE.findall(response.text)
    results: list[SearchResult] = []
    for index, (raw_url, raw_title) in enumerate(links):
        if len(results) >= limit:
            break
        url = _extract_real_url(raw_url)
        if url.startswith("//"):
            url = f"https:{url}"
        title = _strip_html(raw_title)
        description = _strip_html(snippets[index]) if index < len(snippets) else ""
        if not url or not title or not await is_url_allowed_async(url):
            continue
        results.append(
            SearchResult(
                url=url,
                canonicalUrl=url,
                title=title,
                description=description,
                contentHash=_content_hash(description),
                collectedAt=_collected_at(),
                provider="duckduckgo",
            )
        )
    return results


async def search_web(
    query: str,
    limit: int = 5,
    search_depth: str = "advanced",
) -> tuple[list[SearchResult], str, list[str]]:
    """Search the private SearXNG instance and fall back when enabled."""
    errors: list[str] = []
    try:
        return await search_searxng(query, limit), "searxng", errors
    except Exception as error:
        errors.append(f"searxng: {type(error).__name__}")
        if not settings.search_fallback_enabled:
            raise SearchProviderError(
                "SearXNG search failed and fallback is disabled"
            ) from error

    try:
        return await search_duckduckgo(query, limit), "duckduckgo", errors
    except Exception as error:
        errors.append(f"duckduckgo: {type(error).__name__}")
        raise SearchProviderError("All search providers failed") from error
