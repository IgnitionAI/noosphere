# Shared application runtime boundaries

`packages/bootstrap` owns the process-scoped `NoosphereRuntime` composition
used by the HTTP entry point and the stateless MCP adapter. The runtime
is deliberately transport-neutral: it exposes bounded application capabilities,
request dispatch, authentication, health and shutdown hooks. It does not hold
request, tenant, transcript or session state, and it does not perform an HTTP
loopback.

`packages/bootstrap/src/create-noosphere-api-runtime.ts` owns the complete
infrastructure, auth, handler and route composition. `apps/api/src/index.ts`
only supplies the process environment, keeps the HTTP port and Bun transport,
and delegates each request to the runtime. The worker composition remains
unchanged.

The MCP Web Request/Response adapter is mounted at `/mcp` by the API bootstrap.
It uses the official `@modelcontextprotocol/server@2.0.0` Web Standard
`createMcpHandler` with a fresh `McpServer` factory per request. It is stateless
(no `Mcp-Session-Id` is issued), accepts JSON-RPC POST bodies up
to 1 MiB, and exposes only read-only discovery plus the `noosphere_ping` and
`tracer` smoke tools. `MCP_ALLOWED_HOSTS` and `MCP_ALLOWED_ORIGINS` are
allowlists; requests still require Better Auth in production. An explicit
deployment identity declares `MCP_DEV_AUTH_ENABLED=false` plus the explicit
`MCP_DEV_AUTH_TOKEN`, `MCP_DEV_USER_ID`, `MCP_DEV_WORKSPACE_ID`,
`MCP_DEV_CLIENT_ID`, `MCP_DEV_ROLE`, `MCP_DEV_SCOPES`, and
`MCP_DEV_AUDIENCE` fields for local-only opt-in. A dev identity is accepted
only when `NODE_ENV` is not production, the flag is exactly `true`, all
bounded UUID/context fields are configured, and the bearer token matches
exactly. Production validation rejects enabled dev auth. No MCP request loops
back through HTTP, and no provider or database handle is exposed.

Inbound adapter boundaries are checked by `scripts/verify-architecture.ts`.
MCP adapters under `packages/mcp/` or `packages/interface/src/mcp/` may depend
on application contracts only; direct Drizzle, database schema/persistence or
provider-adapter imports are reported as architecture violations. The checker
uses the TypeScript AST, including static imports, re-exports, dynamic
`import()`, `require()` and `import = require()` declarations, so comments and
ordinary strings cannot trigger a false positive.
