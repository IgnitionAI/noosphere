#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
cd "$ROOT_DIR"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${BACKUP_DIR:?BACKUP_DIR is required}"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE is required}"
restore_dir="$(mktemp -d "${TMPDIR:-/tmp}/noosphere-restore.XXXXXX")"
trap 'rm -rf "$restore_dir"' EXIT

restic restore latest --target "$restore_dir"
dump_file="$(find "$restore_dir" -type f -name '*.dump' -print -quit)"
if [[ -z "$dump_file" ]]; then echo "Restore drill found no PostgreSQL dump" >&2; exit 1; fi
docker run --rm -v "$dump_file:/restore.dump:ro" paradedb/paradedb:v0.23.5 pg_restore --list /restore.dump >/dev/null
if ! find "$restore_dir" -type d -path '*/minio/latest' -print -quit | grep -q .; then
  echo "Restore drill found no MinIO mirror" >&2
  exit 1
fi
echo "Latest off-site backup restored and validated"
