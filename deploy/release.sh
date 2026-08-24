#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
STATE_DIR="${RELEASE_STATE_DIR:-$APP_DIR/.deploy}"
MANIFEST_FILE="$STATE_DIR/last-successful-release.json"
LEGACY_VERSION_FILE="$STATE_DIR/last-successful-version"
cd "$APP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing production environment file: $ENV_FILE" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
# shellcheck disable=SC1091
source deploy/lib/images.sh

DEPLOY_PROFILE="${DEPLOY_PROFILE:-production}"
DEPLOY_MODE="${DEPLOY_MODE:-registry}"
BACKUP_MODE="${BACKUP_MODE:-restic}"
export DEPLOY_PROFILE DEPLOY_MODE BACKUP_MODE

: "${APP_VERSION:?Set APP_VERSION to an immutable release tag such as v0.1.0}"
if [[ ! "$APP_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9._-]+)?$ ]]; then
  echo "APP_VERSION must be an immutable vX.Y.Z release tag" >&2
  exit 1
fi

ENV_FILE="$ENV_FILE" bash deploy/validate-production-env.sh
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

noosphere_export_images
export APP_VERSION
export APP_ENV_FILE="$ENV_FILE"

compose=(
  docker compose
  --env-file "$ENV_FILE"
  -f compose.infrastructure.yml
  -f compose.production.yml
)

requested_backend_image="$BACKEND_IMAGE"
requested_web_image="$WEB_IMAGE"
requested_crawler_image="$CRAWLER_IMAGE"

json_value() {
  local file="$1"
  local key="$2"
  python3 - "$file" "$key" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    value = json.load(handle)
for part in sys.argv[2].split("."):
    value = value[part]
print(value)
PY
}

image_id() {
  docker image inspect --format '{{.Id}}' "$1"
}

image_digest_ref() {
  local ref="$1"
  local repository digests digest
  repository="$(python3 - "$ref" <<'PY'
import sys

reference = sys.argv[1].split("@", 1)[0]
last_slash = reference.rfind("/")
last_colon = reference.rfind(":")
if last_colon > last_slash:
    reference = reference[:last_colon]
print(reference)
PY
)"
  digests="$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$ref")"
  if [[ -z "$digests" ]]; then
    echo "No immutable repository digest is available for $ref" >&2
    return 1
  fi
  while IFS= read -r digest; do
    if [[ "$digest" == "$repository@"* ]]; then
      printf '%s\n' "$digest"
      return 0
    fi
  done <<<"$digests"
  echo "No immutable digest matching repository $repository is available for $ref" >&2
  return 1
}

prepare_application_images() {
  if [[ "$DEPLOY_MODE" == "registry" ]]; then
    docker pull "$requested_backend_image"
    docker pull "$requested_web_image"
    docker pull "$requested_crawler_image"
    BACKEND_IMAGE="$(image_digest_ref "$requested_backend_image")"
    WEB_IMAGE="$(image_digest_ref "$requested_web_image")"
    CRAWLER_IMAGE="$(image_digest_ref "$requested_crawler_image")"
  else
    BACKEND_IMAGE="$requested_backend_image"
    WEB_IMAGE="$requested_web_image"
    CRAWLER_IMAGE="$requested_crawler_image"
    export BACKEND_IMAGE WEB_IMAGE CRAWLER_IMAGE
    "${compose[@]}" build --pull migrate web crawler
  fi
  export BACKEND_IMAGE WEB_IMAGE CRAWLER_IMAGE
}

write_release_manifest() {
  local output="$1"
  local backend_id web_id crawler_id
  backend_id="$(image_id "$BACKEND_IMAGE")"
  web_id="$(image_id "$WEB_IMAGE")"
  crawler_id="$(image_id "$CRAWLER_IMAGE")"
  RELEASE_MANIFEST_PATH="$output" \
  RELEASE_BACKEND_ID="$backend_id" \
  RELEASE_WEB_ID="$web_id" \
  RELEASE_CRAWLER_ID="$crawler_id" \
  RELEASE_BACKEND_SOURCE="$requested_backend_image" \
  RELEASE_WEB_SOURCE="$requested_web_image" \
  RELEASE_CRAWLER_SOURCE="$requested_crawler_image" \
  python3 - <<'PY'
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

target = Path(os.environ["RELEASE_MANIFEST_PATH"])
manifest = {
    "schemaVersion": 1,
    "recordedAt": datetime.now(timezone.utc).isoformat(),
    "appVersion": os.environ["APP_VERSION"],
    "deployProfile": os.environ["DEPLOY_PROFILE"],
    "deployMode": os.environ["DEPLOY_MODE"],
    "backupMode": os.environ["BACKUP_MODE"],
    "images": {
        "backend": {
            "source": os.environ["RELEASE_BACKEND_SOURCE"],
            "exact": os.environ["BACKEND_IMAGE"],
            "imageId": os.environ["RELEASE_BACKEND_ID"],
        },
        "web": {
            "source": os.environ["RELEASE_WEB_SOURCE"],
            "exact": os.environ["WEB_IMAGE"],
            "imageId": os.environ["RELEASE_WEB_ID"],
        },
        "crawler": {
            "source": os.environ["RELEASE_CRAWLER_SOURCE"],
            "exact": os.environ["CRAWLER_IMAGE"],
            "imageId": os.environ["RELEASE_CRAWLER_ID"],
        },
    },
}
target.parent.mkdir(parents=True, exist_ok=True)
with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=target.parent, delete=False) as handle:
    json.dump(manifest, handle, indent=2, sort_keys=True)
    handle.write("\n")
    temporary = Path(handle.name)
