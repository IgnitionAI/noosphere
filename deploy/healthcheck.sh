#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
ENV_FILE="${ENV_FILE:-.env}"

running_services="$(docker compose --env-file "$ENV_FILE" \
  -f compose.infrastructure.yml -f compose.production.yml ps --status running --services)"
required_services=(database minio searxng crawler api web worker decision-worker setter-worker memory-worker proxy)
for service in "${required_services[@]}"; do
  if ! grep -Fxq "$service" <<<"$running_services"; then
    echo "Required production service is not running: $service" >&2
    exit 1
  fi
done

BASE_URL="${PUBLIC_WEBHOOK_BASE_URL:?PUBLIC_WEBHOOK_BASE_URL is required}"
curl --fail --silent --show-error "${BASE_URL%/}/health/ready" >/dev/null
curl --fail --silent --show-error "${BASE_URL%/}/login" >/dev/null
echo "Noosphere production healthcheck passed"
