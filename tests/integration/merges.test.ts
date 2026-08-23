import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, workspaceProspectMemorySettings, workspaces } from "@outbound/infrastructure/database/schema";
import { PostgresProspectMemoryEventRepository } from "@outbound/infrastructure/prospect-memory/postgres-prospect-memory-repository";
import { createCrmHttpHandler } from "@outbound/interface/http/crm-handler";
import { createMergeHttpHandler } from "@outbound/interface/http/merge-handler";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-024 reversible contact merges", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const context = { userId, workspaceId, role: "operator" as "operator" | "reviewer" | "viewer" | "admin" | "owner" };
  const crm = createCrmHttpHandler({ database: database.db, contextResolver: { async resolve() { return context; } } });
  const merges = createMergeHttpHandler({ database: database.db, contextResolver: { async resolve() { return context; } } });
  const memoryEvents = new PostgresProspectMemoryEventRepository(database.client);

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `merge-a-${workspaceId}`, name: "Merge A" },
      { id: otherWorkspaceId, slug: `merge-b-${otherWorkspaceId}`, name: "Merge B" },
    ]);
    await database.db.insert(authUsers).values({ id: userId, name: "Merge Tester", email: `merge-${userId}@example.com` });
  });
  afterAll(async () => {
    await database.client`drop trigger if exists audit_logs_immutable_trg on audit_logs`;
    await database.client`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from prospect_memory_context_receipts where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from prospect_memory_snapshots where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from prospect_memory_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from jobs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from workspace_prospect_memory_settings where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from contact_merges where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from merge_candidates where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from contact_suppressions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from companies where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from contacts where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from auth_users where id = ${userId}`;
    await database.client`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`create trigger audit_logs_immutable_trg before update or delete on audit_logs for each row execute function reject_audit_log_mutation()`;
    await database.close();
  });

  function post(pathname: string, body: unknown, handler = crm) {
    return handler(new Request(`http://localhost${pathname}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  }
  async function createContact(email: string, companyId: string) {
    const response = await post("/api/v1/contacts", { firstName: "Alex", lastName: "Martin", identities: [{ type: "email", value: email }], employment: { companyId, title: "Counsel" } });
    return (await response.json()) as { id: string };
  }

  test("detects probable matches, merges conservatively, and restores with undo", async () => {
    const companyResponse = await post("/api/v1/companies", { name: "Merge Company", domain: `merge-${workspaceId}.example.com` });
    const company = (await companyResponse.json()) as { id: string };
    const first = await createContact(`alex-one-${workspaceId}@example.com`, company.id);
    const second = await createContact(`alex-two-${workspaceId}@example.com`, company.id);

    const candidatesResponse = await merges(new Request("http://localhost/api/v1/merge-candidates"));
    const candidates = (await candidatesResponse.json()) as Array<{ id: string; matchType: string; primaryContactId: string; secondaryContactId: string; contacts: Array<{ id: string }> }>;
    const candidate = candidates.find((row) => row.contacts.some((contact) => contact.id === first.id) && row.contacts.some((contact) => contact.id === second.id));
    expect(candidate?.matchType).toBe("probable");
    expect(candidate).toBeTruthy();
    const mergedId = candidate!.secondaryContactId;
    const suppression = await post(`/api/v1/contacts/${mergedId}/actions/suppress`, { channel: "global", reason: "Do not contact" });
    expect(suppression.status).toBe(204);

    context.role = "reviewer";
    expect((await post(`/api/v1/merge-candidates/${candidate!.id}/actions/approve`, {}, merges)).status).toBe(403);
    context.role = "operator";
    await database.db.insert(workspaceProspectMemorySettings).values({
      workspaceId,
      captureEnabled: true,
      shadowEnabled: true,
    });
    const approved = await post(`/api/v1/merge-candidates/${candidate!.id}/actions/approve`, {}, merges);
    expect(approved.status).toBe(201);
    const approvedBody = (await approved.json()) as { id: string };

    const linkedEvents = await database.client<Array<{
      source_contact_id: string;
      canonical_contact_id: string;
    }>>`
      select source_contact_id, canonical_contact_id
      from prospect_memory_events
      where workspace_id = ${workspaceId}
        and source_kind = 'contact_merge'
        and source_id = ${approvedBody.id}
        and kind = 'identity_linked'
    `;
    expect(linkedEvents.map((row) => ({ ...row }))).toEqual([{
      source_contact_id: mergedId,
      canonical_contact_id: candidate!.primaryContactId,
    }]);

    const survivor = await crm(new Request(`http://localhost/api/v1/contacts/${candidate!.primaryContactId}`));
    const survivorBody = (await survivor.json()) as { identities: Array<unknown> };
    expect(survivorBody.identities).toHaveLength(2);
    const merged = await crm(new Request(`http://localhost/api/v1/contacts/${mergedId}`));
    expect(((await merged.json()) as { status: string; mergedIntoId: string | null }).status).toBe("suppressed");
    const suppressionAfterMerge = await database.client`select contact_id from contact_suppressions where workspace_id = ${workspaceId} and contact_id = ${candidate!.primaryContactId}`;
    expect(suppressionAfterMerge.length).toBeGreaterThan(0);

    const undone = await post(`/api/v1/contacts/${candidate!.primaryContactId}/actions/undo-merge`, {}, merges);
    expect(undone.status).toBe(200);
    const restored = await crm(new Request(`http://localhost/api/v1/contacts/${mergedId}`));
    expect(((await restored.json()) as { status: string; mergedIntoId: string | null }).status).toBe("suppressed");
    const suppressionAfterUndo = await database.client`select contact_id from contact_suppressions where workspace_id = ${workspaceId} and contact_id = ${mergedId}`;
    expect(suppressionAfterUndo.length).toBeGreaterThan(0);
    const history = await merges(new Request(`http://localhost/api/v1/contacts/${candidate!.primaryContactId}/merges`));
    expect(((await history.json()) as Array<{ status: string }>)[0]!.status).toBe("undone");

    const restoredMemory = await memoryEvents.listAfter({
      workspaceId,
      contactId: mergedId,
      sequenceId: 0,
      limit: 20,
    });
    expect(restoredMemory.some((event) => event.kind === "identity_linked" && event.sourceId === approvedBody.id)).toBe(true);
    expect(restoredMemory.some((event) => event.kind === "identity_unlinked" && event.sourceContactId === mergedId)).toBe(true);
    const survivorMemory = await memoryEvents.listAfter({
      workspaceId,
      contactId: candidate!.primaryContactId,
      sequenceId: 0,
      limit: 20,
    });
    expect(survivorMemory.some((event) => event.kind === "identity_unlinked" && event.sourceContactId === candidate!.primaryContactId)).toBe(true);

    context.workspaceId = otherWorkspaceId;
    const isolated = await merges(new Request("http://localhost/api/v1/merge-candidates"));
    expect(((await isolated.json()) as unknown[])).toHaveLength(0);
    context.workspaceId = workspaceId;
  });
});