temporary.chmod(0o600)
temporary.replace(target)
PY
}

load_previous_release() {
  if [[ -f "$MANIFEST_FILE" ]]; then
    previous_version="$(json_value "$MANIFEST_FILE" appVersion)"
    previous_mode="$(json_value "$MANIFEST_FILE" deployMode)"
    previous_backend="$(json_value "$MANIFEST_FILE" images.backend.exact)"
    previous_web="$(json_value "$MANIFEST_FILE" images.web.exact)"
    previous_crawler="$(json_value "$MANIFEST_FILE" images.crawler.exact)"
    previous_backend_id="$(json_value "$MANIFEST_FILE" images.backend.imageId)"
    previous_web_id="$(json_value "$MANIFEST_FILE" images.web.imageId)"
    previous_crawler_id="$(json_value "$MANIFEST_FILE" images.crawler.imageId)"
    return
  fi

  # One-release compatibility with the old version-only state file.
  if [[ -f "$LEGACY_VERSION_FILE" ]]; then
    previous_version="$(tr -d '[:space:]' < "$LEGACY_VERSION_FILE")"
    previous_mode="registry"
    previous_backend="${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}/${IMAGE_PREFIX}-backend:${previous_version}"
    previous_web="${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}/${IMAGE_PREFIX}-web:${previous_version}"
    previous_crawler="${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}/${IMAGE_PREFIX}-crawler:${previous_version}"
  fi
}

previous_version=""
previous_mode=""
previous_backend=""
previous_web=""
previous_crawler=""
previous_backend_id=""
previous_web_id=""
previous_crawler_id=""
load_previous_release

verify_local_rollback_image() {
  local ref="$1"
  local expected_id="$2"
  if [[ -z "$expected_id" ]]; then return 0; fi
  local current_id
  current_id="$(image_id "$ref" 2>/dev/null || true)"
  if [[ "$current_id" != "$expected_id" ]]; then
    echo "Local rollback image $ref is missing or no longer matches $expected_id" >&2
    return 1
  fi
}

rollback() {
  local exit_code=$?
  trap - ERR
  if [[ -z "$previous_version" || -z "$previous_backend" || "$previous_version" == "$APP_VERSION" ]]; then
    echo "Release failed and no distinct previous application release is available for rollback" >&2
    exit "$exit_code"
  fi

  echo "Release failed. Restoring the exact application images recorded for $previous_version" >&2
  export APP_VERSION="$previous_version"
  export BACKEND_IMAGE="$previous_backend"
  export WEB_IMAGE="$previous_web"
  export CRAWLER_IMAGE="$previous_crawler"
  if [[ "$previous_mode" == "registry" ]]; then
    docker pull "$BACKEND_IMAGE"
    docker pull "$WEB_IMAGE"
    docker pull "$CRAWLER_IMAGE"
  else
    verify_local_rollback_image "$BACKEND_IMAGE" "$previous_backend_id"
    verify_local_rollback_image "$WEB_IMAGE" "$previous_web_id"
    verify_local_rollback_image "$CRAWLER_IMAGE" "$previous_crawler_id"
  fi
  "${compose[@]}" up -d --no-build --remove-orphans crawler api web worker decision-worker setter-worker memory-worker proxy
  ENV_FILE="$ENV_FILE" bash deploy/healthcheck.sh
  echo "Application images restored. Migrations and volumes were deliberately left untouched." >&2
  exit "$exit_code"
}
trap rollback ERR

"${compose[@]}" config --quiet
prepare_application_images
"${compose[@]}" pull database tei-embedding tei-reranker minio searxng proxy

if [[ "${BACKUP_BEFORE_RELEASE:-true}" == "true" ]] && "${compose[@]}" ps --status running --services | grep -Fxq database; then
  ENV_FILE="$ENV_FILE" bash deploy/backup.sh
fi

"${compose[@]}" up -d --no-build --wait database tei-embedding tei-reranker minio searxng crawler
"${compose[@]}" run --rm --no-deps minio-init
"${compose[@]}" up --no-build migrate
"${compose[@]}" up -d --no-build --wait --remove-orphans api web worker decision-worker setter-worker memory-worker proxy

ENV_FILE="$ENV_FILE" bash deploy/healthcheck.sh
write_release_manifest "$MANIFEST_FILE"
printf '%s\n' "$APP_VERSION" > "$LEGACY_VERSION_FILE"
chmod 600 "$LEGACY_VERSION_FILE"
trap - ERR

echo "Noosphere $APP_VERSION is healthy at ${PUBLIC_WEBHOOK_BASE_URL:-the configured public URL}"
