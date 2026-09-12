"""Rendered HTML extraction using Playwright, without an NLP/model runtime."""

import asyncio

from dataclasses import dataclass, field
from types import SimpleNamespace
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup
from markdownify import markdownify
from playwright.async_api import async_playwright, TimeoutError as BrowserTimeout

from crawler_service.config import settings
from crawler_service.core.request_safety import install_safe_request_interceptor
from crawler_service.core.url_safety import is_url_allowed_async


class CacheMode:
    BYPASS = "bypass"


@dataclass
class BrowserConfig:
    headless: bool = True
    verbose: bool = False
    user_agent: str = "IgnitionOutboundResearchBot/1.0"
    proxy: dict | None = None


@dataclass
class CrawlerRunConfig:
    cache_mode: str = CacheMode.BYPASS
    word_count_threshold: int = 0
    excluded_tags: list[str] = field(default_factory=list)
    exclude_external_links: bool = False
    page_timeout: int = 30_000
    check_robots_txt: bool = True


class AsyncWebCrawler:
    def __init__(self, config: BrowserConfig):
        self.config = config
        self._robots: dict[str, RobotFileParser] = {}
        self._pages = set()

    async def __aenter__(self):
        self._playwright = await async_playwright().start()
        try:
            self._browser = await self._playwright.chromium.launch(
                headless=self.config.headless, proxy=self.config.proxy,
            )
            self._context = await self._browser.new_context(
                user_agent=self.config.user_agent, service_workers="block",
                accept_downloads=False,
            )
            async def context_guard(route, request):
                # Cover popup initial requests before their page event fires.
                try:
                    owned = request.frame.page in self._pages
                except Exception:
                    owned = False
                if owned and await is_url_allowed_async(request.url):
                    await route.fallback()
                else:
                    await route.abort("blockedbyclient")
            await self._context.route("**/*", context_guard)
        except BaseException:
            await self._playwright.stop()
            raise
        return self

    async def __aexit__(self, *_args):
        try:
            await self._browser.close()
        finally:
            await self._playwright.stop()

    async def _page(self, navigation_guard=None):
        page = await self._context.new_page()
        self._pages.add(page)
        try:
            await install_safe_request_interceptor(page, navigation_guard=navigation_guard)
            return page
        except BaseException:
            self._pages.discard(page)
            await page.close()
            raise

    async def _allowed_by_robots(self, url: str, timeout: int) -> bool:
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin not in self._robots:
            page = await self._page()
            try:
                response = await page.goto(origin + "/robots.txt", timeout=timeout,
                                           wait_until="domcontentloaded")
                if response is None:
                    raise RuntimeError("robots.txt returned no response")
                parser = RobotFileParser(origin + "/robots.txt")
                if response.status in (401, 403):
                    parser.disallow_all = True
                elif response.status in (404, 410):
                    parser.allow_all = True
                elif response.ok:
                    text = await response.text()
                    if len(text) > 500_000:
                        raise RuntimeError("robots.txt exceeds size limit")
                    parser.parse(text.splitlines())
                else:
                    raise RuntimeError(f"robots.txt HTTP {response.status}")
                self._robots[origin] = parser
            finally:
                self._pages.discard(page)
                await page.close()
        return self._robots[origin].can_fetch(self.config.user_agent, url)

    async def arun(self, url: str, config: CrawlerRunConfig):
        page = None
        try:
            if not await is_url_allowed_async(url):
                raise RuntimeError("Blocked non-public URL (SSRF protection)")
            if config.check_robots_txt and not await self._allowed_by_robots(url, config.page_timeout):
                raise RuntimeError("Crawling denied by robots.txt")
            async def allow_navigation(target):
                try:
                    return not config.check_robots_txt or await self._allowed_by_robots(target, config.page_timeout)
                except Exception:
                    return False
            page = await self._page(navigation_guard=allow_navigation)
            response = await page.goto(url, timeout=config.page_timeout, wait_until="load")
            if response is None or not response.ok:
                raise RuntimeError(f"Page HTTP {response.status if response else 'no response'}")
            try:
                await page.wait_for_load_state("networkidle", timeout=min(2000, config.page_timeout))
            except BrowserTimeout:
                pass
            if not await is_url_allowed_async(page.url):
                raise RuntimeError("Blocked non-public redirect (SSRF protection)")
            html = await page.evaluate("""(limit) => {
                const html = document.documentElement.outerHTML;
                if (html.length > limit) throw new Error('Rendered document exceeds size limit');
                return html;
            }""", settings.max_document_characters)
            return await asyncio.to_thread(extract_page, html, page.url, config)
        except Exception as error:
            return SimpleNamespace(success=False, error_message=str(error))
        finally:
            if page is not None:
                self._pages.discard(page)
                await page.close()


def extract_page(html: str, url: str, config: CrawlerRunConfig):
    if len(html) > settings.max_document_characters:
        raise ValueError("Rendered document exceeds size limit")
    document = BeautifulSoup(html, "html.parser")
    base = document.find("base", href=True)
    base_url = urljoin(url, base["href"]) if base else url
    links = {"internal": [], "external": []}
    for index, anchor in enumerate(document.find_all("a", href=True)):
        target = urljoin(base_url, anchor["href"])
        if urlparse(target).scheme not in ("http", "https"):
            del anchor["href"]
            continue
        anchor["href"] = target
        kind = "internal" if urlparse(target).netloc == urlparse(url).netloc else "external"
        if kind == "external" and config.exclude_external_links:
            anchor.unwrap()
            continue
        if index < settings.max_links_per_page:
            links[kind].append({"href": target, "text": anchor.get_text(" ", strip=True)})
    images = [{"src": urljoin(base_url, image["src"])}
              for image in document.find_all("img", src=True, limit=50)]
    for node in document.find_all(list(set(config.excluded_tags + ["script", "style", "noscript", "template"]))):
        node.decompose()
    content = document.body or document
    markdown = markdownify(str(content), heading_style="ATX").strip()
    if len(content.get_text(" ", strip=True).split()) < config.word_count_threshold:
        markdown = ""
    return SimpleNamespace(success=True, error_message=None, redirected_url=url,
                           html=html, markdown=markdown, links=links,
                           media={"images": images})
