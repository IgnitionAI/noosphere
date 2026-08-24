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

failures=()
if ! ENV_FILE="$ENV_FILE" PUBLIC_WEBHOOK_BASE_URL="$PUBLIC_WEBHOOK_BASE_URL" bash deploy/healthcheck.sh >/dev/null 2>&1; then
  failures+=("production healthcheck failed")
fi

disk_percent="$(df -P "$ROOT_DIR" | awk 'NR==2 {gsub(/%/, "", $5); print $5}')"
if [[ "${disk_percent:-0}" -ge 85 ]]; then failures+=("disk usage is ${disk_percent}%"); fi

max_memory="$(docker stats --no-stream --format '{{.MemPerc}}' 2>/dev/null | tr -d '%' | awk 'BEGIN {max=0} {if ($1+0>max) max=$1+0} END {printf "%.0f", max}')"
if [[ "${max_memory:-0}" -ge 80 ]]; then failures+=("a container uses ${max_memory}% of its memory limit"); fi

if [[ -d "${BACKUP_DIR:-}" ]]; then
  latest_dump="$(find "$BACKUP_DIR/postgres" -type f -name '*.dump' -mmin -1500 -print -quit 2>/dev/null || true)"
  if [[ -z "$latest_dump" ]]; then failures+=("no PostgreSQL backup completed in the last 25 hours"); fi
else
  failures+=("backup directory is missing")
fi

compose=(docker compose --env-file "$ENV_FILE" -f compose.infrastructure.yml -f compose.production.yml)
failed_jobs="$("${compose[@]}" exec -T database psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-ignition_outbound}" -Atc "select count(*) from jobs where status in ('failed','dead_lettered') and updated_at >= now() - interval '24 hours'" 2>/dev/null || true)"
failed_jobs="${failed_jobs//[[:space:]]/}"
if [[ ! "$failed_jobs" =~ ^[0-9]+$ ]]; then failures+=("job backlog could not be inspected");
elif [[ "$failed_jobs" -gt 0 ]]; then failures+=("${failed_jobs} failed or dead-lettered jobs in 24h"); fi

if (( ${#failures[@]} )); then
  message="Noosphere alert: $(IFS='; '; echo "${failures[*]}")"
  echo "$message" >&2
  if [[ -n "${ALERT_WEBHOOK_URL:-}" ]]; then
    payload="$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1]}))' "$message")"
    curl --fail --silent --show-error -H 'content-type: application/json' --data "$payload" "$ALERT_WEBHOOK_URL" >/dev/null
  fi
  exit 1
fi

echo "Noosphere monitoring checks passed"
