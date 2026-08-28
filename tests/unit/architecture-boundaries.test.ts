import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { verifyArchitecture } from "../../scripts/verify-architecture";

async function fixture(source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "noosphere-architecture-"));
  const directory = join(root, "packages", "interface", "src", "mcp");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "adapter.ts"), source);
  return root;
}

describe("adapter architecture boundaries", () => {
  test("accepts an MCP adapter that depends only on application contracts", async () => {
    const root = await fixture('import type { ContentIdeaApplication } from "@outbound/application/content/content-ideas";\nexport function read(app: ContentIdeaApplication) { return app; }');
    expect(verifyArchitecture({ root, sourceRoots: ["packages"] })).toEqual([]);
  });

  test("rejects direct Drizzle imports in MCP adapters", async () => {
    const root = await fixture('import { eq } from "drizzle-orm";\nexport const query = eq;');
    expect(verifyArchitecture({ root, sourceRoots: ["packages"] }).join("\n")).toContain("drizzle-orm");
  });

  test("rejects schema, persistence and provider adapter imports in MCP adapters", async () => {
    const root = await fixture([
      'import { contacts } from "@outbound/infrastructure/database/schema";',
      'import { PostgresCrmRepository } from "@outbound/infrastructure/crm/postgres-crm-repository";',
      'import { UnipileSocialPublisher } from "@outbound/infrastructure/content/unipile-social-publisher";',
      "void contacts; void PostgresCrmRepository; void UnipileSocialPublisher;",
    ].join("\n"));
    const failures = verifyArchitecture({ root, sourceRoots: ["packages"] }).join("\n");
    expect(failures).toContain("database/schema");
    expect(failures).toContain("persistence");
    expect(failures).toContain("provider");
  });

  test("scans dynamic and require imports while ignoring comments and strings", async () => {
    const root = await fixture(`
      // import { eq } from "drizzle-orm";
      const documentation = 'import { schema } from "@outbound/infrastructure/database/schema"';
      const dynamic = import("postgres");
      const required = require("@outbound/infrastructure/content/unipile-social-publisher");
      void documentation; void dynamic; void required;
    `);
    const failures = verifyArchitecture({ root, sourceRoots: ["packages"] });
    expect(failures.some((failure) => failure.includes("postgres"))).toBe(true);
    expect(failures.some((failure) => failure.includes("provider"))).toBe(true);
    expect(failures.some((failure) => failure.includes("database/schema"))).toBe(false);
    expect(failures.filter((failure) => failure.includes("drizzle-orm"))).toHaveLength(0);
  });

  test("scans ImportEquals require declarations", async () => {
    const root = await fixture(`
      import drizzle = require("drizzle-orm");
      import schema = require("@outbound/infrastructure/database/schema");
      import provider = require("@outbound/infrastructure/content/unipile-social-publisher");
      void drizzle; void schema; void provider;
    `);
    const failures = verifyArchitecture({ root, sourceRoots: ["packages"] });
    expect(failures.some((failure) => failure.includes("drizzle-orm"))).toBe(true);
    expect(failures.some((failure) => failure.includes("database schema"))).toBe(true);
    expect(failures.some((failure) => failure.includes("provider"))).toBe(true);
  });
});
