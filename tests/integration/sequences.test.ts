import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, workspaces } from "@outbound/infrastructure/database/schema";
import { createSequenceHttpHandler } from "@outbound/interface/http/sequence-handler";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-030 multichannel sequences", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const context = {
    userId,
    workspaceId,
    role: "admin" as "admin" | "operator" | "viewer",
  };
  const handle = createSequenceHttpHandler({
    contextResolver: { async resolve() { return context; } },
    database: database.db,
  });

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
    await database.client`alter table sequence_versions enable trigger "sequence_versions_immutable_trg"`;
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `f030-a-${workspaceId}`, name: "F-030 A" },
      { id: otherWorkspaceId, slug: `f030-b-${otherWorkspaceId}`, name: "F-030 B" },
    ]);
    await database.db.insert(authUsers).values({
      id: userId,
      name: "Sequence Tester",
      email: `f030-${userId}@example.com`,
    });
  });

  afterAll(async () => {
    await database.client.begin(async (sql) => {
      await sql`alter table sequence_versions disable trigger "sequence_versions_immutable_trg"`;
      await sql`delete from sequence_versions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from sequence_steps where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from sequences where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from auth_users where id = ${userId}`;
      await sql`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`alter table sequence_versions enable trigger "sequence_versions_immutable_trg"`;
    });
    await database.close();
  });

  function send(method: string, pathname: string, body?: unknown) {
    return handle(
      new Request(`http://localhost${pathname}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
  }

  test("draft edition, publication validation, immutable versions", async () => {
    const created = await send("POST", "/api/v1/sequences", {
      name: "Playbook cabinets juridiques",
      description: "Invitation LinkedIn puis email, tâche manuelle en dernier recours",
    });
    expect(created.status).toBe(201);
    const sequence = (await created.json()) as { id: string; status: string };
    expect(sequence.status).toBe("draft");

    // Invalid steps: invitation too long + email without subject.
    const invalid = await send("PUT", `/api/v1/sequences/${sequence.id}/steps`, {
      steps: [
        { position: 1, kind: "linkedin_invite", body: "x".repeat(301), fallbackKind: "email" },
        { position: 2, kind: "email", delayDays: 3, body: "Corps", fallbackKind: "linkedin_invite" },
      ],
    });
    expect(invalid.status).toBe(204); // draft accepts anything, validation happens at publish
    const publishInvalid = await send(
      "POST",
      `/api/v1/sequences/${sequence.id}/actions/publish`,
      {},
    );
    expect(publishInvalid.status).toBe(422);
    const problems = (await publishInvalid.json()) as {
      errors: Array<{ code: string; position: number }>;
    };
    expect(problems.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["STEP_BODY_TOO_LONG", "EMAIL_SUBJECT_REQUIRED", "FALLBACK_LOOP"]),
    );
    expect(problems.errors.every((error) => Number.isInteger(error.position))).toBe(true);

    // Fix the draft and publish v1.
    const valid = await send("PUT", `/api/v1/sequences/${sequence.id}/steps`, {
      steps: [
        {
          position: 1,
          kind: "linkedin_invite",
          body: "Bonjour {{firstName}}, votre approche gouvernance IA chez {{companyName}} m’intéresse.",
          fallbackKind: "email",
        },
        {
          position: 2,
          kind: "email",
          delayDays: 3,
          windowStart: "09:00",
          windowEnd: "18:00",
          subject: "Votre registre IA, {{firstName}}",
          body: "Bonjour {{firstName}}, …",
        },
        { position: 3, kind: "manual_task", delayDays: 7, body: "Appeler le standard" },
      ],
    });
    expect(valid.status).toBe(204);
    const publishV1 = await send("POST", `/api/v1/sequences/${sequence.id}/actions/publish`, {});
    expect(publishV1.status).toBe(201);
    const v1 = (await publishV1.json()) as { id: string; version: number; steps: unknown[] };
    expect(v1.version).toBe(1);
    expect(v1.steps).toHaveLength(3);

    // Editing the draft then republishing creates v2 without touching v1.
    await send("PUT", `/api/v1/sequences/${sequence.id}/steps`, {
      steps: [{ position: 1, kind: "manual_task", body: "Étape unique" }],
    });
    const publishV2 = await send("POST", `/api/v1/sequences/${sequence.id}/actions/publish`, {});
    expect(publishV2.status).toBe(201);
    expect(((await publishV2.json()) as { version: number }).version).toBe(2);

    const versions = await send("GET", `/api/v1/sequences/${sequence.id}/versions`);
    const versionList = (await versions.json()) as {
      data: Array<{ version: number; steps: unknown[] }>;
    };
    expect(versionList.data.map((version) => version.version)).toEqual([1, 2]);
    expect(versionList.data[0]!.steps).toHaveLength(3); // v1 untouched
    expect(versionList.data[1]!.steps).toHaveLength(1);

    try {
      await database.client.begin(async (sql) => {
        await assertImmutable(sql, v1.id);
        throw new Error("ROLLBACK_F030_TEST");
      });
    } catch (error) {
      expect(String(error)).toContain("ROLLBACK_F030_TEST");
    }

    // Workspace isolation.
    context.workspaceId = otherWorkspaceId;
    const invisible = await send("GET", `/api/v1/sequences/${sequence.id}`);
    expect(invisible.status).toBe(404);
    context.workspaceId = workspaceId;
  });

  test("an operator can edit a draft but only admin/owner publishes", async () => {
    const created = await send("POST", "/api/v1/sequences", { name: "Operator draft" });
    const sequence = (await created.json()) as { id: string };
    await send("PUT", `/api/v1/sequences/${sequence.id}/steps`, {
      steps: [{ position: 1, kind: "manual_task", body: "Étape" }],
    });
    context.role = "operator";
    const publish = await send("POST", `/api/v1/sequences/${sequence.id}/actions/publish`, {});
    expect(publish.status).toBe(403);
    context.role = "viewer";
    const edit = await send("PUT", `/api/v1/sequences/${sequence.id}/steps`, { steps: [] });
    expect(edit.status).toBe(403);
    context.role = "admin";
  });
});

async function assertImmutable(
  sql: {
    (strings: TemplateStringsArray, ...values: unknown[]): unknown;
    unsafe(query: string): unknown;
  },
  id: string,
) {
  await sql`savepoint sequence_immutable_update`;
  let updateError: unknown;
  try {
    await sql`update sequence_versions set steps = ${JSON.stringify([{ position: 99 }])}::jsonb where id = ${id}`;
  } catch (error) {
    updateError = error;
  }
  expect(String(updateError)).toContain("SEQUENCE_VERSION_IMMUTABLE");
  await sql`rollback to savepoint sequence_immutable_update`;

  await sql`savepoint sequence_immutable_delete`;
  let deleteError: unknown;
  try {
    await sql`delete from sequence_versions where id = ${id}`;
  } catch (error) {
    deleteError = error;
  }
  expect(String(deleteError)).toContain("SEQUENCE_VERSION_IMMUTABLE");
  await sql`rollback to savepoint sequence_immutable_delete`;
}
