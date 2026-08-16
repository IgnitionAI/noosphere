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
    "PUBLIC_HOST",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_TRUSTED_ORIGINS",
    "PUBLIC_WEBHOOK_BASE_URL",
    "POSTGRES_PASSWORD",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "SEARXNG_SECRET",
    "CRAWLER_API_KEY",
    "DOCLING_API_KEY",
    "BETTER_AUTH_SECRET",
    "KIMI_CODE_API_KEY",
    "OPENAI_API_KEY",
    "UNIPILE_DSN",
    "UNIPILE_API_KEY",
    "UNIPILE_LINKEDIN_ACCOUNT_ID",
    "UNIPILE_WHATSAPP_ACCOUNT_ID",
    "UNIPILE_WEBHOOK_SECRET",
    "CALENDAR_WEBHOOK_SIGNING_KEY",
    "BACKUP_DIR",
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

for name in ("BETTER_AUTH_URL", "PUBLIC_WEBHOOK_BASE_URL"):
    parsed = urlparse(os.environ[name])
    if parsed.scheme != "https" or not parsed.netloc:
        raise SystemExit(f"{name} must be an HTTPS URL")

trusted = [item.strip() for item in os.environ["BETTER_AUTH_TRUSTED_ORIGINS"].split(",") if item.strip()]
if not trusted or any(urlparse(item).scheme != "https" for item in trusted):
    raise SystemExit("BETTER_AUTH_TRUSTED_ORIGINS must contain HTTPS origins")

if "://" in os.environ["PUBLIC_HOST"] or "/" in os.environ["PUBLIC_HOST"]:
    raise SystemExit("PUBLIC_HOST must be a hostname without a scheme or path")

print("Production environment is complete and uses HTTPS origins")
PY
