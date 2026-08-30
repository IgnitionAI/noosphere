#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OUTPUT_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
DEPLOY_PROFILE="${DEPLOY_PROFILE:-quickstart}"
DEPLOY_MODE="${DEPLOY_MODE:-registry}"
BACKUP_MODE="${BACKUP_MODE:-}"
APP_VERSION="${APP_VERSION:-}"
PUBLIC_HOST="${PUBLIC_HOST:-}"
BOOTSTRAP_OWNER_EMAIL="${BOOTSTRAP_OWNER_EMAIL:-}"
BOOTSTRAP_OWNER_NAME="${BOOTSTRAP_OWNER_NAME:-}"
BOOTSTRAP_WORKSPACE_NAME="${BOOTSTRAP_WORKSPACE_NAME:-Noosphere}"
BOOTSTRAP_WORKSPACE_SLUG="${BOOTSTRAP_WORKSPACE_SLUG:-noosphere}"
AI_PROVIDER="${AI_PROVIDER:-codex-cli}"
IMAGE_REGISTRY="${IMAGE_REGISTRY:-ghcr.io}"
IMAGE_NAMESPACE="${IMAGE_NAMESPACE:-}"
IMAGE_PREFIX="${IMAGE_PREFIX:-noosphere}"
RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-}"
RESTIC_PASSWORD_FILE="${RESTIC_PASSWORD_FILE:-}"
BACKUP_DIR="${BACKUP_DIR:-/srv/noosphere/backups}"
NON_INTERACTIVE=false
FORCE=false

usage() {
  cat <<'EOF'
Usage: bash deploy/configure.sh [options]

  --domain HOST              Public HTTPS hostname
  --admin-email EMAIL        Initial owner email
  --admin-name NAME          Initial owner display name
  --workspace-name NAME      Initial workspace name (default: Noosphere)
  --workspace-slug SLUG      Initial workspace slug (default: noosphere)
  --provider PROVIDER        codex-cli, kimi-code or openai
  --profile PROFILE          quickstart or production
  --mode MODE                registry or local-build
  --backup-mode MODE         local or restic
  --version VERSION          Immutable vX.Y.Z application version
  --image-namespace OWNER    Lowercase GHCR owner/namespace
  --output PATH              Environment file to create
  --restic-repository URL    Required for production
  --restic-password-file P   Required for production; generated if missing
  --non-interactive          Fail instead of prompting for missing values
  --force                    Replace an existing output file
EOF
}

while (($#)); do
  case "$1" in
    --domain) PUBLIC_HOST="${2:?}"; shift 2 ;;
    --admin-email) BOOTSTRAP_OWNER_EMAIL="${2:?}"; shift 2 ;;
    --admin-name) BOOTSTRAP_OWNER_NAME="${2:?}"; shift 2 ;;
    --workspace-name) BOOTSTRAP_WORKSPACE_NAME="${2:?}"; shift 2 ;;
    --workspace-slug) BOOTSTRAP_WORKSPACE_SLUG="${2:?}"; shift 2 ;;
    --provider) AI_PROVIDER="${2:?}"; shift 2 ;;
    --profile) DEPLOY_PROFILE="${2:?}"; shift 2 ;;
    --mode) DEPLOY_MODE="${2:?}"; shift 2 ;;
    --backup-mode) BACKUP_MODE="${2:?}"; shift 2 ;;
    --version) APP_VERSION="${2:?}"; shift 2 ;;
    --image-namespace) IMAGE_NAMESPACE="${2:?}"; shift 2 ;;
    --output) OUTPUT_FILE="${2:?}"; shift 2 ;;
    --restic-repository) RESTIC_REPOSITORY="${2:?}"; shift 2 ;;
    --restic-password-file) RESTIC_PASSWORD_FILE="${2:?}"; shift 2 ;;
    --non-interactive) NON_INTERACTIVE=true; shift ;;
    --force) FORCE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

