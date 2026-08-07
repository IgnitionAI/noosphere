import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, jobs, workspaces } from "@outbound/infrastructure/database/schema";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
import { PostgresImportService } from "@outbound/infrastructure/crm/postgres-import-service";
import type { LeasedJob } from "@outbound/application/jobs/job-queue";
import { createCrmHttpHandler } from "@outbound/interface/http/crm-handler";
import { createImportHttpHandler } from "@outbound/interface/http/import-handler";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-022 CSV imports", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const queue = new PostgresJobQueue(database.client);
  const service = new PostgresImportService(database.db, queue);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const context = { userId, workspaceId, role: "operator" as "operator" | "viewer" | "reviewer" | "admin" | "owner" };
  const imports = createImportHttpHandler({ database: database.db, contextResolver: { async resolve() { return context; } } });
  const crm = createCrmHttpHandler({ database: database.db, contextResolver: { async resolve() { return context; } } });

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `import-a-${workspaceId}`, name: "Import A" },
      { id: otherWorkspaceId, slug: `import-b-${otherWorkspaceId}`, name: "Import B" },
    ]);
    await database.db.insert(authUsers).values({ id: userId, name: "Import Tester", email: `import-${userId}@example.com` });
  });
  afterAll(async () => {
    await database.client`drop trigger if exists audit_logs_immutable_trg on audit_logs`;
    await database.client`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from import_batches where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from contact_suppressions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from companies where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from contacts where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from jobs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from auth_users where id = ${userId}`;
    await database.client`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`create trigger audit_logs_immutable_trg before update or delete on audit_logs for each row execute function reject_audit_log_mutation()`;
    await database.close();
  });

  function post(pathname: string, body: unknown, handler = imports) {
    return handler(new Request(`http://localhost${pathname}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  }

  test("previews without effects, applies valid lines asynchronously, and is idempotent", async () => {
    const csv = [
      "firstName,lastName,email,company,domain,title",
      "Ada,Lovelace,ada-import@example.com,Analytical Engines,engines.example.com,Engineer",
      "Invalid,,not-an-email,,,",
    ].join("\n");
    const created = await post("/api/v1/imports", { filename: "prospects.csv", content: csv });
    expect(created.status).toBe(201);
    const preview = (await created.json()) as { id: string; status: string; rows: Array<{ status: string; reason: string | null }> };
    expect(preview.status).toBe("previewed");
    expect(preview.rows.map((row) => row.status)).toEqual(["valid", "invalid"]);
    const before = await database.client`select count(*)::int as count from contacts where workspace_id = ${workspaceId}`;
    expect(Number(before[0]!.count)).toBe(0);

    context.role = "viewer";
    expect((await post(`/api/v1/imports/${preview.id}/actions/apply`, {})).status).toBe(403);
    context.role = "operator";
    expect((await post(`/api/v1/imports/${preview.id}/actions/apply`, {})).status).toBe(202);

    const leased = await queue.lease({ workerId: `import-test-${crypto.randomUUID()}`, types: ["crm.import.apply"], limit: 1, leaseMs: 30_000, now: new Date() });
    expect(leased).toHaveLength(1);
    await service.process(leased[0]! as LeasedJob<{ batchId: string }>);
    await queue.acknowledge(leased[0]!.id, leased[0]!.lockedBy, new Date());
    const report = await imports(new Request(`http://localhost/api/v1/imports/${preview.id}`));
    const reportBody = (await report.json()) as { status: string; totals: Record<string, number>; rows: Array<{ status: string }> };
    expect(reportBody.status).toBe("completed");
    expect(reportBody.totals.created).toBe(1);
    expect(reportBody.rows.some((row) => row.status === "invalid")).toBe(true);

    const duplicate = await post("/api/v1/imports", { filename: "renamed.csv", content: csv });
    expect(((await duplicate.json()) as { id: string }).id).toBe(preview.id);
    const after = await database.client`select count(*)::int as count from contacts where workspace_id = ${workspaceId}`;
    expect(Number(after[0]!.count)).toBe(1);

    context.workspaceId = otherWorkspaceId;
    expect((await imports(new Request(`http://localhost/api/v1/imports/${preview.id}`))).status).toBe(404);
    context.workspaceId = workspaceId;
  });

  test("rechecks active suppressions at preview and apply boundaries", async () => {
    const suppressedEmail = "suppressed-import@example.com";
    const suppression = await post("/api/v1/suppressions", { identityType: "email", value: suppressedEmail, channel: "global", reason: "opt out" }, crm);
    expect(suppression.status).toBe(201);
    const csv = `firstName,lastName,email\nBlocked,Person,${suppressedEmail}`;
    const created = await post("/api/v1/imports", { filename: "blocked.csv", content: csv });
    const body = (await created.json()) as { id: string; rows: Array<{ status: string; reason: string | null }> };
    expect(body.rows[0]!.status).toBe("suppressed");
    expect(body.rows[0]!.reason).toBe("suppression active");
  });
});
