"""Crawl4AI-based web crawler engine."""

import asyncio
import re
import time
from urllib.parse import urljoin, urlparse

from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

from crawler_service.config import settings
from crawler_service.core.job_manager import CrawlJob, job_manager
from crawler_service.core.domain_limiter import domain_limiter
from crawler_service.core.url_safety import is_url_allowed, is_url_allowed_async
from crawler_service.core.sse_emitter import SSEEmitter
from crawler_service.core.request_safety import (
    bounded_html,
    bounded_markdown,
    canonicalize_url,
    collected_at,
    configure_safe_crawler,
    content_hash,
)
from crawler_service.models.events import CrawledPage, CrawlResult


class CrawlerEngine:
    """Orchestrates web crawling using Crawl4AI."""

    def __init__(self, job: CrawlJob):
        self.job = job
        self.emitter = SSEEmitter(job)
        self._visited_urls: set[str] = set()
        self._queue: list[tuple[str, int]] = []  # (url, depth)
        self._results: list[CrawledPage] = []
        self._errors: list[str] = []
        self._start_time: float = 0
        self._base_domain: str = ""

    async def run(self):
        """Execute the crawl job."""
        self._start_time = time.time()
        self._base_domain = urlparse(self.job.url).netloc

        # Emit started event
        await self.emitter.emit_started(
            {
                "url": self.job.url,
                "limit": self.job.limit,
                "maxDepth": self.job.max_depth,
                "sameDomain": self.job.same_domain,
            }
        )

        # Initialize queue with starting URL
        self._queue.append((str(self.job.url), 0))

        browser_config = BrowserConfig(
            headless=True,
            verbose=False,
            user_agent=settings.outbound_user_agent,
        )

        try:
            async with AsyncWebCrawler(config=browser_config) as crawler:
                configure_safe_crawler(crawler)
                while (
                    self._queue
                    and len(self._results) < self.job.limit
                    and not self.job.cancel_event.is_set()
                ):
                    # Get next URL from queue
                    url, depth = self._queue.pop(0)

                    # Skip if already visited or exceeds max depth
                    if url in self._visited_urls or depth > self.job.max_depth:
                        continue

                    # Mark as visited
                    self._visited_urls.add(url)

                    # Crawl the page
                    await self._crawl_page(crawler, url, depth)

                    # Rate limiting
                    await asyncio.sleep(settings.rate_limit_delay)

            # Build result
            duration = time.time() - self._start_time
            result = CrawlResult(
                pagesCount=len(self._results),
                data=self._results,
                errors=self._errors,
                duration=duration,
            )

            # Complete the job
            await job_manager.complete_job(self.job.id, result)

            # Emit completion
            await self.emitter.emit_completed(result)
            await self.emitter.emit_metric("totalDuration", duration)

        except asyncio.CancelledError:
            await self.emitter.emit_cancelled(len(self._results))
            raise
        except Exception as e:
            error_msg = str(e)
            await job_manager.fail_job(self.job.id, error_msg)
            await self.emitter.emit_error(error_msg)
            raise
        finally:
            await self.emitter.close()

    async def _crawl_page(self, crawler: AsyncWebCrawler, url: str, depth: int):
        """Crawl a single page and extract content."""
        # SSRF protection: never fetch a URL that resolves to a non-public
        # address. This is the single choke point for both the start URL and
        # every discovered link. DNS resolution runs off the event loop.
        if not await is_url_allowed_async(url):
            warning = f"Blocked non-public URL (SSRF protection): {url}"
            self._errors.append(warning)
            await self.emitter.emit_warning(warning, url)
            return

        try:
            # Update progress
            job_manager.update_progress(
                self.job.id,
                pages_completed=len(self._results),
                pages_total=min(len(self._queue) + len(self._results) + 1, self.job.limit),
                current_url=url,
            )

            await self.emitter.emit_progress(
                current=len(self._results) + 1,
                total=self.job.limit,
                current_url=url,
            )

            # Configure crawl run
            run_config = CrawlerRunConfig(
                cache_mode=CacheMode.BYPASS,
                word_count_threshold=10,
                excluded_tags=["nav", "footer", "header", "aside"],
                exclude_external_links=self.job.same_domain,
                page_timeout=settings.page_timeout_ms,
                check_robots_txt=settings.respect_robots_txt,
            )

            # Execute crawl
            async with domain_limiter.slot(url):
                result = await crawler.arun(url=url, config=run_config)

            if not result.success:
                self._errors.append(f"Failed to crawl {url}: {result.error_message}")
                await self.emitter.emit_warning(
                    f"Failed to crawl: {result.error_message}", url
                )
                return

            # SSRF protection: Playwright follows redirects (HTTP and JS), so
            # the rendered page may live on a different host than the one we
            # validated. Drop the content if the final URL is not public.
            final_url = result.redirected_url or url
            if final_url != url and not await is_url_allowed_async(final_url):
                warning = (
                    "Blocked redirect to non-public URL (SSRF protection): "
                    f"{url} -> {final_url}"
                )
                self._errors.append(warning)
                await self.emitter.emit_warning(warning, url)
                return

            # Extract content
            markdown = bounded_markdown(result.markdown or "")
            html = result.html or ""
            title = self._extract_title(html) or url

            # Extract images if enabled
            images: list[str] = []
            if self.job.include_images and result.media:
                images = [
                    img.get("src", "")
                    for img in result.media.get("images", [])
                    if img.get("src")
                ]

            # Extract links for further crawling
            links: list[str] = []
            if result.links and depth < self.job.max_depth:
                for link_info in result.links.get("internal", []):
                    link = link_info.get("href", "")
                    if link:
                        absolute_url = urljoin(url, link)
                        if self._should_crawl(absolute_url):
                            links.append(absolute_url)
                            if absolute_url not in self._visited_urls:
                                self._queue.append((absolute_url, depth + 1))

            # Create page result
            page = CrawledPage(
                url=url,
                title=title,
                markdown=markdown,
                html=bounded_html(html),
                images=images[:50],  # Limit images
                links=links[:100],  # Limit links
                metadata={
                    "depth": depth,
                    "wordCount": len(markdown.split()) if markdown else 0,
                },
                canonicalUrl=canonicalize_url(final_url),
                contentHash=content_hash(markdown),
                collectedAt=collected_at(),
            )

            self._results.append(page)

            # Progress counts successfully persisted pages, not pages that
            # merely started. Update it after the result is built so callers
            # do not observe a completed crawl with pagesCompleted still at 0.
            job_manager.update_progress(
                self.job.id,
                pages_completed=len(self._results),
                pages_total=min(
                    len(self._queue) + len(self._results), self.job.limit
                ),
                current_url=url,
            )

            # Emit page crawled event
            await self.emitter.emit_page_crawled(
                url=url,
                title=title,
                content_length=len(markdown),
                images_count=len(images),
            )

            # Emit discovered pages metric
            await self.emitter.emit_metric("pagesDiscovered", len(self._queue))

        except Exception as e:
            error_msg = f"Error crawling {url}: {str(e)}"
            self._errors.append(error_msg)
            await self.emitter.emit_warning(str(e), url)

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
        if self.job.same_domain and parsed.netloc != self._base_domain:
            return False

        # Check exclude patterns
        for pattern in self.job.exclude_patterns:
            if re.search(pattern, url):
                return False

        # Check include patterns (if specified, URL must match at least one)
        if self.job.include_patterns:
            if not any(re.search(p, url) for p in self.job.include_patterns):
                return False

        # Skip common non-content URLs
        skip_extensions = (
            ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp",
            ".mp3", ".mp4", ".avi", ".mov", ".zip", ".tar", ".gz",
            ".css", ".js", ".woff", ".woff2", ".ttf", ".eot",
        )
        if any(parsed.path.lower().endswith(ext) for ext in skip_extensions):
            return False

        return True

    def _extract_title(self, html: str) -> str | None:
        """Extract title from HTML."""
        import re

        match = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
        if match:
            return match.group(1).strip()
        return None


