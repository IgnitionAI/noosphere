import { describe, expect, test } from "bun:test";
import { assertMcpExpectedRevision } from "@outbound/application/mcp/mcp-write-capabilities";
import {
  MCP_WRITE_TOOL_NAMES,
  canonicalMcpWriteHash,
  mcpWriteToolArgumentsSchema,
  parseMcpWriteArguments,
  isMcpWriteRoleAllowed,
} from "@outbound/interface/mcp/mcp-write-contracts";

describe("MCP safe-write contracts", () => {
  test("publishes exactly the eight internal-only mutation tools", () => {
    expect(MCP_WRITE_TOOL_NAMES).toEqual([
      "company_upsert", "contact_upsert", "opportunity_update", "opportunity_change_stage",
      "prospect_add_note", "content_idea_create", "content_draft_create", "prospect_schedule_dry_run",
    ]);
    expect(MCP_WRITE_TOOL_NAMES).not.toContain("send");
    expect(MCP_WRITE_TOOL_NAMES).not.toContain("publish");
    expect(MCP_WRITE_TOOL_NAMES).not.toContain("book");
  });

  test("requires UUID request keys and bounded strict arguments", () => {
    const requestKey = crypto.randomUUID();
    expect(parseMcpWriteArguments("company_upsert", { requestKey, name: "Acme" })).toMatchObject({ requestKey, name: "Acme" });
    expect(() => parseMcpWriteArguments("company_upsert", { requestKey: "bad", name: "Acme" })).toThrow();
    expect(() => parseMcpWriteArguments("company_upsert", { requestKey, name: "Acme", workspaceId: crypto.randomUUID() })).toThrow();
    expect(() => parseMcpWriteArguments("content_draft_create", { requestKey, body: "x".repeat(100_001) })).toThrow();
  });

  test("allows only write-capable fresh roles and scopes", () => {
    expect(isMcpWriteRoleAllowed("viewer")).toBe(false);
    expect(isMcpWriteRoleAllowed("reviewer")).toBe(false);
    expect(isMcpWriteRoleAllowed("operator")).toBe(true);
    expect(isMcpWriteRoleAllowed("admin")).toBe(true);
    expect(isMcpWriteRoleAllowed("owner")).toBe(true);
  });

  test("canonical hash is key-order independent", () => {
    expect(canonicalMcpWriteHash({ b: 2, a: 1 })).toBe(canonicalMcpWriteHash({ a: 1, b: 2 }));
  });

  test("rejects stale persisted revisions without allowing overwrite", () => {
    expect(() => assertMcpExpectedRevision(2, 1)).toThrow("MCP_WRITE_VERSION_CONFLICT");
    expect(assertMcpExpectedRevision(1, 1)).toBe(1);
    expect(assertMcpExpectedRevision(undefined, 7)).toBe(7);
  });

  test("changeStage uses a locked CAS update before writing history", async () => {
    const source = await Bun.file(new URL("../../packages/infrastructure/src/pipeline/postgres-opportunity-repository.ts", import.meta.url)).text();
    const body = source.split("async changeStage", 2)[1] ?? "";
    expect(body).toContain('.for("update")');
    expect(body).toContain("eq(opportunities.revision, current.revision)");
    expect(body).toContain("if (!updated)");
  });

  test("write ledger exposes lease ownership for crash recovery", async () => {
    const source = await Bun.file(new URL("../../packages/infrastructure/src/auth/postgres-mcp-write-ledger.ts", import.meta.url)).text();
    expect(source).toContain("leaseExpiresAt");
    expect(source).toContain("leaseOwner");
    expect(source).toContain("MCP_WRITE_IN_PROGRESS");
    expect(source).toContain("MCP_WRITE_RECOVERY_REQUIRED");
  });

  test("contact upsert forwards companyId to employment validation", async () => {
    const runtime = await Bun.file(new URL("../../packages/bootstrap/src/create-noosphere-api-runtime.ts", import.meta.url)).text();
    const repository = await Bun.file(new URL("../../packages/infrastructure/src/crm/postgres-crm-repository.ts", import.meta.url)).text();
    expect(runtime).toContain("args.companyId");
    expect(runtime).toContain("upsertMcpContact");
    expect(repository).toContain("addEmployment");
  });

  test("bootstrap composes MCP writes through the atomic infrastructure executor", async () => {
    const source = await Bun.file(new URL("../../packages/bootstrap/src/create-noosphere-api-runtime.ts", import.meta.url)).text();
    expect(source).toContain("createPostgresAtomicMcpWriteCapabilities");
    expect(source).toContain("new PostgresCrmRepository(tx)");
    expect(source).toContain("new PostgresOpportunityRepository(tx)");
  });
});