prompt_value() {
  local variable_name="$1"
  local label="$2"
  local default_value="${3:-}"
  local current="${!variable_name:-}"
  if [[ -n "$current" ]]; then return; fi
  if [[ "$NON_INTERACTIVE" == "true" ]]; then
    echo "Missing required option: $label" >&2
    exit 1
  fi
  local answer
  if [[ -n "$default_value" ]]; then
    read -r -p "$label [$default_value]: " answer
    printf -v "$variable_name" '%s' "${answer:-$default_value}"
  else
    read -r -p "$label: " answer
    printf -v "$variable_name" '%s' "$answer"
  fi
}

detect_namespace() {
  local remote
  remote="$(git -C "$ROOT_DIR" config --get remote.origin.url 2>/dev/null || true)"
  remote="${remote%.git}"
  if [[ "$remote" =~ github\.com[:/]([^/]+)/[^/]+$ ]]; then
    tr '[:upper:]' '[:lower:]' <<<"${BASH_REMATCH[1]}"
  else
    printf '%s\n' ignitionai
  fi
}

random_secret() {
  openssl rand -hex "$1"
}

if [[ -e "$OUTPUT_FILE" && "$FORCE" != "true" ]]; then
  echo "Refusing to overwrite existing environment file: $OUTPUT_FILE" >&2
  echo "Use --force only after backing it up." >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate local secrets" >&2
  exit 1
fi

if [[ -z "$APP_VERSION" ]]; then
  APP_VERSION="$(git -C "$ROOT_DIR" tag --sort=-v:refname 2>/dev/null | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)"
  if [[ -z "$APP_VERSION" && "$DEPLOY_MODE" == "local-build" ]]; then
    source_revision="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD 2>/dev/null || printf unknown)"
    APP_VERSION="v0.0.0-local.${source_revision}"
  fi
  if [[ -z "$APP_VERSION" ]]; then
    prompt_value APP_VERSION "Immutable release version (vX.Y.Z)"
  fi
fi
IMAGE_NAMESPACE="${IMAGE_NAMESPACE:-$(detect_namespace)}"
IMAGE_NAMESPACE="$(tr '[:upper:]' '[:lower:]' <<<"$IMAGE_NAMESPACE")"
if [[ -z "$BACKUP_MODE" ]]; then
  if [[ "$DEPLOY_PROFILE" == "production" ]]; then BACKUP_MODE=restic; else BACKUP_MODE=local; fi
fi

prompt_value PUBLIC_HOST "Public hostname (DNS must point to this VPS)"
prompt_value BOOTSTRAP_OWNER_EMAIL "Initial administrator email"
prompt_value BOOTSTRAP_OWNER_NAME "Initial administrator name"

if [[ "$DEPLOY_PROFILE" == "production" ]]; then
  prompt_value RESTIC_REPOSITORY "Off-site Restic repository"
  if [[ -z "$RESTIC_PASSWORD_FILE" ]]; then
    restic_config_root="${XDG_CONFIG_HOME:-${HOME}/.config}/noosphere"
    RESTIC_PASSWORD_FILE="$restic_config_root/restic-password"
  fi
fi

case "$AI_PROVIDER" in
  codex-cli) ;;
  kimi-code)
    if [[ -z "${KIMI_CODE_API_KEY:-}" && "$NON_INTERACTIVE" != "true" ]]; then
      read -r -s -p "Kimi Code API key: " KIMI_CODE_API_KEY
      echo
    fi
    : "${KIMI_CODE_API_KEY:?KIMI_CODE_API_KEY is required for kimi-code}"
    ;;
  openai)
    if [[ -z "${OPENAI_API_KEY:-}" && "$NON_INTERACTIVE" != "true" ]]; then
      read -r -s -p "OpenAI API key: " OPENAI_API_KEY
      echo
    fi
    : "${OPENAI_API_KEY:?OPENAI_API_KEY is required for openai}"
    ;;
  *) echo "AI_PROVIDER must be codex-cli, kimi-code or openai" >&2; exit 1 ;;
esac

POSTGRES_PASSWORD="$(random_secret 24)"
S3_ACCESS_KEY_ID="$(random_secret 12)"
S3_SECRET_ACCESS_KEY="$(random_secret 32)"
SEARXNG_SECRET="$(random_secret 32)"
CRAWLER_API_KEY="$(random_secret 32)"
BETTER_AUTH_SECRET="$(random_secret 32)"
BOOTSTRAP_OWNER_PASSWORD="$(random_secret 18)"

