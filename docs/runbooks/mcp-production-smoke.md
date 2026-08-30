# MCP production-like edge smoke

This is a local, opt-in smoke for the production Compose topology. It uses the
same API and Caddy services, the exact `/mcp` route, and the official MCP
TypeScript SDK `@modelcontextprotocol/client@2.0.0`. It never enables
development authentication and it does not call a provider mutation.

## Prerequisites

Use a disposable, production-shaped environment file with real OAuth rows or
tokens issued by the normal authorization-code flow. The environment must have
`BETTER_AUTH_URL` and `MCP_ALLOWED_*` set to the smoke hostname, and must be
kept mode `0600`. The smoke identities are JSON containing opaque bearer
tokens; do not commit this JSON or print it in CI logs.

The identity matrix must include two different workspace IDs and at least one
each of `viewer`, `operator`, and `reviewer` (the reviewer must have
`mcp:read mcp:write mcp:approve`). Every identity needs `mcp:read`.

## Start the loopback TLS edge

Validate the merged topology before starting anything. The resolved config must
show only `127.0.0.1:18080->80` and `127.0.0.1:18443->443` for published ports:

```sh
export MCP_SMOKE_TMP_DIR="$(mktemp -d /tmp/noosphere-mcp-smoke.XXXXXX)"
chmod 700 "$MCP_SMOKE_TMP_DIR"
docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml -f compose.mcp-smoke.yml \
  config --quiet
```

The overlay is intentionally separate from production and publishes only Caddy
on loopback. It uses Caddy's internal CA and does not alter
`compose.production.yml`:

```sh
docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml -f compose.mcp-smoke.yml \
  up -d --wait database migrate api web proxy
docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml -f compose.mcp-smoke.yml \
  cp proxy:/data/caddy/pki/authorities/local/root.crt ./.mcp-smoke-root.crt
export NODE_EXTRA_CA_CERTS="$PWD/.mcp-smoke-root.crt"
```

`mcp-smoke.localhost` resolves locally. The overlay API audience is exactly
`https://mcp-smoke.localhost:18443/mcp`; if ports are changed, use the same
values in the URL/resource and in the overlay environment.

## Prepare and revoke private fixtures

Use a new fixture key per run. The seeder talks to the database over the
Compose-private network, inserts two workspaces, three users/memberships, three
hashed access tokens plus one revoked token, and one bounded proposal/approval
per workspace. It is idempotent for the exact fixture key and never prints
tokens or the database URL:

```sh
export MCP_SMOKE_FIXTURE_KEY="a4-$(openssl rand -hex 6)"
export MCP_SMOKE_CONTAINER_NAME="mcp-smoke-seeder-$MCP_SMOKE_FIXTURE_KEY"
case "$MCP_SMOKE_CONTAINER_NAME" in (*[!A-Za-z0-9_.-]*) echo "invalid smoke container name" >&2; exit 1;; esac
if docker ps -a --format '{{.Names}}' | grep -Fqx -- "$MCP_SMOKE_CONTAINER_NAME"; then
  echo "smoke container name already exists; choose a new fixture key" >&2
  exit 1
fi
export MCP_SMOKE_ENV_FILE_HOST="$MCP_SMOKE_TMP_DIR/mcp-smoke.env"
(
  set -eu
  set -o pipefail
  umask 077
  (set -C; : > "$MCP_SMOKE_ENV_FILE_HOST")
  chmod 600 "$MCP_SMOKE_ENV_FILE_HOST"
  cleanup() { docker rm -f "$MCP_SMOKE_CONTAINER_NAME" >/dev/null 2>&1 || true; }
  trap cleanup EXIT INT TERM
  docker compose --env-file .env \
    -f compose.infrastructure.yml -f compose.production.yml -f compose.mcp-smoke.yml \
    run --name "$MCP_SMOKE_CONTAINER_NAME" mcp-smoke-seeder prepare
  docker cp "$MCP_SMOKE_CONTAINER_NAME:/tmp/mcp-smoke-private/mcp-smoke.env" - |
    tar -xO > "$MCP_SMOKE_ENV_FILE_HOST"
  chmod 600 "$MCP_SMOKE_ENV_FILE_HOST"
  test "$(stat -c %a "$MCP_SMOKE_ENV_FILE_HOST")" = "600"
  test "$(stat -c %u "$MCP_SMOKE_ENV_FILE_HOST")" = "$(id -u)"
)
if docker ps -a --format '{{.Names}}' | grep -Fqx -- "$MCP_SMOKE_CONTAINER_NAME"; then
  echo "smoke seeder container cleanup failed" >&2
  exit 1
fi
set -a; . "$MCP_SMOKE_ENV_FILE_HOST"; set +a
```

