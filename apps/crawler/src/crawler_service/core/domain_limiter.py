"""Process-wide per-domain concurrency and pacing for browser requests."""

import asyncio
import time
from contextlib import asynccontextmanager
from urllib.parse import urlparse

from crawler_service.config import settings


class DomainLimiter:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._semaphores: dict[str, asyncio.Semaphore] = {}
        self._last_completed: dict[str, float] = {}

    @asynccontextmanager
    async def slot(self, url: str):
        domain = (urlparse(url).hostname or "").lower()
        async with self._lock:
            semaphore = self._semaphores.setdefault(
                domain,
                asyncio.Semaphore(settings.max_concurrent_per_domain),
            )
        await semaphore.acquire()
        try:
            elapsed = time.monotonic() - self._last_completed.get(domain, 0)
            remaining = settings.rate_limit_delay - elapsed
            if remaining > 0:
                await asyncio.sleep(remaining)
            yield
        finally:
            self._last_completed[domain] = time.monotonic()
            semaphore.release()


domain_limiter = DomainLimiter()
