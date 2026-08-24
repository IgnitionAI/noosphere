#!/usr/bin/env bash
set -euo pipefail

: "${UNIPILE_DSN:?UNIPILE_DSN is required}"
: "${UNIPILE_API_KEY:?UNIPILE_API_KEY is required}"
: "${UNIPILE_WEBHOOK_SECRET:?UNIPILE_WEBHOOK_SECRET is required}"
: "${PUBLIC_WEBHOOK_BASE_URL:?PUBLIC_WEBHOOK_BASE_URL is required}"

python3 - <<'PY'
import json
import os
import urllib.request

url = os.environ["UNIPILE_DSN"].rstrip("/") + "/api/v1/accounts"
request = urllib.request.Request(
    url,
    headers={"X-API-KEY": os.environ["UNIPILE_API_KEY"], "accept": "application/json"},
)
with urllib.request.urlopen(request, timeout=20) as response:
    payload = json.load(response)

accounts = payload.get("items", payload if isinstance(payload, list) else [])
healthy = {"LINKEDIN": [], "WHATSAPP": [], "GOOGLE_OAUTH": []}
for account in accounts:
    if not isinstance(account, dict):
        continue
    statuses = [
        source.get("status")
        for source in account.get("sources", [])
        if isinstance(source, dict)
    ]
    if account.get("type") in healthy and "OK" in statuses:
        healthy[account["type"]].append(account.get("id", ""))

missing = [kind for kind, ids in healthy.items() if kind in ("LINKEDIN", "WHATSAPP") and not ids]
if missing:
    raise SystemExit("No healthy Unipile account for: " + ", ".join(missing))

print(json.dumps({
    "accounts": len(accounts),
    "healthyLinkedIn": len(healthy["LINKEDIN"]),
    "healthyWhatsApp": len(healthy["WHATSAPP"]),
    "webhookBaseUrl": os.environ["PUBLIC_WEBHOOK_BASE_URL"],
    "quota": "not-tested",
}, sort_keys=True))
PY
