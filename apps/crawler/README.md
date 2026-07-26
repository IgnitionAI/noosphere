# Crawler Service

Crawl4AI-based crawler microservice with SSE streaming, called by the Bun
backend for site crawling, page discovery and web search.

Web discovery uses the private SearXNG service first and DuckDuckGo HTML as a
controlled fallback. It has no paid search API dependency.

## Authentication

Set `CRAWLER_API_KEY` to require every `/crawl` endpoint to be called with a
matching `X-API-Key` header. The Bun backend sends this header automatically
when its own `CRAWLER_API_KEY` env var is set — use the same value on both
sides.

When `CRAWLER_API_KEY` is **not** set, the service runs in open mode: all
requests are accepted and a warning is logged at startup. This is intended
for local development only. In any shared deployment, set a key and keep the
port non publié. Le fichier `compose.infrastructure.yml` racine conserve le
service uniquement sur le réseau Docker partagé.

`/health` stays unauthenticated so container healthchecks keep working.

## Other configuration

- `CORS_ORIGINS` — comma-separated list of browser origins allowed by CORS
  (default: `http://localhost:3000,http://127.0.0.1:3000`). Server-to-server
  calls from the backend are not subject to CORS.
- `ALLOW_PRIVATE_NETWORKS=true` — disables SSRF protection so the crawler can
  reach private/loopback/link-local addresses. Dangerous, off by default;
  only enable for trusted intranet crawling.

## Development

```bash
uv sync
uv run uvicorn crawler_service.main:app --reload
uv run pytest tests/ -q
```
