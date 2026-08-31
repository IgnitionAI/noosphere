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

## Seed the scoped OAuth fixtures

After migrations and readiness, provide the local disposable database explicitly
through `MCP_LOCAL_DATABASE_URL` (or `MCP_LOCAL_TEST_DATABASE_URL`). Never use a
production, QA, or ambient database URL, and never print the value. The seed
command creates two deterministic workspaces: reviewer (`mcp:read`,
`mcp:write`, `mcp:approve`) and operator (`mcp:read`, `mcp:write`) in workspace
A, plus viewer (`mcp:read`) in workspace B. Tokens are written only to the
private environment file with mode `0600`.

```sh
export MCP_LOCAL_DATABASE_URL='postgres://local-only-user:local-only-password@127.0.0.1:5432/noosphere_local'
export MCP_LOCAL_FIXTURE_KEY='local-demo'
export MCP_LOCAL_ENV_FILE="$PWD/.mcp-local/fixture.env"
umask 077
npx --yes bun@1.3.4 run mcp:local:seed
```

Running seed again with the same key and file performs a read/verify/reuse:
identifiers and token hashes must match, and no rows or credentials are
recreated. A partial file or mismatch fails closed. Resolve credentials in the
private process that runs the MCP client; they are not part of status or report
output. The integration test is opt-in only:

```sh
MCP_LOCAL_FIXTURES_INTEGRATION=1 TEST_DATABASE_URL="$MCP_LOCAL_DATABASE_URL" \
  npx --yes bun@1.3.4 test tests/integration/mcp-local-fixtures.test.ts
```

`TEST_DATABASE_URL` above must be a disposable database explicitly dedicated
to this run; it must never be inherited accidentally. The test does not reset
or drop a database.

The cleanup wrapper receives an explicit, local database client and deletes only
the named fixture key; it does not own project stop or volume lifecycle. Callers
must close that client in a `finally` block before invoking the local stop
command.

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

## Client MCP et Inspector

Générez une configuration prête à copier qui ne contient aucun bearer. Les
identités sont des labels bornés (UUID, rôle et scopes) ; `caPath` et
`tokenFilePath` restent des références vers des fichiers privés. Le fichier
de sortie est écrit atomiquement en mode `0600` :

```sh
export MCP_LOCAL_CLIENT_CONFIG_PATH="$PWD/.mcp-local/client.json"
export MCP_LOCAL_RESOURCE="https://mcp.localhost:18443/mcp"
export MCP_LOCAL_CA_CERT="$PWD/.mcp-local/caddy-root.crt"
export MCP_LOCAL_TOKEN_FILE="$MCP_LOCAL_ENV_FILE"
export MCP_LOCAL_IDENTITIES_JSON='[{"name":"reviewer","workspaceId":"00000000-0000-4000-8000-000000000001","role":"reviewer","scopes":["mcp:read","mcp:write","mcp:approve"]},{"name":"operator","workspaceId":"00000000-0000-4000-8000-000000000001","role":"operator","scopes":["mcp:read","mcp:write"]},{"name":"viewer","workspaceId":"00000000-0000-4000-8000-000000000002","role":"viewer","scopes":["mcp:read"]}]'
umask 077
npx --yes bun@1.3.4 scripts/write-mcp-local-client-config.ts
test "$(stat -c %a "$MCP_LOCAL_CLIENT_CONFIG_PATH")" = 600
```

La configuration expose `streamable-http` et le transport legacy `http`, avec
la même audience HTTPS `/mcp`. Résolvez le bearer depuis le fichier privé dans
le processus client ; ne l’ajoutez jamais au JSON, à l’URL, à la ligne de
commande ou aux logs.

Pour l’Inspector, le smoke démarre un forwarder HTTP limité à loopback. Il
injecte l’Authorization uniquement en mémoire avant l’appel HTTPS vers Caddy,
et rédige les diagnostics sans bearer. La commande exacte utilisée par Inspector `0.16.3`
est :

```text
npx --yes @modelcontextprotocol/inspector@0.16.3 --cli http://127.0.0.1:19090/mcp --transport http --method tools/list
```

Activez ce probe dans le processus privé qui a déjà chargé le fichier de
fixture, par exemple avec `MCP_SMOKE_INSPECTOR=true`; ne lancez pas la commande
ci-dessus avec un token en argument. Le probe n’effectue aucun appel réseau
Inspector avant le forwarder et reste optionnel.

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
