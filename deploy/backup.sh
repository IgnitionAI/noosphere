#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
cd "$ROOT_DIR"

if [[ ! -f "$ENV_FILE" ]]; then echo "Missing environment file: $ENV_FILE" >&2; exit 1; fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
export APP_ENV_FILE="$ENV_FILE"

: "${BACKUP_DIR:?Set BACKUP_DIR in the production environment}"
BACKUP_MODE="${BACKUP_MODE:-restic}"
if [[ "$BACKUP_MODE" != "local" && "$BACKUP_MODE" != "restic" ]]; then
  echo "BACKUP_MODE must be local or restic" >&2
  exit 1
fi
if [[ "$BACKUP_DIR" != /* || "$BACKUP_DIR" == "/" ]]; then
  echo "BACKUP_DIR must be an explicit absolute directory below /" >&2
  exit 1
fi
if [[ "$BACKUP_MODE" == "restic" ]]; then
  : "${RESTIC_REPOSITORY:?Set RESTIC_REPOSITORY to encrypted off-site storage}"
  : "${RESTIC_PASSWORD_FILE:?Set RESTIC_PASSWORD_FILE to a root-readable file outside the repository}"
  if [[ ! -f "$RESTIC_PASSWORD_FILE" ]]; then echo "Missing RESTIC_PASSWORD_FILE: $RESTIC_PASSWORD_FILE" >&2; exit 1; fi
  if ! command -v restic >/dev/null; then echo "restic must be installed on the VPS" >&2; exit 1; fi
fi

compose=(docker compose --env-file "$ENV_FILE" -f compose.infrastructure.yml -f compose.production.yml)
mkdir -p "$BACKUP_DIR/postgres" "$BACKUP_DIR/minio"
"${compose[@]}" --profile backup run --rm backup-postgres
"${compose[@]}" --profile backup run --rm backup-minio

if [[ "$BACKUP_MODE" == "restic" ]]; then
  restic snapshots --no-lock >/dev/null
  restic backup "$BACKUP_DIR" --tag noosphere --exclude "$BACKUP_DIR/restore-drills"
  restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
fi

find "$BACKUP_DIR/postgres" -type f -name '*.dump' -mtime +7 -delete
if [[ "$BACKUP_MODE" == "restic" ]]; then
  echo "Local and encrypted off-site Noosphere backups completed"
else
  echo "Local Noosphere backup completed. This quickstart backup is not resilient to VPS loss." >&2
fi
