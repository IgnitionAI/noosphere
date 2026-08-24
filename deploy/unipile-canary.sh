#!/usr/bin/env bash
set -euo pipefail

: "${UNIPILE_DSN:?UNIPILE_DSN is required}"
: "${UNIPILE_API_KEY:?UNIPILE_API_KEY is required}"
: "${CANARY_CONFIRM:?Set CANARY_CONFIRM=SEND_ONE_LIVE_CANARY to authorize one live message}"
: "${CANARY_CHANNEL:?Set CANARY_CHANNEL to whatsapp or linkedin}"
: "${CANARY_ACCOUNT_ID:?CANARY_ACCOUNT_ID is required}"
: "${CANARY_RECIPIENT:?CANARY_RECIPIENT is required}"
: "${CANARY_MESSAGE:?CANARY_MESSAGE is required}"

if [[ "$CANARY_CONFIRM" != "SEND_ONE_LIVE_CANARY" ]]; then
  echo "Refusing live canary: CANARY_CONFIRM is not explicit" >&2
  exit 1
fi

case "$CANARY_CHANNEL" in
  whatsapp)
    endpoint="${UNIPILE_DSN%/}/api/v1/chats"
    whatsapp_recipient=$(printf '%s' "$CANARY_RECIPIENT" | tr -cd '0-9')
    [[ -n "$whatsapp_recipient" ]] || { echo "CANARY_RECIPIENT must contain a phone number" >&2; exit 1; }
    form=(
      -F "account_id=${CANARY_ACCOUNT_ID}"
      -F "text=${CANARY_MESSAGE}"
      -F "attendees_ids=${whatsapp_recipient}@s.whatsapp.net"
    )
    ;;
  linkedin)
    endpoint="${UNIPILE_DSN%/}/api/v1/users/invite"
    json=$(CANARY_ACCOUNT_ID="$CANARY_ACCOUNT_ID" CANARY_RECIPIENT="$CANARY_RECIPIENT" CANARY_MESSAGE="$CANARY_MESSAGE" python3 - <<'PY'
import json
import os
print(json.dumps({
    "account_id": os.environ["CANARY_ACCOUNT_ID"],
    "provider_id": os.environ["CANARY_RECIPIENT"],
    "message": os.environ["CANARY_MESSAGE"],
}))
PY
)
    form=(-H "content-type: application/json" --data "$json")
    ;;
  *)
    echo "CANARY_CHANNEL must be whatsapp or linkedin" >&2
    exit 1
    ;;
esac

response_file=$(mktemp)
trap 'rm -f "$response_file"' EXIT
status=$(/usr/bin/curl -sS -o "$response_file" -w '%{http_code}' \
  -X POST "$endpoint" \
  -H "X-API-KEY: ${UNIPILE_API_KEY}" \
  -H 'accept: application/json' \
  "${form[@]}" || true)

if [[ "$status" == 2* ]]; then
  echo "Unipile live canary accepted (HTTP ${status})"
  exit 0
fi

if [[ "$status" == "422" ]] && grep -qi 'limit_exceeded' "$response_file"; then
  echo "Unipile quota is still exceeded (HTTP 422 limit_exceeded); no activation" >&2
  exit 2
fi

echo "Unipile live canary failed (HTTP ${status}); no activation" >&2
exit 1
