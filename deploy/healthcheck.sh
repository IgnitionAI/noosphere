#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
ENV_FILE="${ENV_FILE:-.env}"
export APP_ENV_FILE="$ENV_FILE"

running_services="$(docker compose --env-file "$ENV_FILE" \
  -f compose.infrastructure.yml -f compose.production.yml ps --status running --services)"
required_services=(database tei-embedding tei-reranker minio searxng crawler api web worker decision-worker setter-worker memory-worker proxy)
for service in "${required_services[@]}"; do
  if ! grep -Fxq "$service" <<<"$running_services"; then
    echo "Required production service is not running: $service" >&2
    exit 1
  fi
  container_id="$(docker compose --env-file "$ENV_FILE" -f compose.infrastructure.yml -f compose.production.yml ps -q "$service")"
  container_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id")"
  if [[ "$container_health" == "unhealthy" ]]; then
    echo "Required production service is unhealthy: $service" >&2
    exit 1
  fi
done

BASE_URL="${PUBLIC_WEBHOOK_BASE_URL:?PUBLIC_WEBHOOK_BASE_URL is required}"
readiness="$(curl --fail --silent --show-error "${BASE_URL%/}/health/ready")"
curl --fail --silent --show-error "${BASE_URL%/}/login" >/dev/null
if ! grep -q '"status":"ready"' <<<"$readiness"; then
  echo "Public API readiness payload is invalid" >&2
  exit 1
fi
echo "Noosphere production healthcheck passed"
