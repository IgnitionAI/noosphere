"""Browser-level request interception and bounded content helpers."""

import hashlib
from datetime import datetime, timezone
from urllib.parse import urldefrag, urlparse, urlunparse

from crawler_service.config import settings
from crawler_service.core.url_safety import is_url_allowed_async


def canonicalize_url(url: str) -> str:
    clean, _ = urldefrag(url)
    parsed = urlparse(clean)
    scheme = parsed.scheme.lower()
    host = (parsed.hostname or "").lower()
    port = parsed.port
    netloc = host
    if port and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
        netloc = f"{host}:{port}"
    path = parsed.path or "/"
    return urlunparse((scheme, netloc, path, "", parsed.query, ""))


def content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def collected_at() -> str:
    return datetime.now(timezone.utc).isoformat()


async def install_safe_request_interceptor(page, **_kwargs):
    """Abort every browser request whose target is not publicly routable."""

    async def guard(route, request):
        target = request.url
        scheme = urlparse(target).scheme
        if scheme in ("data", "blob", "about"):
            await route.continue_()
            return
        if await is_url_allowed_async(target):
            await route.continue_()
        else:
            await route.abort("blockedbyclient")

    await page.route("**/*", guard)
    return page


def configure_safe_crawler(crawler) -> None:
    crawler.crawler_strategy.set_hook(
        "on_page_context_created",
        install_safe_request_interceptor,
    )


def bounded_markdown(value: str) -> str:
    return value[: settings.max_markdown_characters]


def bounded_html(value: str) -> str | None:
    if not value:
        return None
    return value[: settings.max_html_characters]