if [[ "$BACKUP_MODE" == "restic" && ! -f "$RESTIC_PASSWORD_FILE" ]]; then
  install -d -m 700 "$(dirname "$RESTIC_PASSWORD_FILE")"
  umask 077
  printf '%s\n' "$(random_secret 32)" > "$RESTIC_PASSWORD_FILE"
  chmod 600 "$RESTIC_PASSWORD_FILE"
fi

mkdir -p "$(dirname "$OUTPUT_FILE")"
temporary_file="$(mktemp "$(dirname "$OUTPUT_FILE")/.noosphere-env.XXXXXX")"
trap 'rm -f "$temporary_file"' EXIT
umask 077
{
  printf 'DEPLOY_PROFILE=%q\n' "$DEPLOY_PROFILE"
  printf 'DEPLOY_MODE=%q\n' "$DEPLOY_MODE"
  printf 'BACKUP_MODE=%q\n' "$BACKUP_MODE"
  printf 'APP_VERSION=%q\n' "$APP_VERSION"
  printf 'IMAGE_REGISTRY=%q\n' "$IMAGE_REGISTRY"
  printf 'IMAGE_NAMESPACE=%q\n' "$IMAGE_NAMESPACE"
  printf 'IMAGE_PREFIX=%q\n' "$IMAGE_PREFIX"
  printf 'PUBLIC_HOST=%q\n' "$PUBLIC_HOST"
  printf 'BETTER_AUTH_URL=https://%s\n' "$PUBLIC_HOST"
  printf 'BETTER_AUTH_TRUSTED_ORIGINS=https://%s\n' "$PUBLIC_HOST"
  printf 'PUBLIC_WEBHOOK_BASE_URL=https://%s\n' "$PUBLIC_HOST"
  printf 'MCP_ALLOWED_HOSTS=%q\n' "$PUBLIC_HOST"
  printf 'MCP_ALLOWED_ORIGINS=https://%s\n' "$PUBLIC_HOST"
  printf 'MCP_DEV_AUTH_ENABLED=false\nMCP_DEV_AUTH_TOKEN=\nMCP_DEV_USER_ID=\nMCP_DEV_WORKSPACE_ID=\nMCP_DEV_CLIENT_ID=\nMCP_DEV_ROLE=\nMCP_DEV_SCOPES=\nMCP_DEV_AUDIENCE=\n'
  printf '\nPOSTGRES_DB=ignition_outbound\nPOSTGRES_USER=postgres\n'
  printf 'POSTGRES_PASSWORD=%q\n' "$POSTGRES_PASSWORD"
  printf 'S3_BUCKET=ignition-outbound\n'
  printf 'S3_ACCESS_KEY_ID=%q\n' "$S3_ACCESS_KEY_ID"
  printf 'S3_SECRET_ACCESS_KEY=%q\n' "$S3_SECRET_ACCESS_KEY"
  printf 'SEARXNG_SECRET=%q\n' "$SEARXNG_SECRET"
  printf 'CRAWLER_API_KEY=%q\n' "$CRAWLER_API_KEY"
  printf 'BETTER_AUTH_SECRET=%q\n' "$BETTER_AUTH_SECRET"
  printf 'BETTER_AUTH_ALLOW_SIGN_UP=false\n'
  printf 'BOOTSTRAP_OWNER_EMAIL=%q\n' "$BOOTSTRAP_OWNER_EMAIL"
  printf 'BOOTSTRAP_OWNER_NAME=%q\n' "$BOOTSTRAP_OWNER_NAME"
  printf 'BOOTSTRAP_OWNER_PASSWORD=%q\n' "$BOOTSTRAP_OWNER_PASSWORD"
  printf 'BOOTSTRAP_WORKSPACE_SLUG=%q\n' "$BOOTSTRAP_WORKSPACE_SLUG"
  printf 'BOOTSTRAP_WORKSPACE_NAME=%q\n' "$BOOTSTRAP_WORKSPACE_NAME"
  printf '\nAI_PROVIDER=%q\n' "$AI_PROVIDER"
  printf 'CODEX_DEFAULT_MODEL=gpt-5.6-luna\nCODEX_DEFAULT_REASONING_EFFORT=xhigh\nCODEX_FALLBACK_MODELS=gpt-5.4-mini\nCODEX_BINARY_PATH=codex\n'
  printf 'KIMI_CODE_API_KEY=%q\n' "${KIMI_CODE_API_KEY:-}"
  printf 'KIMI_CODE_BASE_URL=https://api.kimi.com/coding/v1\nKIMI_RESEARCH_MODELS=k3,k3-256k\nPROSPECT_DECISION_MODEL=k3\nKIMI_SYNTHESIS_MODELS=k3-256k,k3\nKIMI_FALLBACK_MODELS=kimi-for-coding-highspeed\n'
  printf 'OPENAI_API_KEY=%q\n' "${OPENAI_API_KEY:-}"
  printf '\nTEI_EMBEDDING_RUNTIME_MODEL_ID=janni-t/qwen3-embedding-0.6b-int8-tei-onnx\n'
  printf 'TEI_EMBEDDING_RUNTIME_MODEL_SHA=8fe0c238c7c48016d28e750413ca492024be3ddf\nTEI_EMBEDDING_DIMENSION=1024\n'
  printf 'TEI_RERANKER_RUNTIME_MODEL_ID=csylabs/bge-reranker-v2-m3-int8-onnx\nTEI_RERANKER_RUNTIME_MODEL_SHA=eaf5072d7b1a3f1fa584cc7482c7efb8f784dca0\n'
  printf '\nUNIPILE_ENABLED=false\nUNIPILE_DSN=\nUNIPILE_API_KEY=\nUNIPILE_LINKEDIN_ACCOUNT_ID=\nUNIPILE_WHATSAPP_ACCOUNT_ID=\nUNIPILE_WEBHOOK_SECRET=\n'
  printf 'UNIPILE_INBOX_SYNC_ENABLED=false\nUNIPILE_SOCIAL_CONTENT_SYNC_ENABLED=false\nUNIPILE_SOCIAL_ENGAGEMENT_SYNC_ENABLED=false\n'
  printf 'CALENDAR_ENABLED=false\nCALENDAR_WEBHOOK_SIGNING_KEY=\n'
  printf '\nOUTBOUND_LINKEDIN_DAILY_LIMIT=20\nOUTBOUND_EMAIL_DAILY_LIMIT=50\nOUTBOUND_WHATSAPP_DAILY_LIMIT=30\nBOOKING_URL=\n'
  printf 'BACKUP_DIR=%q\n' "$BACKUP_DIR"
  printf 'RESTIC_REPOSITORY=%q\n' "$RESTIC_REPOSITORY"
  printf 'RESTIC_PASSWORD_FILE=%q\n' "$RESTIC_PASSWORD_FILE"
  printf 'AWS_ACCESS_KEY_ID=%q\n' "${AWS_ACCESS_KEY_ID:-}"
  printf 'AWS_SECRET_ACCESS_KEY=%q\n' "${AWS_SECRET_ACCESS_KEY:-}"
  printf 'ALERT_WEBHOOK_URL=%q\n' "${ALERT_WEBHOOK_URL:-}"
} > "$temporary_file"
chmod 600 "$temporary_file"
mv "$temporary_file" "$OUTPUT_FILE"
trap - EXIT

ENV_FILE="$OUTPUT_FILE" bash "$ROOT_DIR/deploy/validate-production-env.sh"

echo
echo "Configuration created at $OUTPUT_FILE with permissions 0600."
echo "No secret was sent to Noosphere or to a remote configurator."
echo
echo "Next commands:"
echo "  ENV_FILE=$OUTPUT_FILE bash deploy/doctor.sh"
if [[ "$AI_PROVIDER" == "codex-cli" ]]; then
  echo "  docker compose --env-file $OUTPUT_FILE -f compose.infrastructure.yml -f compose.production.yml --profile codex-auth run --rm codex-auth"
fi
echo "  ENV_FILE=$OUTPUT_FILE bash deploy/release.sh"
echo "  sudo APP_DIR=$ROOT_DIR bash deploy/install-systemd.sh"
if [[ "$BACKUP_MODE" == "local" ]]; then
  echo "WARNING: quickstart backups stay on this VPS. Copy $BACKUP_DIR off-host regularly."
fi
