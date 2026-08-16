#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml ps

BASE_URL="${PUBLIC_WEBHOOK_BASE_URL:?PUBLIC_WEBHOOK_BASE_URL is required}"
curl --fail --silent --show-error "${BASE_URL%/}/health/ready" >/dev/null
curl --fail --silent --show-error "${BASE_URL%/}/login" >/dev/null
echo "Ignition Outbound production healthcheck passed"
