import asyncio

import pytest

from crawler_service.core.browser import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig


@pytest.mark.parametrize("blocked", [False, True])
async def test_rendered_page_respects_robots_and_extracts_javascript(blocked):
    requests = []

    async def proxy(reader, writer):
        try:
            request = await reader.readuntil(b"\r\n\r\n")
            first = request.split(b"\r\n", 1)[0].decode()
            requests.append(first)
            if "/robots.txt" in first:
                content = "User-agent: *\nDisallow: /page" if blocked else "User-agent: *\nAllow: /"
            else:
                content = '''<html><head><title>Test page</title></head><body>
                <nav>Navigation noise</nav><main><h1>Useful heading</h1>
                <p>Research evidence with enough words to retain this complete paragraph.</p>
                <a href="/details">Details</a><img src="/logo.png">
                <div id="dynamic"></div><script>document.getElementById('dynamic').textContent='Rendered JavaScript evidence';</script>
                </main></body></html>'''
            body = content.encode()
            writer.write((f"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n").encode() + body)
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(proxy, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        async with AsyncWebCrawler(BrowserConfig(proxy={"server": f"http://127.0.0.1:{port}"})) as crawler:
            result = await crawler.arun("http://1.1.1.1/page", CrawlerRunConfig(excluded_tags=["nav"], word_count_threshold=10))
        if blocked:
            assert not result.success
            assert "robots.txt" in result.error_message
            assert not any("/page" in r for r in requests)
        else:
            assert result.success, result.error_message
            assert "# Useful heading" in result.markdown
            assert "Rendered JavaScript evidence" in result.markdown
            assert "Navigation noise" not in result.markdown
            assert "document.getElementById" not in result.markdown
            assert result.links["internal"][0]["href"] == "http://1.1.1.1/details"
            assert result.media["images"][0]["src"] == "http://1.1.1.1/logo.png"
    finally:
        server.close()
        await server.wait_closed()


async def test_browser_rejects_private_start_without_connecting():
    async with AsyncWebCrawler(BrowserConfig()) as crawler:
        result = await crawler.arun("http://127.0.0.1:1/private", CrawlerRunConfig())
        assert not result.success
        assert "SSRF" in result.error_message

@pytest.mark.parametrize("mode", ["popup", "redirect", "cross_origin_redirect"])
async def test_browser_blocks_popup_and_robots_redirect_before_network(mode):
    requests = []
    target = "http://192.168.1.5/private" if mode == "popup" else ("http://8.8.8.8/private" if mode == "cross_origin_redirect" else "http://1.1.1.1/private")

    async def proxy(reader, writer):
        try:
            request = await reader.readuntil(b"\r\n\r\n")
            first = request.split(b"\r\n", 1)[0].decode()
            requests.append(first)
            if "/robots.txt" in first:
                body = b"User-agent: *\nDisallow: /private"
                head = "HTTP/1.1 200 OK\r\n"
            elif mode == "popup":
                body = f"<html><body>Public page<script>window.open('{target}')</script></body></html>".encode()
                head = "HTTP/1.1 200 OK\r\n"
            else:
                body = b""
                head = f"HTTP/1.1 302 Found\r\nLocation: {target}\r\n"
            writer.write((head + f"Content-Type: text/html\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n").encode() + body)
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(proxy, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        async with AsyncWebCrawler(BrowserConfig(proxy={"server": f"http://127.0.0.1:{port}"})) as crawler:
            result = await crawler.arun("http://1.1.1.1/page", CrawlerRunConfig(page_timeout=5000))
            await asyncio.sleep(0.1)
            assert not any("/private" in request for request in requests), requests
            if mode != "popup":
                assert not result.success
    finally:
        server.close()
        await server.wait_closed()


def test_extraction_rejects_oversized_document_before_parsing(monkeypatch):
    from crawler_service.core import browser
    monkeypatch.setattr(browser.settings, "max_document_characters", 10)
    with pytest.raises(ValueError, match="size limit"):
        browser.extract_page("x" * 11, "http://1.1.1.1", CrawlerRunConfig())


def test_external_and_executable_links_are_not_emitted_as_markdown_links():
    from crawler_service.core.browser import extract_page
    result = extract_page('<body><a href="https://example.com/external">External label</a><a href="javascript:alert(1)">Unsafe label</a></body>', "http://1.1.1.1/page", CrawlerRunConfig(exclude_external_links=True))
    assert result.links == {"internal": [], "external": []}
    assert "External label" in result.markdown
    assert "Unsafe label" in result.markdown
    assert "https://example.com" not in result.markdown
    assert "javascript:" not in result.markdown
