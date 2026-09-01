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
umask 077
chmod 600 "$MCP_LOCAL_CA_CERT"
test "$(stat -c %a "$MCP_LOCAL_CA_CERT")" = 600
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
# #80's private stack environment is the source of host, port, and audience.
export MCP_LOCAL_STACK_ENV_FILE="$PWD/.env.mcp-local"
umask 077
npx --yes bun@1.3.4 run mcp:local:seed
```

`MCP_LOCAL_STACK_ENV_FILE` is required for the CLI seed path and must be the
same `0600` private environment passed to #80 startup. It must contain
`MCP_LOCAL_HOST` and `MCP_LOCAL_HTTPS_PORT`, or one canonical
`MCP_LOCAL_RESOURCE=https://host:port/mcp`; the seed command has no independent
port default. The fixture output file is separate and contains the generated
credentials plus the derived resource, including a non-default HTTPS port.

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

The MCP resource is derived from `MCP_LOCAL_HOST`, `MCP_LOCAL_HTTPS_PORT`, and
the canonical `/mcp` resource in the private environment (the default example
is `https://mcp.localhost:18443/mcp`). Caddy uses its internal local CA; export
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

## Vérification fonctionnelle bornée (POST-SETUP)

Cette commande est un vérificateur post-setup : elle ne démarre ni ne seed la
stack. Elle exige que #80 soit déjà prêt, que #81 ait créé la fixture et que
#83 ait écrit la configuration privée. Elle lit les lignes durables PostgreSQL
de la fixture via `MCP_LOCAL_DATABASE_URL` (URL locale dédiée), charge la
configuration client et les credentials uniquement en mémoire, puis ferme
chaque client SDK dans un `finally`. Elle exécute les parcours modern/legacy,
initialise aussi l’opérateur, découvre outils/ressources, ping, matrice
reviewer/operator/viewer, relecture idempotente, lookup foreign et token
révoqué. Pour le protocole moderne `2026-07-28`, le ping RPC standalone est
explicitement not applicable (`MCP_PROTOCOL_PING_NOT_APPLICABLE`); le parcours
prouve `initialize`, `tools/list`, `resources/list`, `resources/read` et l’outil
`noosphere_ping`. Le protocole legacy `2025-06-18` conserve le ping RPC via le
SDK ou le fallback SSE borné et authentifié. Toute autre erreur reste bloquante.
L’opérateur (rôle `operator`, `mcp:read` + `mcp:write`) exécute les préparations
conversation et contenu, chacune avec sa relecture idempotente. Le reviewer,
qui porte `mcp:approve`, ne prépare jamais : son appel de préparation est une
preuve négative `MCP_GOVERNED_EFFECT_FORBIDDEN`; il exécute uniquement
`approval_decide` avec l’`approvalItemId` retourné par l’opérateur. Le viewer
reste négatif pour les écritures, décisions et identifiants foreign/révoqués.
Les identifiants sont ceux du resolver #81, jamais déduits d’un
argument MCP :

```sh
export MCP_LOCAL_CLIENT_CONFIG_PATH="$PWD/.mcp-local/client.json"
export MCP_LOCAL_FIXTURE_KEY='local-demo'
export MCP_LOCAL_DATABASE_URL='postgres://local@127.0.0.1/noosphere_mcp_local'
MCP_LOCAL_VERIFY_MAX_CALLS=192 MCP_LOCAL_VERIFY_TIMEOUT_MS=30000 \
  npx --yes bun@1.3.4 run mcp:local:verify
```

Le rapport est limité à `PASS`/`FAIL`, codes stables, correlation ID,
identifiants fixture bornés et compteurs durables. Il ne contient ni bearer,
URL DB, paramètres MCP, payload provider ni message d’exception. Les sondes
malformed/body-limit/rate/origin/audience/correlation sont obligatoires et
exécutées à travers l’endpoint HTTPS avec sa CA privée; un harness absent fait
échouer avec `MCP_LOCAL_EDGE_PROBE_REQUIRED`. Un lecteur durable qui ne peut
pas prouver la frontière durable renvoie une erreur et le rapport échoue fermé.
La métrique `providerBoundaryAttempts` est calculée uniquement depuis les
traces `attempt` bornées du proposal content généré : une exécution valide
observe exactement un marqueur et un outcome durable. Les replays et lectures
de réconciliation conservent les mêmes IDs et compteurs; cette preuve ne mesure
pas un appel provider externe.
Les suites locales restent opt-in et exigent la même URL DB dédiée :

```sh
MCP_LOCAL_VERIFICATION_INTEGRATION=1 \
  MCP_LOCAL_DATABASE_URL='postgres://local@127.0.0.1/noosphere_mcp_local' \
  npx --yes bun@1.3.4 test tests/integration/mcp-local-verification.test.ts
```

## Stop and cleanup

Use the fixture-key cleanup command before stopping the project. It removes
only mutable rows belonging to the exact local fixture key. The immutable
content source chain from migration 0070 is deliberately retained under its
scoped fixture workspace; cleanup never disables or bypasses its protection.
Because those immutable rows are retained, a later run must use a new
`MCP_LOCAL_FIXTURE_KEY`; reusing the cleaned key fails closed with
`MCP_SMOKE_FIXTURE_IMMUTABLE_RETAINED` instead of replacing source rows.
Then stop/remove project containers without deleting volumes:

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