async def execute_crawl(job: CrawlJob):
    """Execute a crawl job."""
    engine = CrawlerEngine(job)
    await engine.run()


async def execute_selective_crawl(job: CrawlJob, urls: list[str]):
    """Execute a selective crawl of specific URLs."""
    engine = SelectiveCrawlerEngine(job, urls)
    await engine.run()


class SelectiveCrawlerEngine:
    """Crawls a specific list of URLs (no link following)."""

    def __init__(self, job: CrawlJob, urls: list[str]):
        self.job = job
        self.urls = urls
        self.emitter = SSEEmitter(job)
        self._results: list[CrawledPage] = []
        self._errors: list[str] = []
        self._start_time: float = 0

    async def run(self):
        """Execute the selective crawl."""
        self._start_time = time.time()

        await self.emitter.emit_started({
            "url": self.job.url,
            "urlCount": len(self.urls),
            "mode": "selective",
        })

        browser_config = BrowserConfig(
            headless=True,
            verbose=False,
            user_agent=settings.outbound_user_agent,
        )

        try:
            async with AsyncWebCrawler(config=browser_config) as crawler:
                configure_safe_crawler(crawler)
                for i, url in enumerate(self.urls):
                    if self.job.cancel_event.is_set():
                        break

                    # Update progress
                    job_manager.update_progress(
                        self.job.id,
                        pages_completed=len(self._results),
                        pages_total=len(self.urls),
                        current_url=url,
                    )

                    await self.emitter.emit_progress(
                        current=i + 1,
                        total=len(self.urls),
                        current_url=url,
                    )

                    # Crawl the page
                    await self._crawl_page(crawler, url)

                    # Rate limiting
                    await asyncio.sleep(settings.rate_limit_delay)

            # Build result
            duration = time.time() - self._start_time
            result = CrawlResult(
                pagesCount=len(self._results),
                data=self._results,
                errors=self._errors,
                duration=duration,
            )

            await job_manager.complete_job(self.job.id, result)
            await self.emitter.emit_completed(result)
            await self.emitter.emit_metric("totalDuration", duration)

        except asyncio.CancelledError:
            await self.emitter.emit_cancelled(len(self._results))
            raise
        except Exception as e:
            error_msg = str(e)
            await job_manager.fail_job(self.job.id, error_msg)
            await self.emitter.emit_error(error_msg)
            raise
        finally:
            await self.emitter.close()

    async def _crawl_page(self, crawler: AsyncWebCrawler, url: str):
        """Crawl a single page."""
        # SSRF protection: selected URLs are user-supplied and never pass
        # through link filtering, so validate each one before fetching.
        if not await is_url_allowed_async(url):
            warning = f"Blocked non-public URL (SSRF protection): {url}"
            self._errors.append(warning)
            await self.emitter.emit_warning(warning, url)
            return

        try:
            run_config = CrawlerRunConfig(
                cache_mode=CacheMode.BYPASS,
                word_count_threshold=10,
                excluded_tags=["nav", "footer", "header", "aside"],
                page_timeout=settings.page_timeout_ms,
                check_robots_txt=settings.respect_robots_txt,
            )

            async with domain_limiter.slot(url):
                result = await crawler.arun(url=url, config=run_config)

            if not result.success:
                self._errors.append(f"Failed to crawl {url}: {result.error_message}")
                await self.emitter.emit_warning(
                    f"Failed to crawl: {result.error_message}", url
                )
                return

            # SSRF protection: Playwright follows redirects (HTTP and JS), so
            # the rendered page may live on a different host than the one we
            # validated. Drop the content if the final URL is not public.
            final_url = result.redirected_url or url
            if final_url != url and not await is_url_allowed_async(final_url):
                warning = (
                    "Blocked redirect to non-public URL (SSRF protection): "
                    f"{url} -> {final_url}"
                )
                self._errors.append(warning)
                await self.emitter.emit_warning(warning, url)
                return

            markdown = bounded_markdown(result.markdown or "")
            html = result.html or ""
            title = self._extract_title(html) or url

            # Extract images if enabled
            images: list[str] = []
            if self.job.include_images and result.media:
                images = [
                    img.get("src", "")
                    for img in result.media.get("images", [])
                    if img.get("src")
                ]

            page = CrawledPage(
                url=url,
                title=title,
                markdown=markdown,
                html=bounded_html(html),
                images=images[:50],
                links=[],
                metadata={"wordCount": len(markdown.split()) if markdown else 0},
                canonicalUrl=canonicalize_url(final_url),
                contentHash=content_hash(markdown),
                collectedAt=collected_at(),
            )

            self._results.append(page)

            # Keep the polling/SSE job projection aligned with the durable
            # result. Failed or blocked pages never reach this point and are
            # therefore not counted as completed.
            job_manager.update_progress(
                self.job.id,
                pages_completed=len(self._results),
                pages_total=len(self.urls),
                current_url=url,
            )

            await self.emitter.emit_page_crawled(
                url=url,
                title=title,
                content_length=len(markdown),
                images_count=len(images),
            )

        except Exception as e:
            error_msg = f"Error crawling {url}: {str(e)}"
            self._errors.append(error_msg)
            await self.emitter.emit_warning(str(e), url)

    def _extract_title(self, html: str) -> str | None:
        """Extract title from HTML."""
        match = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
        if match:
            return match.group(1).strip()
        return None
