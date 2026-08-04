"""Pydantic schemas for API requests and responses."""

from enum import Enum
import re
from typing import Any

from pydantic import BaseModel, Field, HttpUrl, field_validator


def validate_url_patterns(patterns: list[str]) -> list[str]:
    if len(patterns) > 20:
        raise ValueError("At most 20 URL patterns are allowed")
    for pattern in patterns:
        if len(pattern) > 200:
            raise ValueError("URL patterns are limited to 200 characters")
        if re.search(
            r"\([^)]*(?:\.\*|\.\+|\[[^\]]+\][+*])[^)]*\)[+*]",
            pattern,
        ):
            raise ValueError("Potentially expensive URL pattern")
        try:
            re.compile(pattern)
        except re.error as error:
            raise ValueError("Invalid URL pattern") from error
    return patterns


class CrawlMode(str, Enum):
    """Crawl mode options."""

    STANDARD = "standard"
    DEEP = "deep"
    SINGLE = "single"


class CrawlRequest(BaseModel):
    """Request to start a new crawl job."""

    url: HttpUrl = Field(..., description="Starting URL to crawl")
    limit: int = Field(
        default=100,
        ge=1,
        le=300,
        description="Maximum number of pages to crawl",
    )
    maxDepth: int = Field(
        default=10,
        ge=1,
        le=20,
        description="Maximum crawl depth from starting URL",
    )
    sameDomain: bool = Field(
        default=True,
        description="Only crawl pages on the same domain",
    )
    includeImages: bool = Field(
        default=True,
        description="Extract image URLs from pages",
    )
    mode: CrawlMode = Field(
        default=CrawlMode.STANDARD,
        description="Crawl mode",
    )
    excludePatterns: list[str] = Field(
        default_factory=list,
        description="URL patterns to exclude (regex)",
    )
    includePatterns: list[str] = Field(
        default_factory=list,
        description="URL patterns to include (regex)",
    )
    correlationId: str | None = Field(default=None, max_length=200)
    idempotencyKey: str | None = Field(default=None, min_length=8, max_length=500)

    _validate_patterns = field_validator(
        "excludePatterns",
        "includePatterns",
    )(validate_url_patterns)


class CrawlStartResponse(BaseModel):
    """Response when a crawl job is started."""

    success: bool
    id: str = Field(..., description="Job ID for tracking")
    message: str | None = None


class JobStatus(str, Enum):
    """Possible job statuses."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class CrawlStatusResponse(BaseModel):
    """Response for job status query."""

    id: str
    status: JobStatus
    url: str
    limit: int
    pagesCompleted: int = 0
    pagesTotal: int | None = None
    currentUrl: str | None = None
    startedAt: int | None = None
    completedAt: int | None = None
    error: str | None = None
    result: dict[str, Any] | None = None


class CrawlCancelResponse(BaseModel):
    """Response when a crawl job is cancelled."""

    success: bool
    message: str


class ErrorResponse(BaseModel):
    """Standard error response."""

    success: bool = False
    error: str
    detail: str | None = None


# === Discovery Mode Schemas ===


class DiscoverRequest(BaseModel):
    """Request to discover pages on a website (links only, no content)."""

    url: HttpUrl = Field(..., description="Starting URL to discover")
    maxPages: int = Field(
        default=500,
        ge=1,
        le=300,
        description="Maximum number of pages to discover",
    )
    maxDepth: int = Field(
        default=10,
        ge=1,
        le=20,
        description="Maximum discovery depth",
    )
    sameDomain: bool = Field(
        default=True,
        description="Only discover pages on the same domain",
    )
    excludePatterns: list[str] = Field(
        default_factory=list,
        description="URL patterns to exclude (regex)",
    )
    includePatterns: list[str] = Field(
        default_factory=list,
        description="URL patterns to include (regex)",
    )

    _validate_patterns = field_validator(
        "excludePatterns",
        "includePatterns",
    )(validate_url_patterns)


class DiscoveredPage(BaseModel):
    """A discovered page with metadata."""

    url: str
    title: str | None = None
    depth: int = 0
    path: str = ""  # URL path for grouping (e.g., /docs/api)


class DiscoverResponse(BaseModel):
    """Response with discovered pages."""

    success: bool
    url: str
    pages: list[DiscoveredPage]
    totalFound: int
    duration: float


class CrawlPagesRequest(BaseModel):
    """Request to crawl specific URLs."""

    urls: list[HttpUrl] = Field(
        ...,
        min_length=1,
        max_length=300,
        description="List of URLs to crawl",
    )
    includeImages: bool = Field(
        default=True,
        description="Extract image URLs from pages",
    )
    correlationId: str | None = Field(default=None, max_length=200)
    idempotencyKey: str | None = Field(default=None, min_length=8, max_length=500)


class CrawlPagesStartResponse(BaseModel):
    """Response when selective crawl is started."""

    success: bool
    id: str
    urlCount: int
    message: str | None = None


# === Web Search Schemas ===


class SearchRequest(BaseModel):
    """Request to search the web through the configured provider."""

    query: str = Field(..., min_length=1, max_length=500, description="Search query")
    limit: int = Field(
        default=5,
        ge=1,
        le=10,
        description="Maximum number of results",
    )
    scrapeContent: bool = Field(
        default=False,
        description="If true, also scrape the top results for full markdown content",
    )
    correlationId: str | None = Field(default=None, max_length=200)
    searchDepth: str = Field(default="advanced", pattern="^(basic|advanced)$")


class SearchResult(BaseModel):
    """A single web search result."""

    url: str
    title: str
    description: str
    markdown: str | None = None
    canonicalUrl: str | None = None
    contentHash: str | None = None
    collectedAt: str | None = None
    provider: str


class SearchResponse(BaseModel):
    """Response with web search results."""

    success: bool
    query: str
    results: list[SearchResult]
    totalResults: int
    duration: float
    provider: str
    correlationId: str | None = None
    errors: list[str] = Field(default_factory=list)
