# Shared application runtime boundaries

`packages/bootstrap` owns the process-scoped `NoosphereRuntime` composition
used by the HTTP entry point and available to a future MCP adapter. The runtime
is deliberately transport-neutral: it exposes bounded application capabilities,
request dispatch, authentication, health and shutdown hooks. It does not hold
request, tenant, transcript or session state, and it does not perform an HTTP
loopback.

`packages/bootstrap/src/create-noosphere-api-runtime.ts` owns the complete
infrastructure, auth, handler and route composition. `apps/api/src/index.ts`
only supplies the process environment, keeps the HTTP port and Bun transport,
and delegates each request to the runtime. The worker composition remains
unchanged.

Inbound adapter boundaries are checked by `scripts/verify-architecture.ts`.
MCP adapters under `packages/mcp/` or `packages/interface/src/mcp/` may depend
on application contracts only; direct Drizzle, database schema/persistence or
provider-adapter imports are reported as architecture violations. The checker
uses the TypeScript AST, including static imports, re-exports, dynamic
`import()`, `require()` and `import = require()` declarations, so comments and
ordinary strings cannot trigger a false positive.
