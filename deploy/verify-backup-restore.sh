#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
cd "$ROOT_DIR"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${BACKUP_DIR:?BACKUP_DIR is required}"
BACKUP_MODE="${BACKUP_MODE:-restic}"
restore_dir="$(mktemp -d "${TMPDIR:-/tmp}/noosphere-restore.XXXXXX")"
trap 'if command -v trash >/dev/null; then trash "$restore_dir"; else echo "Restore files retained in private directory: $restore_dir" >&2; fi' EXIT

if [[ "$BACKUP_MODE" == "restic" ]]; then
  : "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
  : "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE is required}"
  if ! command -v restic >/dev/null; then echo "restic must be installed on the VPS" >&2; exit 1; fi
  restic restore latest --target "$restore_dir"
  backup_root="$restore_dir"
elif [[ "$BACKUP_MODE" == "local" ]]; then
  backup_root="$BACKUP_DIR"
else
  echo "BACKUP_MODE must be local or restic" >&2
  exit 1
fi

dump_file="$(find "$backup_root" -type f -name '*.dump' -print -quit)"
if [[ -z "$dump_file" ]]; then echo "Restore drill found no PostgreSQL dump" >&2; exit 1; fi
docker run --rm -v "$dump_file:/restore.dump:ro" paradedb/paradedb:v0.23.5 pg_restore --list /restore.dump >/dev/null
if ! find "$backup_root" -type d -path '*/minio/latest' -print -quit | grep -q .; then
  echo "Restore drill found no MinIO mirror" >&2
  exit 1
fi
credentials_file="$(find "$backup_root" -type f -name 'ai_*.tar.gz' -print | sort | tail -n 1)"
if [[ -z "$credentials_file" ]]; then echo "Restore drill found no AI credentials archive" >&2; exit 1; fi
docker run --rm --network none --entrypoint /bin/sh -v "$credentials_file:/credentials.tar.gz:ro" paradedb/paradedb:v0.23.5 -ec 'tar -tzf /credentials.tar.gz | grep -q "./environment.env"'
if [[ "$BACKUP_MODE" == "restic" ]]; then
  echo "Latest off-site archives retrieved and checked; an application restore test is still required"
else
  echo "Latest local archives checked. This does not prove application recovery or recovery after VPS loss."
fi
