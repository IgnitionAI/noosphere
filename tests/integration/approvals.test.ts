import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { createApprovalHttpHandler } from "@outbound/interface/http/approval-handler";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-033 approval queue", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const approvedContactId = crypto.randomUUID();
  const otherContactId = crypto.randomUUID();
  const context: { userId: string; workspaceId: string; role: "viewer" | "operator" | "reviewer" | "admin" | "owner" } = { userId, workspaceId, role: "admin" };
  const handle = createApprovalHttpHandler({
    database: database.db,
    contextResolver: { async resolve() { return context; } },
  });

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.client`insert into workspaces (id, slug, name) values (${workspaceId}, ${`f033-a-${workspaceId}`}, 'F-033 A'), (${otherWorkspaceId}, ${`f033-b-${otherWorkspaceId}`}, 'F-033 B')`;
    await database.client`insert into auth_users (id, name, email) values (${userId}, 'Approval Tester', ${`f033-${userId}@example.com`})`;
    await database.client`insert into contacts (id, workspace_id, first_name, last_name) values (${contactId}, ${workspaceId}, 'Approval', 'Contact'), (${approvedContactId}, ${workspaceId}, 'Approved', 'Contact'), (${otherContactId}, ${otherWorkspaceId}, 'Other', 'Contact')`;
  });

  afterAll(async () => {
    await database.client`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`alter table audit_logs disable trigger user`;
    await database.client`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`alter table audit_logs enable trigger user`;
    await database.client`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from auth_users where id = ${userId}`;
    await database.close();
  });

  function send(method: string, path: string, body?: unknown) {
    return handle(new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
  }

  async function createItem(contact = contactId, targetWorkspace = workspaceId) {
    const id = crypto.randomUUID();
    await database.client`insert into approval_items (id, workspace_id, contact_id, item_type, channel, content_original, source_updated_at) values (${id}, ${targetWorkspace}, ${contact}, 'first_contact', 'email', ${JSON.stringify({ subject: 'Hello', body: 'Original' })}::jsonb, now())`;
    return id;
  }

  test("keeps original content, supports idempotent decisions, and emits one event", async () => {
    const itemId = await createItem();
    context.role = "reviewer";
    const listed = await send("GET", "/api/v1/approval-items?status=pending");
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { data: Array<{ id: string }> }).data.some((item) => item.id === itemId)).toBe(true);

    const edited = await send("PATCH", `/api/v1/approval-items/${itemId}`, { contentEdited: { subject: "Edited", body: "Edited body" } });
    expect(edited.status).toBe(200);
    const editedBody = await edited.json() as { contentOriginal: { subject: string }; contentEdited: { subject: string } };
    expect(editedBody.contentOriginal.subject).toBe("Hello");
    expect(editedBody.contentEdited.subject).toBe("Edited");

    const approved = await send("POST", `/api/v1/approval-items/${itemId}/actions/approve`, {});
    expect(approved.status).toBe(200);
    expect((await send("POST", `/api/v1/approval-items/${itemId}/actions/approve`, {})).status).toBe(200);
    const events = await database.client<{ count: number }[]>`select count(*)::int as count from outbox_events where workspace_id = ${workspaceId} and aggregate_id = ${itemId} and event_type = 'ApprovalItemApproved'`;
    const audits = await database.client<{ count: number }[]>`select count(*)::int as count from audit_logs where workspace_id = ${workspaceId} and subject_id = ${itemId} and action = 'ApprovalItemApproved'`;
    expect(events[0]?.count).toBe(1);
    expect(audits[0]?.count).toBe(1);
  });

  test("rejects missing justification and excludes invalidated items from bulk decisions", async () => {
    const rejectedId = await createItem();
    expect((await send("POST", `/api/v1/approval-items/${rejectedId}/actions/reject`, {})).status).toBe(422);
    expect((await send("POST", `/api/v1/approval-items/${rejectedId}/actions/reject`, { justification: "Not a fit" })).status).toBe(200);

    const invalidatedId = await createItem();
    const approvedId = await createItem(approvedContactId);
    await database.client`insert into contact_suppressions (id, workspace_id, contact_id, channel, reason) values (${crypto.randomUUID()}, ${workspaceId}, ${contactId}, 'global', 'Requested removal')`;
    const bulk = await send("POST", "/api/v1/approval-items/actions/bulk-decide", { decisions: [{ itemId: invalidatedId, decision: "approve" }, { itemId: approvedId, decision: "approve" }] });
    expect(bulk.status).toBe(200);
    expect(await bulk.json()).toEqual({ approved: [approvedId], rejected: [], invalidated: [invalidatedId], conflicts: [] });
  });

  test("enforces reader/approver permissions and workspace isolation", async () => {
    const itemId = await createItem(otherContactId, otherWorkspaceId);
    context.role = "operator";
    expect((await send("GET", "/api/v1/approval-items")).status).toBe(200);
    expect((await send("POST", `/api/v1/approval-items/${itemId}/actions/approve`, {})).status).toBe(403);
    context.role = "viewer";
    expect((await send("GET", "/api/v1/approval-items")).status).toBe(403);
    context.role = "admin";
    context.workspaceId = otherWorkspaceId;
    expect(((await (await send("GET", "/api/v1/approval-items")).json()) as { data: Array<{ id: string }> }).data.map((item) => item.id)).toContain(itemId);
    context.workspaceId = workspaceId;
    expect(((await (await send("GET", "/api/v1/approval-items")).json()) as { data: Array<{ id: string }> }).data.map((item) => item.id)).not.toContain(itemId);
  });
});
