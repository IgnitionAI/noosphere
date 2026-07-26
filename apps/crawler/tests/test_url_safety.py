"""Regression tests for SSRF protection (audit #141).

Uses literal IPs / localhost so resolution never hits the network.
"""

import pytest

from crawler_service.core.url_safety import is_url_allowed, is_url_allowed_async


@pytest.mark.parametrize(
    "url",
    [
        "http://169.254.169.254/latest/meta-data/",  # cloud metadata
        "http://127.0.0.1:8000/",
        "http://localhost/",
        "http://10.0.0.5/",
        "http://192.168.1.1/",
        "http://172.16.0.1/",
        "http://[::1]/",
        "http://0.0.0.0/",
        "ftp://example.com/",
        "file:///etc/passwd",
        "not a url",
        "http:///nohost",
    ],
)
def test_blocks_non_public(url: str) -> None:
    assert is_url_allowed(url) is False


@pytest.mark.parametrize(
    "url",
    [
        "http://93.184.216.34/",
        "https://1.1.1.1/",
        "http://8.8.8.8/",
    ],
)
def test_allows_public_ips(url: str) -> None:
    assert is_url_allowed(url) is True


async def test_async_guard_fails_closed_when_dns_answer_changes(monkeypatch) -> None:
    answers = iter(["93.184.216.34", "169.254.169.254"])

    def changing_dns(*_args, **_kwargs):
        return [(None, None, None, None, (next(answers), 0))]

    monkeypatch.setattr("crawler_service.core.url_safety.socket.getaddrinfo", changing_dns)
    assert await is_url_allowed_async("https://rebind.example/") is False
