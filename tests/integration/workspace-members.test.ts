import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresWorkspaceRepository } from "@outbound/infrastructure/workspaces/postgres-workspace-repository";
import { authUsers, workspaces } from "@outbound/infrastructure/database/schema";
import { createWorkspaceHttpHandler } from "@outbound/interface/http/workspace-handler";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-002 workspace members and invitations", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const repository = new PostgresWorkspaceRepository(database.db);
  const workspaceId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const inviteeId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const ownerContext = { userId: ownerId, workspaceId, role: "owner" as const };
  const ownerSession = { async getSession() { return { userId: ownerId }; } };
  const handler = createWorkspaceHttpHandler({
    sessions: ownerSession,
    memberships: { async listActiveMemberships() { return []; } },
    contextResolver: { async resolve() { return ownerContext; } },
    management: repository,
  });

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `f002-a-${workspaceId}`, name: "F-002 A" },
      { id: otherWorkspaceId, slug: `f002-b-${otherWorkspaceId}`, name: "F-002 B" },
    ]);
    await database.db.insert(authUsers).values([
      { id: ownerId, name: "F-002 Owner", email: `owner-${ownerId}@example.com` },
      { id: inviteeId, name: "F-002 Invitee", email: `invitee-${inviteeId}@example.com` },
    ]);
    await database.client`insert into workspace_members (workspace_id, user_id, role, status) values (${workspaceId}, ${ownerId}, 'owner', 'active')`;
  });

  afterAll(async () => {
    await database.client.begin(async (sql) => {
      await sql`delete from workspace_invitations where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from outbox_events where workspace_id in (select id from workspaces where slug like 'f002-created-%')`;
      await sql`alter table audit_logs disable trigger user`;
      await sql`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from audit_logs where workspace_id in (select id from workspaces where slug like 'f002-created-%')`;
      await sql`alter table audit_logs enable trigger user`;
      await sql`delete from workspace_members where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from auth_users where id in (${ownerId}, ${inviteeId})`;
      await sql`delete from workspaces where slug like 'f002-created-%'`;
      await sql`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    });
    await database.close();
  });

  test("creates a workspace through the authenticated API and makes the creator owner", async () => {
    const response = await handler(new Request("http://localhost/api/v1/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Created Workspace", slug: `f002-created-${ownerId}` }),
    }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ name: "Created Workspace", role: "owner" });
  });

  test("renews one invitation, accepts once, emits auditable events and respects workspace isolation", async () => {
    const first = await repository.invite({ workspaceId, actorUserId: ownerId, email: `INVITEE-${inviteeId}@example.com`, proposedRole: "operator" });
    const renewed = await repository.invite({ workspaceId, actorUserId: ownerId, email: `invitee-${inviteeId}@example.com`, proposedRole: "reviewer" });
    expect(renewed.id).toBe(first.id);
    expect(renewed.proposedRole).toBe("reviewer");
    const pending = await repository.listInvitations(workspaceId);
    expect(pending.filter((item) => item.status === "pending")).toHaveLength(1);

    const accepted = await repository.acceptInvitation({ invitationId: first.id, userId: inviteeId });
    expect(accepted.member.role).toBe("reviewer");
    await expect(repository.acceptInvitation({ invitationId: first.id, userId: inviteeId })).rejects.toMatchObject({ code: "WORKSPACE_INVITATION_CONSUMED", status: 409 });
    expect((await repository.listMembers(workspaceId)).filter((member) => member.userId === inviteeId)).toHaveLength(1);
    expect((await database.client<{ event_type: string }[]>`select event_type from outbox_events where workspace_id = ${workspaceId} and event_type like 'Workspace%'`)).toHaveLength(3);

    const foreign = createWorkspaceHttpHandler({
      sessions: ownerSession,
      memberships: { async listActiveMemberships() { return []; } },
      contextResolver: { async resolve() { return ownerContext; } },
      management: repository,
    });
    const response = await foreign(new Request(`http://localhost/api/v1/workspaces/${otherWorkspaceId}/members`, { headers: { "x-workspace-slug": "foreign" } }));
    expect(response.status).toBe(403);
  });

  test("protects the last owner and audits role/status mutations", async () => {
    await expect(repository.changeRole({ workspaceId, targetUserId: ownerId, actorUserId: inviteeId, role: "admin", actorRole: "owner" })).rejects.toMatchObject({ code: "WORKSPACE_LAST_OWNER", status: 409 });
    await expect(repository.setStatus({ workspaceId, targetUserId: ownerId, actorUserId: inviteeId, status: "disabled", actorRole: "owner" })).rejects.toMatchObject({ code: "WORKSPACE_LAST_OWNER", status: 409 });
    await repository.changeRole({ workspaceId, targetUserId: inviteeId, actorUserId: ownerId, role: "owner", actorRole: "owner" });
    await repository.changeRole({ workspaceId, targetUserId: ownerId, actorUserId: inviteeId, role: "admin", actorRole: "owner" });
    await repository.setStatus({ workspaceId, targetUserId: ownerId, actorUserId: inviteeId, status: "disabled", actorRole: "owner" });
    const audits = await database.client<{ action: string }[]>`select action from audit_logs where workspace_id = ${workspaceId} and action like 'WorkspaceMember%' order by created_at`;
    expect(audits.map((row) => row.action)).toEqual(expect.arrayContaining(["WorkspaceMemberRoleChanged", "WorkspaceMemberDeactivated"]));
  });

  test("rejects operator mutations through HTTP", async () => {
    const operatorHandler = createWorkspaceHttpHandler({
      sessions: { async getSession() { return { userId: inviteeId }; } },
      memberships: { async listActiveMemberships() { return []; } },
      contextResolver: { async resolve() { return { userId: inviteeId, workspaceId, role: "operator" as const }; } },
      management: repository,
    });
    const response = await operatorHandler(new Request(`http://localhost/api/v1/workspaces/${workspaceId}/invitations`, { method: "POST", headers: { "content-type": "application/json", "x-workspace-slug": `f002-a-${workspaceId}` }, body: JSON.stringify({ email: "other@example.com", role: "viewer" }) }));
    expect(response.status).toBe(403);
  });
});
