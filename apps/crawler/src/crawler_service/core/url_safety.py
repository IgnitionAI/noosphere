"""SSRF protection for the crawler.

Before fetching any user-supplied URL we resolve its hostname and reject it if
any resolved address is not globally routable (loopback, link-local incl. the
cloud metadata endpoint 169.254.169.254, private RFC1918, reserved, multicast,
unspecified). This prevents an authenticated user from driving the crawler into
the internal network or cloud metadata service.

Trusted intranet deployments can opt out via the deployment-only
ALLOW_PRIVATE_NETWORKS=true setting.
"""

import asyncio
import ipaddress
import socket
from urllib.parse import urlparse

from crawler_service.config import settings


def is_url_allowed(url: str) -> bool:
    """Return True only if ``url`` is safe to fetch.

    Fails closed: an unparseable host, a non-http(s) scheme, a DNS failure, or
    any non-global resolved address yields ``False``.
    """
    return settings.allow_private_networks or _public_addresses(url) is not None


def _public_addresses(url: str) -> frozenset[str] | None:
    """Resolve a URL and return its complete public address set, or fail closed."""

    try:
        parsed = urlparse(url)
    except ValueError:
        return None

    if parsed.scheme not in ("http", "https"):
        return None

    host = parsed.hostname
    if not host:
        return None

    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, OSError, UnicodeError):
        return None  # fail closed on resolution errors

    addresses = frozenset(info[4][0] for info in infos)
    if not addresses:
        return None

    for addr in addresses:
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            return None
        # is_global is False for loopback/link-local/private/reserved/
        # multicast/unspecified — exactly the ranges we must block.
        if not ip.is_global:
            return None

    return addresses


async def is_url_allowed_async(url: str) -> bool:
    """Async wrapper around :func:`is_url_allowed`.

    DNS resolution is blocking, so it runs in the default executor to keep the
    event loop responsive.
    """
    if settings.allow_private_networks:
        return True
    loop = asyncio.get_event_loop()
    first = await loop.run_in_executor(None, _public_addresses, url)
    if first is None:
        return False
    # Re-resolve immediately before allowing Playwright to emit the request.
    # A changed answer is treated as DNS rebinding and fails closed.
    second = await loop.run_in_executor(None, _public_addresses, url)
    return second is not None and first == second
