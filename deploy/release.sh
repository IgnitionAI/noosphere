#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$APP_DIR"

if [[ -n "$(git status --porcelain=v1)" ]]; then
  echo "Refusing release with a dirty working tree: $APP_DIR" >&2
  exit 1
fi

git fetch origin dev
git pull --ff-only origin dev

ENV_FILE="${ENV_FILE:-.env}"
ENV_FILE="$ENV_FILE" bash deploy/validate-production-env.sh

compose=(
  docker compose
  --env-file "$ENV_FILE"
  -f compose.infrastructure.yml
  -f compose.production.yml
)

"${compose[@]}" build --pull
"${compose[@]}" up -d database minio searxng crawler minio-init migrate api web worker decision-worker proxy

PUBLIC_WEBHOOK_BASE_URL="$(grep '^PUBLIC_WEBHOOK_BASE_URL=' "$ENV_FILE" | cut -d= -f2- || true)" \
  bash deploy/healthcheck.sh

echo "Ignition Outbound release completed at $(git rev-parse --short HEAD)"
