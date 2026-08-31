# Local MCP stack

This runbook is for the disposable local Compose project only. It uses the
existing infrastructure and production-shaped API behind the local Caddy CA;
it never enables development authentication, publishes an API or infrastructure
port, calls a real provider, or contacts a public endpoint.

## Private environment

Create `.env.mcp-local` outside version control with the required local secrets
and mark it `0600` before invoking Compose. Keep bearer values in the private
fixture file created by the fixture task, not in shell history or command
arguments. The local project name is `noosphere-mcp-local`; its only published
ports are loopback `127.0.0.1:18080->80` and `127.0.0.1:18443->443`.

```sh
umask 077
touch .env.mcp-local
chmod 600 .env.mcp-local
test "$(stat -c %a .env.mcp-local)" = 600
```

Populate the file through the approved secret-management flow. Do not print or
commit it. The required values include the database, object-storage, search,
crawler, application-auth, and local MCP settings consumed by
`compose.infrastructure.yml` and `compose.production.yml`.

Provide the local Caddy root certificate separately before starting (for
example, a private copy at `.mcp-local/caddy-root.crt`) and point the startup
process at it. The readiness probe always uses this explicit CA and never
disables TLS verification:

```sh
export MCP_LOCAL_ENV_FILE="$PWD/.env.mcp-local"
export MCP_LOCAL_CA_CERT="$PWD/.mcp-local/caddy-root.crt"
test -f "$MCP_LOCAL_CA_CERT"
test "$(stat -c %a "$MCP_LOCAL_ENV_FILE")" = 600
```

If non-default ports are needed, set `MCP_LOCAL_HTTP_PORT` and
`MCP_LOCAL_HTTPS_PORT` in the private environment file. The start and status
commands read those values from that `0600` file; do not export host-side port
variables or pass a second port configuration. Compose interpolation and the
reported resource then stay identical.

The Docker integration test is opt-in only and requires a separate local,
disposable `TEST_DATABASE_URL` whose credentials and database name match this
private environment. It is never printed or included in status output.

## Start and inspect

Validate the merged topology first; this command is read-only and must not
show a published port for anything except `proxy`:

```sh
npx --yes bun@1.3.4 run mcp:local:status
docker compose --env-file .env.mcp-local \
  -p noosphere-mcp-local \
  -f compose.infrastructure.yml -f compose.production.yml -f compose.mcp-local.yml \
  config --quiet
```

Start performs prerequisite checks, local image builds, migration completion,
Compose readiness, and a bounded Caddy `/health/ready` probe. It starts one
general worker only:

```sh
npx --yes bun@1.3.4 run mcp:local:start
npx --yes bun@1.3.4 run mcp:local:status
```

The MCP resource is
`https://mcp.localhost:18443/mcp`. Caddy uses its internal local CA; export
the CA only in the private client process that performs the later SDK smoke.
Status output is bounded and redacted, and never contains subprocess output,
credentials, or database URLs.

## Stop and cleanup

Use the fixture-key cleanup command before stopping the project. It must delete
only rows belonging to the exact local fixture key. Then stop/remove project
containers without deleting volumes:

```sh
npx --yes bun@1.3.4 run mcp:local:cleanup
npx --yes bun@1.3.4 run mcp:local:stop
```

Never run `docker compose down -v`, `docker volume rm`, a database reset/drop,
or a cleanup command against an existing QA/development/production target.
The local database volume remains available for an explicit later disposable
run; inspect the project name before any restart.

## Failure handling

The wrappers return stable `MCP_LOCAL_*` failure codes and never echo raw
Compose or subprocess output. A failed prerequisite, unsafe mode/port, merged
topology, migration, or readiness check is a failed run—not a skipped pass.
Resolve the private environment or local Docker prerequisite and rerun with the
same bounded project/fixture scope.
