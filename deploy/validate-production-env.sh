#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing production environment file: $ENV_FILE" >&2
  exit 1
fi

if stat -c '%a' "$ENV_FILE" >/dev/null 2>&1; then
  ENV_MODE="$(stat -c '%a' "$ENV_FILE")"
else
  ENV_MODE="$(stat -f '%Lp' "$ENV_FILE")"
fi
if [[ "$ENV_MODE" != "600" ]]; then
  echo "Production environment file must have mode 0600: $ENV_FILE (found $ENV_MODE)" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

python3 - <<'PY'
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

profile = os.environ.get("DEPLOY_PROFILE", "production").strip().lower()
deploy_mode = os.environ.get("DEPLOY_MODE", "registry").strip().lower()
backup_mode = os.environ.get("BACKUP_MODE", "restic").strip().lower()
if profile not in {"quickstart", "production"}:
    raise SystemExit("DEPLOY_PROFILE must be quickstart or production")
if deploy_mode not in {"registry", "local-build"}:
    raise SystemExit("DEPLOY_MODE must be registry or local-build")
if backup_mode not in {"local", "restic"}:
    raise SystemExit("BACKUP_MODE must be local or restic")
if profile == "production" and backup_mode != "restic":
    raise SystemExit("DEPLOY_PROFILE=production requires BACKUP_MODE=restic")

required = [
    "APP_VERSION",
    "PUBLIC_HOST",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_TRUSTED_ORIGINS",
    "MCP_ALLOWED_HOSTS",
    "MCP_ALLOWED_ORIGINS",
    "PUBLIC_WEBHOOK_BASE_URL",
    "POSTGRES_PASSWORD",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "SEARXNG_SECRET",
    "CRAWLER_API_KEY",
    "BETTER_AUTH_SECRET",
    "BOOTSTRAP_OWNER_EMAIL",
    "BOOTSTRAP_OWNER_NAME",
    "BOOTSTRAP_OWNER_PASSWORD",
    "BOOTSTRAP_WORKSPACE_SLUG",
    "BOOTSTRAP_WORKSPACE_NAME",
    "TEI_EMBEDDING_RUNTIME_MODEL_ID",
    "TEI_EMBEDDING_RUNTIME_MODEL_SHA",
    "TEI_RERANKER_RUNTIME_MODEL_ID",
    "TEI_RERANKER_RUNTIME_MODEL_SHA",
    "BACKUP_DIR",
]
if backup_mode == "restic":
    required.extend(["RESTIC_REPOSITORY", "RESTIC_PASSWORD_FILE"])

def is_placeholder(value: str) -> bool:
    lowered = value.strip().lower()
    return lowered.startswith(("replace-with-", "change-me", "example-"))

missing = [name for name in required if not os.environ.get(name)]
placeholders = [name for name in required if is_placeholder(os.environ.get(name, ""))]
if missing or placeholders:
    if missing:
        print("Missing deployment variables: " + ", ".join(missing), file=sys.stderr)
    if placeholders:
        print("Placeholder deployment variables: " + ", ".join(placeholders), file=sys.stderr)
    raise SystemExit(1)

provider = os.environ.get("AI_PROVIDER", "kimi-code")
if provider not in ("kimi-code", "codex-cli", "openai"):
    raise SystemExit("AI_PROVIDER must be kimi-code, codex-cli or openai")
if provider == "kimi-code" and not os.environ.get("KIMI_CODE_API_KEY"):
    raise SystemExit("KIMI_CODE_API_KEY is required when AI_PROVIDER=kimi-code")
if provider == "openai" and not os.environ.get("OPENAI_API_KEY"):
    raise SystemExit("OPENAI_API_KEY is required when AI_PROVIDER=openai")

def enabled(name: str) -> bool:
    return os.environ.get(name, "false").strip().lower() in ("1", "true", "yes", "on")

if enabled("UNIPILE_ENABLED"):
    unipile_names = ("UNIPILE_DSN", "UNIPILE_API_KEY", "UNIPILE_WEBHOOK_SECRET")
    missing_unipile = [name for name in unipile_names if not os.environ.get(name)]
    if missing_unipile:
        raise SystemExit("Missing enabled Unipile variables: " + ", ".join(missing_unipile))
    placeholder_unipile = [name for name in unipile_names if is_placeholder(os.environ.get(name, ""))]
    if placeholder_unipile:
        raise SystemExit("Placeholder enabled Unipile variables: " + ", ".join(placeholder_unipile))
if enabled("CALENDAR_ENABLED") and not os.environ.get("CALENDAR_WEBHOOK_SIGNING_KEY"):
    raise SystemExit("CALENDAR_WEBHOOK_SIGNING_KEY is required when CALENDAR_ENABLED=true")
if enabled("CALENDAR_ENABLED") and is_placeholder(os.environ.get("CALENDAR_WEBHOOK_SIGNING_KEY", "")):
    raise SystemExit("CALENDAR_WEBHOOK_SIGNING_KEY cannot be a placeholder")

