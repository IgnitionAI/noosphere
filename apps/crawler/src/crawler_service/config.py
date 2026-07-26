"""Configuration settings for the crawler service."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Server settings
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False
    environment: str = "development"

    # SSRF protection — reject crawling internal/private/loopback/link-local
    # addresses (incl. cloud metadata 169.254.169.254) by default. Self-hosted
    # Deployment-only override via ALLOW_PRIVATE_NETWORKS=true.
    allow_private_networks: bool = False

    # API authentication — when set (env CRAWLER_API_KEY), every /crawl
    # endpoint requires a matching X-API-Key header. When unset the service
    # runs in open mode (local dev only — a warning is logged at startup).
    crawler_api_key: str = ""
    searxng_url: str = "http://searxng:8080"
    search_fallback_enabled: bool = True
    outbound_user_agent: str = "IgnitionOutboundResearchBot/1.0"

    # CORS — comma-separated list of origins allowed to call the service from
    # a browser (env CORS_ORIGINS). The Bun backend calls the service
    # server-to-server and is not subject to CORS.
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Crawler settings
    max_concurrent_crawls: int = 4
    max_concurrent_per_domain: int = 2
    default_crawl_limit: int = 100
    max_crawl_limit: int = 300
    rate_limit_delay: float = 0.5  # seconds between requests to same domain
    crawl_timeout: int = 300  # 5 minutes per crawl job
    page_timeout_ms: int = 30_000
    max_markdown_characters: int = 200_000
    max_html_characters: int = 100_000
    respect_robots_txt: bool = True

    # Job settings
    job_ttl_seconds: int = 3600  # 1 hour
    job_cleanup_interval: int = 300  # 5 minutes

    # SSE settings
    sse_heartbeat_interval: int = 30  # seconds


settings = Settings()