The generated file is created by the host shell under `umask 077`, is mode
`0600`, and contains no container-owned file metadata. The bearer values exist
only in the private container until the tar stream is extracted; neither the
container command line nor its output contains tokens. Keep the file outside
the repository and remove only that file and temporary directory after the
smoke. To verify revocation before token expiry, run the scoped command before
a second smoke:

```sh
docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml -f compose.mcp-smoke.yml \
  run --name "mcp-smoke-revoke-$MCP_SMOKE_FIXTURE_KEY" mcp-smoke-seeder revoke
docker rm -f "mcp-smoke-revoke-$MCP_SMOKE_FIXTURE_KEY" >/dev/null
```

## Run the bounded SDK smoke

```sh
export MCP_SMOKE_URL=https://mcp-smoke.localhost:18443/mcp
export MCP_SMOKE_RESOURCE="$MCP_SMOKE_URL"
export MCP_SMOKE_IDENTITIES_JSON='[{"name":"reviewer-a","token":"<opaque-oauth-token>","workspaceId":"<workspace-a-uuid>","role":"reviewer","scopes":["mcp:read","mcp:write","mcp:approve"]},{"name":"viewer-b","token":"<opaque-oauth-token>","workspaceId":"<workspace-b-uuid>","role":"viewer","scopes":["mcp:read"]},{"name":"operator-a","token":"<opaque-oauth-token>","workspaceId":"<workspace-a-uuid>","role":"operator","scopes":["mcp:read","mcp:write"]}]'
export MCP_SMOKE_FOREIGN_PROPOSAL_ID=<proposal-uuid-from-workspace-a>
export MCP_SMOKE_VIEWER_PROPOSAL_ID=<proposal-uuid-owned-by-viewer-b>
# Already membership-revoked (but unexpired) opaque token; never report it.
export MCP_SMOKE_REVOKED_TOKEN=<opaque-revoked-oauth-token>
export MCP_SMOKE_INSPECTOR=true
npx --yes bun@1.3.4 run smoke:mcp-production
```

The runner creates fresh SDK clients for modern auto-negotiation and pinned
legacy mode, then bounds `initialize`, `tools/list`, `resources/list`,
`resources/read`, and `noosphere_ping`. It additionally checks malformed JSON,
body size, unknown method errors, foreign `Origin`, `429` plus `Retry-After`,
correlation headers, reviewer/operator read access, an operator decision guard,
viewer redaction, membership-revoked access, and a foreign proposal without
echoing its ID. Output is
a redacted JSON report containing only endpoint, workspace IDs, roles, protocol
eras, and pass/fail flags. `MCP_SMOKE_INSPECTOR` is optional; when true, the
pinned Inspector CLI runs `tools/list` through a loopback-only forwarding
server. The forwarder adds the OAuth `Authorization` header before sending the
request to Caddy's HTTPS endpoint; the token is supplied only in the runner
process environment and never appears in Inspector argv or output. Inspector
0.16.3 does not implement a `--header` flag (verified with `--help`), so the
runner does not pretend that unsupported syntax works. Its actual fixed
invocation is:

```sh
npx --yes @modelcontextprotocol/inspector@0.16.3 --cli \
  http://127.0.0.1:<ephemeral-loopback-port>/mcp \
  --transport http --method tools/list
```

The loopback forwarder is bounded to 1 MiB and stops with the child process;
no public Inspector port is opened.

The script performs no prepare/approve/send/publish/book/cancel call, so no
provider can be invoked. Use a fresh SDK client after an API restart to verify
durable OAuth/business state; a restart is an operator action and is not
automated by this smoke.

For the restart leg, use the same Compose project and database, then rerun the
smoke with the unchanged environment file:

```sh
docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml -f compose.mcp-smoke.yml \
  restart api
npx --yes bun@1.3.4 run smoke:mcp-production
```

Local image validation is optional and does not publish anything:

```sh
docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml -f compose.mcp-smoke.yml \
  build api web
```

## Cleanup

Stop/remove only the smoke containers and temporary CA/env files. Run the
scoped seeder cleanup before deleting the temp directory. Do not run
`docker compose down -v`, remove named volumes, or touch a shared QA database:

```sh
docker compose --env-file .env \
  -f compose.infrastructure.yml -f compose.production.yml -f compose.mcp-smoke.yml \
  run --name "mcp-smoke-cleanup-$MCP_SMOKE_FIXTURE_KEY" mcp-smoke-seeder cleanup
docker rm -f "mcp-smoke-cleanup-$MCP_SMOKE_FIXTURE_KEY" >/dev/null
rm -f ./.mcp-smoke-root.crt "$MCP_SMOKE_TMP_DIR/mcp-smoke.env"
rmdir "$MCP_SMOKE_TMP_DIR"
```
