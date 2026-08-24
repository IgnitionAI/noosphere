#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
SKIP_HOST_CHECKS="${NOOSPHERE_DOCTOR_SKIP_HOST_CHECKS:-false}"
SKIP_NETWORK="${NOOSPHERE_DOCTOR_SKIP_NETWORK:-false}"

while (($#)); do
  case "$1" in
    --skip-host-checks) SKIP_HOST_CHECKS=true; shift ;;
    --skip-network) SKIP_NETWORK=true; shift ;;
    -h|--help)
      echo "Usage: ENV_FILE=.env bash deploy/doctor.sh [--skip-host-checks] [--skip-network]"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

cd "$ROOT_DIR"
if [[ ! -f "$ENV_FILE" ]]; then echo "Missing environment file: $ENV_FILE" >&2; exit 1; fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
# shellcheck disable=SC1091
source deploy/lib/images.sh
noosphere_export_images
export APP_ENV_FILE="$ENV_FILE"

errors=()
warnings=()
ok() { printf 'OK   %s\n' "$1"; }
warn() { warnings+=("$1"); printf 'WARN %s\n' "$1"; }
fail() { errors+=("$1"); printf 'FAIL %s\n' "$1" >&2; }

if ENV_FILE="$ENV_FILE" bash deploy/validate-production-env.sh >/dev/null; then
  ok "deployment environment is valid"
else
  fail "deployment environment validation failed"
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  ok "Docker daemon is reachable"
else
  fail "Docker daemon is not reachable"
fi
if docker compose version >/dev/null 2>&1; then ok "Docker Compose v2 is available"; else fail "Docker Compose v2 is required"; fi
if command -v curl >/dev/null 2>&1; then ok "curl is available"; else fail "curl is required"; fi
if command -v openssl >/dev/null 2>&1; then ok "openssl is available"; else fail "openssl is required"; fi

if [[ "$SKIP_HOST_CHECKS" != "true" ]]; then
  architecture="$(uname -m)"
  if [[ "$architecture" == "x86_64" || "$architecture" == "amd64" ]]; then
    ok "host architecture is AMD64"
  else
    fail "host architecture is $architecture; the supported VPS target is AMD64"
  fi

  cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 0)"
  ram_kib="$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  ram_gib=$((ram_kib / 1024 / 1024))
  disk_kib="$(df -Pk "$ROOT_DIR" | awk 'NR==2 {print $4}')"
  disk_gib=$((disk_kib / 1024 / 1024))
  if ((cpu_count < 8)); then fail "${cpu_count} CPU cores detected; 8 dedicated cores are the supported minimum"; else ok "${cpu_count} CPU cores detected"; fi
  if ((ram_gib < 15)); then fail "${ram_gib} GiB RAM detected; 16 GiB is the supported minimum"; else ok "${ram_gib} GiB RAM detected"; fi
  if ((disk_gib < 80)); then fail "${disk_gib} GiB free disk detected; 80 GiB free is required"; else ok "${disk_gib} GiB free disk detected"; fi
  if [[ "${DEPLOY_PROFILE:-production}" == "production" ]]; then
    if ((cpu_count < 12)); then warn "production is functional at 8 cores, but 12 dedicated cores are recommended"; fi
    if ((ram_gib < 31)); then warn "production is functional at 16 GiB, but 32 GiB is recommended"; fi
  fi

  for port in 80 443; do
    if command -v ss >/dev/null 2>&1 && ss -H -ltn "sport = :$port" | grep -q .; then
      warn "TCP port $port is already in use; confirm it belongs to the current Noosphere proxy"
    else
      ok "TCP port $port is available"
    fi
  done
else
  warn "host capacity and port checks were skipped"
fi

if [[ "$SKIP_NETWORK" != "true" ]]; then
  if command -v getent >/dev/null 2>&1 && getent ahostsv4 "$PUBLIC_HOST" >/dev/null 2>&1; then
    ok "DNS resolves for $PUBLIC_HOST"
  elif command -v dig >/dev/null 2>&1 && [[ -n "$(dig +short A "$PUBLIC_HOST")" ]]; then
    ok "DNS resolves for $PUBLIC_HOST"
  else
    fail "DNS does not resolve an IPv4 address for $PUBLIC_HOST"
  fi

  if [[ "${DEPLOY_MODE:-registry}" == "registry" ]]; then
    for image in "$BACKEND_IMAGE" "$WEB_IMAGE" "$CRAWLER_IMAGE"; do
      if docker manifest inspect "$image" >/dev/null 2>&1; then
        ok "registry image is readable: $image"
      else
        fail "registry image cannot be read: $image (private forks may require docker login ${IMAGE_REGISTRY})"
      fi
    done
  else
    for file in Dockerfile.backend Dockerfile.web apps/crawler/Dockerfile; do
      if [[ -f "$file" ]]; then ok "local build input exists: $file"; else fail "missing local build input: $file"; fi
    done
  fi
else
  warn "DNS and registry checks were skipped"
fi

compose=(docker compose --env-file "$ENV_FILE" -f compose.infrastructure.yml -f compose.production.yml)
if "${compose[@]}" config --quiet; then ok "Compose configuration is valid"; else fail "Compose configuration is invalid"; fi

env_mode="$(python3 - "$ENV_FILE" <<'PY'
import os
import stat
import sys
print(oct(stat.S_IMODE(os.stat(sys.argv[1]).st_mode)))
PY
)"
if [[ "$env_mode" == "0o600" ]]; then ok "$ENV_FILE uses mode 0600"; else fail "$ENV_FILE uses $env_mode; run chmod 600"; fi

if [[ "${BACKUP_MODE:-restic}" == "restic" ]]; then
  if command -v restic >/dev/null 2>&1; then ok "Restic is installed"; else fail "Restic is required by BACKUP_MODE=restic"; fi
  if [[ -f "${RESTIC_PASSWORD_FILE:-}" ]]; then ok "Restic password file exists"; else fail "Restic password file is missing"; fi
  if [[ "$SKIP_NETWORK" != "true" ]] && command -v restic >/dev/null 2>&1 && [[ -f "${RESTIC_PASSWORD_FILE:-}" ]]; then
    if restic snapshots --no-lock >/dev/null 2>&1; then
      ok "off-site Restic repository is initialized and readable"
    else
      fail "off-site Restic repository is not initialized or cannot be read"
    fi
  fi
else
  warn "backups are local to this VPS; VPS loss also loses the backups"
fi

echo
if ((${#errors[@]})); then
  echo "Doctor found ${#errors[@]} blocking issue(s) and ${#warnings[@]} warning(s)." >&2
  exit 1
fi
echo "Doctor passed with ${#warnings[@]} warning(s). The host is ready for deploy/release.sh."
