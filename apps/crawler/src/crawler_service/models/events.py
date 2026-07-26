"""Event types for SSE streaming."""

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class EventType(str, Enum):
    """Types of events emitted during crawling."""

    STARTED = "started"
    PROGRESS = "progress"
    PAGE_CRAWLED = "page_crawled"
    METRIC = "metric"
    WARNING = "warning"
    ERROR = "error"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    HEARTBEAT = "heartbeat"


class BaseEvent(BaseModel):
    """Base class for all events."""

    type: EventType
    timestamp: int = Field(default_factory=lambda: int(datetime.now().timestamp()))


class StartedEvent(BaseEvent):
    """Emitted when crawl starts."""

    type: EventType = EventType.STARTED
    metadata: dict[str, Any] = Field(default_factory=dict)


class ProgressEvent(BaseEvent):
    """Emitted to report crawl progress."""

    type: EventType = EventType.PROGRESS
    current: int
    total: int
    currentUrl: str


class PageCrawledEvent(BaseEvent):
    """Emitted when a single page is crawled."""

    type: EventType = EventType.PAGE_CRAWLED
    url: str
    title: str | None = None
    contentLength: int = 0
    imagesCount: int = 0


class MetricEvent(BaseEvent):
    """Emitted to report a metric value."""

    type: EventType = EventType.METRIC
    key: str
    value: int | float


class WarningEvent(BaseEvent):
    """Emitted for non-fatal issues."""

    type: EventType = EventType.WARNING
    message: str
    url: str | None = None


class ErrorEvent(BaseEvent):
    """Emitted when an error occurs."""

    type: EventType = EventType.ERROR
    message: str
    url: str | None = None


class CrawledPage(BaseModel):
    """Data for a single crawled page."""

    url: str
    title: str | None = None
    markdown: str
    html: str | None = None
    images: list[str] = Field(default_factory=list)
    links: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    canonicalUrl: str | None = None
    contentHash: str | None = None
    collectedAt: str | None = None


class CrawlResult(BaseModel):
    """Result of a completed crawl."""

    pagesCount: int
    data: list[CrawledPage]
    errors: list[str] = Field(default_factory=list)
    duration: float  # seconds


class CompletedEvent(BaseEvent):
    """Emitted when crawl completes successfully."""

    type: EventType = EventType.COMPLETED
    result: CrawlResult


class CancelledEvent(BaseEvent):
    """Emitted when crawl is cancelled."""

    type: EventType = EventType.CANCELLED
    pagesCompleted: int = 0


class HeartbeatEvent(BaseEvent):
    """Emitted periodically to keep connection alive."""

    type: EventType = EventType.HEARTBEAT
