#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
STATE_DIR="${RELEASE_STATE_DIR:-$APP_DIR/.deploy}"
VERSION_FILE="$STATE_DIR/last-successful-version"
cd "$APP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing production environment file: $ENV_FILE" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${APP_VERSION:?Set APP_VERSION to an immutable release tag such as v0.1.0}"
if [[ ! "$APP_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9._-]+)?$ ]]; then
  echo "APP_VERSION must be an immutable vX.Y.Z release tag" >&2
  exit 1
fi

ENV_FILE="$ENV_FILE" bash deploy/validate-production-env.sh
mkdir -p "$STATE_DIR"

compose=(
  docker compose
  --env-file "$ENV_FILE"
  -f compose.infrastructure.yml
  -f compose.production.yml
)

export APP_VERSION
export APP_ENV_FILE="$ENV_FILE"
export BACKEND_IMAGE="${BACKEND_IMAGE:-ghcr.io/ignitionai/noosphere-backend:$APP_VERSION}"
export WEB_IMAGE="${WEB_IMAGE:-ghcr.io/ignitionai/noosphere-web:$APP_VERSION}"
export CRAWLER_IMAGE="${CRAWLER_IMAGE:-ghcr.io/ignitionai/noosphere-crawler:$APP_VERSION}"

previous_version=""
if [[ -f "$VERSION_FILE" ]]; then previous_version="$(tr -d '[:space:]' < "$VERSION_FILE")"; fi

pull_application_images() {
  docker pull "$BACKEND_IMAGE"
  docker pull "$WEB_IMAGE"
  docker pull "$CRAWLER_IMAGE"
}

rollback() {
  local exit_code=$?
  trap - ERR
  if [[ -z "$previous_version" || "$previous_version" == "$APP_VERSION" ]]; then
    echo "Release failed and no previous application version is available for rollback" >&2
    exit "$exit_code"
  fi
  echo "Release failed. Rolling application containers back to $previous_version" >&2
  export APP_VERSION="$previous_version"
  export BACKEND_IMAGE="ghcr.io/ignitionai/noosphere-backend:$previous_version"
  export WEB_IMAGE="ghcr.io/ignitionai/noosphere-web:$previous_version"
  export CRAWLER_IMAGE="ghcr.io/ignitionai/noosphere-crawler:$previous_version"
  pull_application_images
  "${compose[@]}" up -d --no-build --remove-orphans crawler api web worker decision-worker setter-worker memory-worker proxy
  ENV_FILE="$ENV_FILE" bash deploy/healthcheck.sh
  echo "Application images restored. Database migrations are forward-only and were not reverted." >&2
  exit "$exit_code"
}
trap rollback ERR

"${compose[@]}" config --quiet
pull_application_images
"${compose[@]}" pull database tei-embedding tei-reranker minio searxng proxy

if [[ "${BACKUP_BEFORE_RELEASE:-true}" == "true" ]] && "${compose[@]}" ps --status running --services | grep -Fxq database; then
  ENV_FILE="$ENV_FILE" bash deploy/backup.sh
fi

"${compose[@]}" up -d --no-build --wait database tei-embedding tei-reranker minio searxng crawler
"${compose[@]}" run --rm --no-deps minio-init
"${compose[@]}" up --no-build migrate
"${compose[@]}" up -d --no-build --wait --remove-orphans api web worker decision-worker setter-worker memory-worker proxy

ENV_FILE="$ENV_FILE" bash deploy/healthcheck.sh
printf '%s\n' "$APP_VERSION" > "$VERSION_FILE"
trap - ERR

echo "Noosphere $APP_VERSION is healthy at ${PUBLIC_WEBHOOK_BASE_URL:-the configured public URL}"
