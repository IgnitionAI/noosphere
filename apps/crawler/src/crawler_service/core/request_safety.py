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

    context = getattr(page, "context", None)
    new_cdp_session = getattr(context, "new_cdp_session", None)
    if callable(new_cdp_session):
        try:
            client = await new_cdp_session(page)

            async def guard_cdp(event):
                request_id = event["requestId"]
                target = event["request"]["url"]
                scheme = urlparse(target).scheme
                if scheme in ("data", "blob", "about") or await is_url_allowed_async(target):
                    await client.send(
                        "Fetch.continueRequest",
                        {"requestId": request_id},
                    )
                else:
                    await client.send(
                        "Fetch.failRequest",
                        {
                            "requestId": request_id,
                            "errorReason": "BlockedByClient",
                        },
                    )

            client.on("Fetch.requestPaused", guard_cdp)
            await client.send(
                "Fetch.enable",
                {
                    "patterns": [
                        {"urlPattern": "*", "requestStage": "Request"},
                    ]
                },
            )
            # Keep the CDP session alive for the page lifetime.
            setattr(page, "_ignition_safe_cdp_session", client)
            return page
        except Exception:
            # Non-Chromium adapters and test doubles use Playwright routing.
            pass

    async def guard(route, request):
        target = request.url
        scheme = urlparse(target).scheme
        if scheme in ("data", "blob", "about"):
            await _continue_safely(route)
            return
        if await is_url_allowed_async(target):
            await _continue_safely(route)
        else:
            await route.abort("blockedbyclient")

    # Browser-context routing also sees redirected requests created by a page
    # route fulfillment. Page-level routing alone can miss that transition.
    if context is not None and hasattr(context, "route"):
        await context.route("**/*", guard)
    else:
        await page.route("**/*", guard)
    return page


async def _continue_safely(route):
    """Continue through any other route handlers before reaching the network.

    Playwright's ``continue_`` bypasses older handlers. ``fallback`` preserves
    the interception chain and is therefore required when another adapter
    fulfills a public response that redirects or embeds a private target.
    """

    fallback = getattr(route, "fallback", None)
    if fallback is not None:
        await fallback()
    else:
        await route.continue_()


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
