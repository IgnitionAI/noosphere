#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing production environment file: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

python3 - <<'PY'
import os
import sys
from urllib.parse import urlparse

required = [
    "APP_VERSION",
    "PUBLIC_HOST",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_TRUSTED_ORIGINS",
    "PUBLIC_WEBHOOK_BASE_URL",
    "POSTGRES_PASSWORD",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "SEARXNG_SECRET",
    "CRAWLER_API_KEY",
    "BETTER_AUTH_SECRET",
    "TEI_EMBEDDING_RUNTIME_MODEL_ID",
    "TEI_EMBEDDING_RUNTIME_MODEL_SHA",
    "TEI_RERANKER_RUNTIME_MODEL_ID",
    "TEI_RERANKER_RUNTIME_MODEL_SHA",
    "BACKUP_DIR",
    "RESTIC_REPOSITORY",
    "RESTIC_PASSWORD_FILE",
]
missing = [name for name in required if not os.environ.get(name)]
placeholders = [
    name for name in required
    if os.environ.get(name, "").startswith(("replace-with-", "change-me"))
]
if missing or placeholders:
    if missing:
        print("Missing production variables: " + ", ".join(missing), file=sys.stderr)
    if placeholders:
        print("Placeholder production variables: " + ", ".join(placeholders), file=sys.stderr)
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

def placeholder(name: str) -> bool:
    return os.environ.get(name, "").startswith(("replace-with-", "change-me"))

if enabled("UNIPILE_ENABLED"):
    missing_unipile = [name for name in ("UNIPILE_DSN", "UNIPILE_API_KEY", "UNIPILE_WEBHOOK_SECRET") if not os.environ.get(name)]
    if missing_unipile:
        raise SystemExit("Missing enabled Unipile variables: " + ", ".join(missing_unipile))
    placeholder_unipile = [name for name in ("UNIPILE_DSN", "UNIPILE_API_KEY", "UNIPILE_WEBHOOK_SECRET") if placeholder(name)]
    if placeholder_unipile:
        raise SystemExit("Placeholder enabled Unipile variables: " + ", ".join(placeholder_unipile))
if enabled("CALENDAR_ENABLED") and not os.environ.get("CALENDAR_WEBHOOK_SIGNING_KEY"):
    raise SystemExit("CALENDAR_WEBHOOK_SIGNING_KEY is required when CALENDAR_ENABLED=true")
if enabled("CALENDAR_ENABLED") and placeholder("CALENDAR_WEBHOOK_SIGNING_KEY"):
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

if "://" in os.environ["PUBLIC_HOST"] or "/" in os.environ["PUBLIC_HOST"]:
    raise SystemExit("PUBLIC_HOST must be a hostname without a scheme or path")

expected_origin = f"https://{os.environ['PUBLIC_HOST']}"
if os.environ["BETTER_AUTH_URL"].rstrip("/") != expected_origin:
    raise SystemExit("BETTER_AUTH_URL must use PUBLIC_HOST")
if os.environ["PUBLIC_WEBHOOK_BASE_URL"].rstrip("/") != expected_origin:
    raise SystemExit("PUBLIC_WEBHOOK_BASE_URL must use PUBLIC_HOST")
if expected_origin not in [item.rstrip("/") for item in trusted]:
    raise SystemExit("BETTER_AUTH_TRUSTED_ORIGINS must include the PUBLIC_HOST HTTPS origin")
if os.environ.get("BETTER_AUTH_ALLOW_SIGN_UP", "").lower() != "false":
    raise SystemExit("BETTER_AUTH_ALLOW_SIGN_UP must be false for a private deployment")
if not __import__("re").fullmatch(r"v\d+\.\d+\.\d+(?:[.-][A-Za-z0-9._-]+)?", os.environ["APP_VERSION"]):
    raise SystemExit("APP_VERSION must be an immutable vX.Y.Z release tag")
for name in ("BACKUP_DIR", "RESTIC_PASSWORD_FILE"):
    value = os.environ[name]
    if not value.startswith("/") or value == "/":
        raise SystemExit(f"{name} must be an explicit absolute path")

print("Production environment is complete and uses HTTPS origins")
PY