if os.environ.get("DOCUMENT_EXTRACTOR", "").lower() == "docling":
    raise SystemExit("DOCUMENT_EXTRACTOR=docling is obsolete; remove this legacy configuration")

for name in ("BETTER_AUTH_URL", "PUBLIC_WEBHOOK_BASE_URL"):
    parsed = urlparse(os.environ[name])
    if parsed.scheme != "https" or not parsed.netloc:
        raise SystemExit(f"{name} must be an HTTPS URL")

trusted = [item.strip() for item in os.environ["BETTER_AUTH_TRUSTED_ORIGINS"].split(",") if item.strip()]
if not trusted or any(urlparse(item).scheme != "https" for item in trusted):
    raise SystemExit("BETTER_AUTH_TRUSTED_ORIGINS must contain HTTPS origins")

host = os.environ["PUBLIC_HOST"]
if "://" in host or "/" in host or ":" in host:
    raise SystemExit("PUBLIC_HOST must be a hostname without a scheme, port or path")
if not re.fullmatch(r"(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}", host):
    raise SystemExit("PUBLIC_HOST must be a valid public DNS hostname")

expected_origin = f"https://{host}"
if os.environ["BETTER_AUTH_URL"].rstrip("/") != expected_origin:
    raise SystemExit("BETTER_AUTH_URL must use PUBLIC_HOST")
if os.environ["PUBLIC_WEBHOOK_BASE_URL"].rstrip("/") != expected_origin:
    raise SystemExit("PUBLIC_WEBHOOK_BASE_URL must use PUBLIC_HOST")
if expected_origin not in [item.rstrip("/") for item in trusted]:
    raise SystemExit("BETTER_AUTH_TRUSTED_ORIGINS must include the PUBLIC_HOST HTTPS origin")
allowed_hosts = [item.strip() for item in os.environ["MCP_ALLOWED_HOSTS"].split(",") if item.strip()]
if allowed_hosts != [host]:
    raise SystemExit("MCP_ALLOWED_HOSTS must contain only PUBLIC_HOST")
allowed_origins = [item.strip().rstrip("/") for item in os.environ["MCP_ALLOWED_ORIGINS"].split(",") if item.strip()]
if not allowed_origins or any(
    urlparse(item).scheme != "https" or not urlparse(item).netloc or urlparse(item).path not in ("", "/")
    or urlparse(item).params or urlparse(item).query or urlparse(item).fragment
    for item in allowed_origins
):
    raise SystemExit("MCP_ALLOWED_ORIGINS must contain HTTPS origins without paths or queries")
if expected_origin not in allowed_origins:
    raise SystemExit("MCP_ALLOWED_ORIGINS must include the PUBLIC_HOST HTTPS origin")
if os.environ.get("BETTER_AUTH_ALLOW_SIGN_UP", "").lower() != "false":
    raise SystemExit("BETTER_AUTH_ALLOW_SIGN_UP must be false for a private deployment")
if profile == "production" and enabled("MCP_DEV_AUTH_ENABLED"):
    raise SystemExit("MCP_DEV_AUTH_ENABLED must be false or absent in production")
if not re.fullmatch(r"v\d+\.\d+\.\d+(?:[.-][A-Za-z0-9._-]+)?", os.environ["APP_VERSION"]):
    raise SystemExit("APP_VERSION must be an immutable vX.Y.Z release tag")

for name in ("BACKUP_DIR",):
    value = os.environ[name]
    if not value.startswith("/") or value == "/":
        raise SystemExit(f"{name} must be an explicit absolute path")
if backup_mode == "restic":
    password_file = os.environ["RESTIC_PASSWORD_FILE"]
    if not password_file.startswith("/") or password_file == "/":
        raise SystemExit("RESTIC_PASSWORD_FILE must be an explicit absolute path")
    repository = os.environ["RESTIC_REPOSITORY"]
    if repository.startswith(("/", "local:")):
        raise SystemExit("Production Restic storage must be outside the VPS")

registry = os.environ.get("IMAGE_REGISTRY", "ghcr.io")
namespace = os.environ.get("IMAGE_NAMESPACE", "ignitionai")
prefix = os.environ.get("IMAGE_PREFIX", "noosphere")
coordinate_pattern = re.compile(r"[a-z0-9]+(?:[._-][a-z0-9]+)*")
if "://" in registry or registry.endswith("/"):
    raise SystemExit("IMAGE_REGISTRY must be a registry host without scheme or trailing slash")
if not coordinate_pattern.fullmatch(namespace):
    raise SystemExit("IMAGE_NAMESPACE must be lowercase and registry safe")
if not coordinate_pattern.fullmatch(prefix):
    raise SystemExit("IMAGE_PREFIX must be lowercase and registry safe")

env_path = Path(os.environ.get("ENV_FILE", ".env"))
if env_path.exists() and env_path.stat().st_mode & 0o077:
    print(f"Warning: {env_path} is readable by group or others; use chmod 600", file=sys.stderr)
if profile == "quickstart" and backup_mode == "local":
    print("Quickstart validation passed. Backups remain on this VPS; copy them off-host regularly.")
else:
    print("Production validation passed with HTTPS and off-site Restic backups.")
PY
