# Repository instructions

## Deploy Configuration

- Target: private single-VPS Docker Compose deployment.
- Public URL: `https://noosphere.ignitionai.fr`; the future marketing domain is separate.
- Public ingress: Caddy only, on TCP ports 80 and 443.
- Deployment branch: `main`; releases use immutable semantic-version tags and GHCR images.
- Production directory: `/srv/noosphere`.
- Production environment file: `/srv/noosphere/.env`, never committed.
- Standard release command: `APP_DIR=/srv/noosphere ENV_FILE=/srv/noosphere/.env bash deploy/release.sh`.
- Required gates before a release tag: `bun run check`, `bun run test:integration`, `bun run test:e2e`, dependency audits, Compose validation and a successful backup restore drill.
- Never publish PostgreSQL, MinIO, SearXNG, crawler or TEI ports in production.
- Never delete production volumes or roll back a database migration automatically.
