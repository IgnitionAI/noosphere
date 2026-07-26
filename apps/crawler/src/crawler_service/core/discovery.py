"""Fast link discovery without content extraction."""

import asyncio
import re
import time
from urllib.parse import urljoin, urlparse

from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

from crawler_service.api.schemas import DiscoveredPage
from crawler_service.config import settings
from crawler_service.core.url_safety import is_url_allowed, is_url_allowed_async
from crawler_service.core.domain_limiter import domain_limiter
from crawler_service.core.request_safety import configure_safe_crawler


class DiscoveryEngine:
    """Fast discovery of pages on a website (links only, no content)."""

    def __init__(
        self,
        start_url: str,
        max_pages: int = 500,
        max_depth: int = 5,
        same_domain: bool = True,
        exclude_patterns: list[str] | None = None,
        include_patterns: list[str] | None = None,
    ):
        self.start_url = start_url
        self.max_pages = max_pages
        self.max_depth = max_depth
        self.same_domain = same_domain
        self.exclude_patterns = exclude_patterns or []
        self.include_patterns = include_patterns or []

        self._visited_urls: set[str] = set()
        self._queue: list[tuple[str, int]] = []  # (url, depth)
        self._discovered: list[DiscoveredPage] = []
        self._base_domain: str = ""

    async def discover(self) -> tuple[list[DiscoveredPage], float]:
        """Discover all pages on the site.

        Returns tuple of (discovered_pages, duration_seconds).
        """
        start_time = time.time()
        self._base_domain = urlparse(self.start_url).netloc

        # Initialize queue with starting URL
        self._queue.append((self.start_url, 0))

        browser_config = BrowserConfig(
            headless=True,
            verbose=False,
            user_agent=settings.outbound_user_agent,
        )

        async with AsyncWebCrawler(config=browser_config) as crawler:
            configure_safe_crawler(crawler)
            while self._queue and len(self._discovered) < self.max_pages:
                # Process in batches for speed
                batch = []
                while self._queue and len(batch) < 5:
                    url, depth = self._queue.pop(0)
                    if url not in self._visited_urls and depth <= self.max_depth:
                        self._visited_urls.add(url)
                        batch.append((url, depth))

                if not batch:
                    break

                # Crawl batch concurrently
                tasks = [
                    self._discover_page(crawler, url, depth)
                    for url, depth in batch
                ]
                await asyncio.gather(*tasks, return_exceptions=True)

                # Small delay to be nice to servers
                await asyncio.sleep(0.2)

        duration = time.time() - start_time
        return self._discovered, duration

    async def _discover_page(
        self, crawler: AsyncWebCrawler, url: str, depth: int
    ):
        """Discover links on a single page."""
        # SSRF protection: never fetch a URL that resolves to a non-public
        # address — discovery already leaks internal page titles (network
        # recon), so the start URL and every queued link must be public.
        if not await is_url_allowed_async(url):
            return

        try:
            # Minimal crawl - just get links
            run_config = CrawlerRunConfig(
                cache_mode=CacheMode.BYPASS,
                word_count_threshold=0,  # Don't care about content
                excluded_tags=["script", "style", "noscript"],
                exclude_external_links=self.same_domain,
                page_timeout=settings.page_timeout_ms,
                check_robots_txt=settings.respect_robots_txt,
            )

            async with domain_limiter.slot(url):
                result = await crawler.arun(url=url, config=run_config)

            if not result.success:
                return

            # SSRF protection: Playwright follows redirects, so the rendered
            # page may live on a non-public host we never validated.
            final_url = result.redirected_url or url
            if final_url != url and not await is_url_allowed_async(final_url):
                return

            # Extract title
            title = self._extract_title(result.html or "")

            # Add to discovered
            parsed = urlparse(url)
            self._discovered.append(
                DiscoveredPage(
                    url=url,
                    title=title,
                    depth=depth,
                    path=parsed.path or "/",
                )
            )

            # Extract and queue new links
            if result.links and depth < self.max_depth:
                for link_info in result.links.get("internal", []):
                    link = link_info.get("href", "")
                    if link:
                        absolute_url = urljoin(url, link)
                        if self._should_crawl(absolute_url):
                            if absolute_url not in self._visited_urls:
                                self._queue.append((absolute_url, depth + 1))

        except Exception:
            # Skip failed pages silently
            pass

    def _should_crawl(self, url: str) -> bool:
        """Check if URL should be crawled based on filters."""
        parsed = urlparse(url)

        # Skip non-http(s) URLs
        if parsed.scheme not in ("http", "https"):
            return False

        # SSRF protection: drop links resolving to non-public addresses
        if not is_url_allowed(url):
            return False

        # Same domain check
        if self.same_domain and parsed.netloc != self._base_domain:
            return False

        # Check exclude patterns
        for pattern in self.exclude_patterns:
            if re.search(pattern, url):
                return False

        # Check include patterns
        if self.include_patterns:
            if not any(re.search(p, url) for p in self.include_patterns):
                return False

        # Skip common non-content URLs
        skip_extensions = (
            ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp",
            ".mp3", ".mp4", ".avi", ".mov", ".zip", ".tar", ".gz",
            ".css", ".js", ".woff", ".woff2", ".ttf", ".eot",
            ".xml", ".rss", ".atom",
        )
        if any(parsed.path.lower().endswith(ext) for ext in skip_extensions):
            return False

        # Skip common non-content paths
        skip_paths = (
            "/wp-admin", "/wp-login", "/admin", "/login", "/logout",
            "/cart", "/checkout", "/account", "/api/", "/_next/",
            "/static/", "/assets/", "/cdn-cgi/",
        )
        if any(parsed.path.lower().startswith(p) for p in skip_paths):
            return False

        return True

    def _extract_title(self, html: str) -> str | None:
        """Extract title from HTML."""
        match = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
        if match:
            return match.group(1).strip()[:200]  # Limit title length
        return None


async def discover_pages(
    url: str,
    max_pages: int = 500,
    max_depth: int = 5,
    same_domain: bool = True,
    exclude_patterns: list[str] | None = None,
    include_patterns: list[str] | None = None,
) -> tuple[list[DiscoveredPage], float]:
    """Discover pages on a website.

    Returns tuple of (discovered_pages, duration_seconds).
    """
    engine = DiscoveryEngine(
        start_url=url,
        max_pages=max_pages,
        max_depth=max_depth,
        same_domain=same_domain,
        exclude_patterns=exclude_patterns,
        include_patterns=include_patterns,
    )
    return await engine.discover()
