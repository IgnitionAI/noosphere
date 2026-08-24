#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

: "${BACKUP_DIR:?Set BACKUP_DIR in .env before running backups}"

docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml \
  --profile backup run --rm backup-postgres
docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml \
  --profile backup run --rm backup-minio

echo "Backups written under ${BACKUP_DIR}"
