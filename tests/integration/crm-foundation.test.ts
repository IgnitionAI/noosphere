import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { approvalItems, authUsers, contacts, contactSuppressions, enrichmentJobs, jobs, prospectDecisions, workspaces } from "@outbound/infrastructure/database/schema";
import { eq } from "drizzle-orm";
import { createCrmHttpHandler } from "@outbound/interface/http/crm-handler";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
import { ProspectDecisionJobProcessor } from "@outbound/infrastructure/campaigns/prospect-decision-runner";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-020/F-021 CRM foundation", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const context = {
    userId,
    workspaceId,
    role: "operator" as "operator" | "reviewer" | "viewer" | "admin" | "owner",
  };
  const handle = createCrmHttpHandler({
    contextResolver: { async resolve() { return context; } },
    database: database.db,
  });

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
    await database.client`delete from companies where name like 'Page Corp %' or name like 'Example Corp%' or name like 'Foreign Example' or name like 'Cabinet _'`;
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `crm-a-${workspaceId}`, name: "CRM A" },
      { id: otherWorkspaceId, slug: `crm-b-${otherWorkspaceId}`, name: "CRM B" },
    ]);
    await database.db.insert(authUsers).values({
      id: userId,
      name: "CRM Tester",
      email: `crm-${userId}@example.com`,
    });
  });

  afterAll(async () => {
    await database.client`drop trigger if exists audit_logs_immutable_trg on audit_logs`;
    await database.client`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from prospect_decisions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from jobs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from contact_suppressions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from companies where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from contacts where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from auth_users where id = ${userId}`;
    await database.client`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`create trigger audit_logs_immutable_trg before update or delete on audit_logs for each row execute function reject_audit_log_mutation()`;
    await database.close();
  });

  function postJson(pathname: string, body: unknown) {
    return handle(
      new Request(`http://localhost${pathname}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  function patchJson(pathname: string, body: unknown) {
    return handle(new Request(`http://localhost${pathname}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  test("companies: normalized unique domain, workspace isolation, stable pagination", async () => {
    const created = await postJson("/api/v1/companies", {
      name: "Example Corp",
      domain: "HTTPS://WWW.Example.com/path?q=1",
      sector: "LegalTech",
      employeeCountMin: 50,
      employeeCountMax: 200,
      location: "Paris",
    });
    expect(created.status).toBe(201);
    const company = (await created.json()) as { id: string; normalizedDomain: string };
    expect(company.normalizedDomain).toBe("example.com");

    const duplicate = await postJson("/api/v1/companies", {
      name: "Example Corp Bis",
      domain: "example.com",
    });
    expect(duplicate.status).toBe(409);
    const conflict = (await duplicate.json()) as { code: string; existingCompanyId: string };
    expect(conflict.code).toBe("COMPANY_DOMAIN_CONFLICT");
    expect(conflict.existingCompanyId).toBe(company.id);

    // Same domain in another workspace is allowed.
    context.workspaceId = otherWorkspaceId;
    const foreign = await postJson("/api/v1/companies", {
      name: "Foreign Example",
      domain: "example.com",
    });
    expect(foreign.status).toBe(201);
    context.workspaceId = workspaceId;

    // Another workspace cannot see our company.
    context.workspaceId = otherWorkspaceId;
    const invisible = await handle(
      new Request(`http://localhost/api/v1/companies/${company.id}`),
    );
    expect(invisible.status).toBe(404);
    context.workspaceId = workspaceId;

    // Stable cursor pagination.
    for (let index = 0; index < 12; index += 1) {
      await postJson("/api/v1/companies", { name: `Page Corp ${String(index).padStart(2, "0")}` });
    }
    const page1 = await handle(
      new Request("http://localhost/api/v1/companies?search=Page%20Corp&limit=5"),
    );
    const body1 = (await page1.json()) as { data: unknown[]; nextCursor: string | null };
    expect(body1.data).toHaveLength(5);
    expect(body1.nextCursor).toBeTruthy();
    const page2 = await handle(
      new Request(
        `http://localhost/api/v1/companies?search=Page%20Corp&limit=5&cursor=${encodeURIComponent(body1.nextCursor!)}`,
      ),
    );
    const body2 = (await page2.json()) as { data: unknown[]; nextCursor: string | null };
    expect(body2.data).toHaveLength(5);
    const ids1 = new Set((body1.data as { id: string }[]).map((row) => row.id));
    expect((body2.data as { id: string }[]).every((row) => !ids1.has(row.id))).toBe(true);

    const filtered = await handle(new Request("http://localhost/api/v1/companies?sector=LegalTech&employeeCountMin=40&employeeCountMax=250&location=Paris"));
    expect(((await filtered.json()) as { data: { id: string }[] }).data.map((row) => row.id)).toContain(company.id);
    const patched = await patchJson(`/api/v1/companies/${company.id}`, { name: "Example Corp Updated" });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { name: string }).name).toBe("Example Corp Updated");
    context.role = "viewer";
    expect((await patchJson(`/api/v1/companies/${company.id}`, { name: "Forbidden" })).status).toBe(403);
    context.role = "operator";
  });

  test("prospects: accepts PostgreSQL UUID values used by deterministic ICP versions", async () => {
    const response = await handle(
      new Request(
        "http://localhost/api/v1/prospects?limit=100&icpVersionId=b1c82cfa-dacb-85de-6d89-8b263f6ba619",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: [], filters: { icps: [] } });
  });

  test("schedules a tenant-scoped manual decision in simulation-only mode", async () => {
    const contactId = crypto.randomUUID();
    await database.db.insert(contacts).values({
      id: contactId,
      workspaceId,
      firstName: "Dry",
      lastName: "Run",
    });
    const requestKey = crypto.randomUUID();
    const response = await postJson(`/api/v1/prospects/${contactId}/actions/dry-run`, {
      reason: "Vérifier la prochaine action sans effet externe.",
      requestKey,
    });
    expect(response.status).toBe(202);
    const result = await response.json() as { decisionId: string; dryRun: boolean };
    expect(result.dryRun).toBe(true);
    const [decision] = await database.db.select().from(prospectDecisions).where(eq(prospectDecisions.id, result.decisionId));
    expect(decision).toMatchObject({
      workspaceId,
      contactId,
      kind: "manual_dry_run",
      payload: { simulationOnly: true, requestedBy: userId },
    });
    const [job] = await database.db.select().from(jobs).where(eq(jobs.id, decision!.jobId));
    expect(job).toMatchObject({ workspaceId, type: "prospect.decision.execute", priority: 90 });
    const simulatedAt = new Date("2030-01-01T10:00:00.000Z");
    const queue = new PostgresJobQueue(database.client);
    const [leased] = await queue.lease({
      workerId: "manual-dry-run-worker",
      types: ["prospect.decision.execute"],
      limit: 1,
      leaseMs: 30_000,
      now: simulatedAt,
    });
    expect(leased).toBeDefined();
    await new ProspectDecisionJobProcessor(
      database.db,
      queue,
      {
        async decide() {
          return {
            observation: "Le dossier bénéficierait d'une recherche complémentaire.",
            action: "research",
            reason: "Les informations actuellement disponibles sont insuffisantes.",
            nextDueAt: "2030-01-02T10:00:00.000Z",
            nextReason: "Réexaminer après enrichissement.",
          };
        },
      },
      { now: () => simulatedAt },
    ).process(leased!);
    const [completed] = await database.db.select().from(prospectDecisions).where(eq(prospectDecisions.id, result.decisionId));
    expect(completed).toMatchObject({ status: "completed", proposedAction: "research" });
    expect(await database.db.select().from(enrichmentJobs).where(eq(enrichmentJobs.workspaceId, workspaceId))).toHaveLength(0);
    expect(await database.db.select().from(approvalItems).where(eq(approvalItems.workspaceId, workspaceId))).toHaveLength(0);
    expect((await database.db.select().from(jobs).where(eq(jobs.workspaceId, workspaceId)))
      .filter((row) => row.type === "outreach.dispatch")).toHaveLength(0);

    context.workspaceId = otherWorkspaceId;
    expect((await postJson(`/api/v1/prospects/${contactId}/actions/dry-run`, {
      reason: "Tentative cross-tenant interdite.",
      requestKey: crypto.randomUUID(),
    })).status).toBe(404);
    context.workspaceId = workspaceId;
  });

  test("contacts: employment history, identity uniqueness, persistent suppression", async () => {
    const companyA = (await (
      await postJson("/api/v1/companies", { name: "Cabinet A", domain: "cabinet-a.fr" })
    ).json()) as { id: string };
    const companyB = (await (
      await postJson("/api/v1/companies", { name: "Cabinet B", domain: "cabinet-b.fr" })
    ).json()) as { id: string };

    const created = await postJson("/api/v1/contacts", {
      firstName: "Jean",
      lastName: "Dupont",
      employment: { companyId: companyA.id, title: "Associé" },
      identities: [{ type: "email", value: "Jean.Dupont@Example.com" }],
    });
    expect(created.status).toBe(201);
    const contact = (await created.json()) as { id: string };

    // Duplicate email fingerprint is rejected with the existing contact.
    const duplicate = await postJson("/api/v1/contacts", {
      firstName: "Jeanne",
      lastName: "Dupont",
      identities: [{ type: "email", value: "jean.dupont@example.com" }],
    });
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { code: string }).code).toBe(
      "CONTACT_IDENTITY_CONFLICT",
    );

    // A new employer closes the current employment without a new person.
    const move = await postJson(`/api/v1/contacts/${contact.id}/employments`, {
      companyId: companyB.id,
      title: "Managing Partner",
      startedOn: "2026-07-01",
    });
    expect(move.status).toBe(201);
    const detail = await handle(
      new Request(`http://localhost/api/v1/contacts/${contact.id}`),
    );
    const body = (await detail.json()) as {
      employments: Array<{ isCurrent: boolean; companyId: string; endedOn: string | null }>;
    };
    const current = body.employments.filter((employment) => employment.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0]!.companyId).toBe(companyB.id);
    const previous = body.employments.find((employment) => employment.companyId === companyA.id);
    expect(previous?.isCurrent).toBe(false);
    expect(previous?.endedOn).toBe("2026-07-01");

    const patchedContact = await patchJson(`/api/v1/contacts/${contact.id}`, { firstName: "Jean-Pierre" });
    expect(patchedContact.status).toBe(200);
    expect(((await patchedContact.json()) as { firstName: string }).firstName).toBe("Jean-Pierre");
    context.role = "reviewer";
    expect((await patchJson(`/api/v1/contacts/${contact.id}`, { lastName: "Forbidden" })).status).toBe(403);
    context.role = "operator";

    // Suppression persists across re-import.
    const suppress = await postJson(`/api/v1/contacts/${contact.id}/actions/suppress`, {
      channel: "global",
      reason: "Opposition au démarchage",
    });
    expect(suppress.status).toBe(204);
    const [storedSuppression] = await database.db
      .select()
      .from(contactSuppressions)
      .where(eq(contactSuppressions.contactId, contact.id));
    expect(storedSuppression?.normalizedValue).toBeNull();
    expect(storedSuppression?.identityFingerprint).toMatch(/^[a-f0-9]{64}$/);
    const reimport = await postJson("/api/v1/contacts", {
      firstName: "Jean",
      lastName: "Dupont",
      identities: [{ type: "email", value: "JEAN.DUPONT@example.com" }],
    });
    expect(reimport.status).toBe(409);
    expect(((await reimport.json()) as { code: string }).code).toBe("CONTACT_SUPPRESSED");
  });

  test("a viewer can read but cannot mutate", async () => {
    context.role = "viewer";
    const list = await handle(new Request("http://localhost/api/v1/companies"));
    expect(list.status).toBe(200);
    const create = await postJson("/api/v1/companies", { name: "Viewer Corp" });
    expect(create.status).toBe(403);
    context.role = "operator";
  });

  test("fingerprint suppressions: idempotence, eligibility, lift authorization, and isolation", async () => {
    const email = `suppression-${crypto.randomUUID()}@example.com`;
    const create = await postJson("/api/v1/suppressions", {
      identityType: "email",
      value: email,
      channel: "global",
      reason: "Customer opposition",
    });
    expect(create.status).toBe(201);
    const suppression = (await create.json()) as { id: string; normalizedValue: string };
    expect(suppression.normalizedValue).toContain("…");

    const duplicate = await postJson("/api/v1/suppressions", {
      identityType: "email",
      value: email.toUpperCase(),
      channel: "global",
    });
    expect(duplicate.status).toBe(201);
    expect(((await duplicate.json()) as { id: string }).id).toBe(suppression.id);

    const blocked = await postJson("/api/v1/suppressions/check", {
      identityType: "email",
      value: email,
      channel: "email",
    });
    expect(blocked.status).toBe(200);
    expect(((await blocked.json()) as { eligible: boolean; suppressionId: string }).eligible).toBe(false);

    context.workspaceId = otherWorkspaceId;
    const foreignCheck = await postJson("/api/v1/suppressions/check", {
      identityType: "email",
      value: email,
      channel: "email",
    });
    expect(((await foreignCheck.json()) as { eligible: boolean }).eligible).toBe(true);
    context.workspaceId = workspaceId;

    const list = await handle(new Request("http://localhost/api/v1/suppressions"));
    expect(list.status).toBe(200);
    expect(((await list.json()) as { data: Array<{ id: string; normalizedValue: string }> }).data.some((row) => row.id === suppression.id)).toBe(true);

    const operatorLift = await postJson(`/api/v1/suppressions/${suppression.id}/actions/lift`, { justification: "Not allowed" });
    expect(operatorLift.status).toBe(403);
    context.role = "admin";
    const missingJustification = await postJson(`/api/v1/suppressions/${suppression.id}/actions/lift`, {});
    expect(missingJustification.status).toBe(400);
    const lifted = await postJson(`/api/v1/suppressions/${suppression.id}/actions/lift`, { justification: "Verified opt-in request" });
    expect(lifted.status).toBe(200);
    expect(((await lifted.json()) as { liftedAt: string | null }).liftedAt).toBeTruthy();
    const eligible = await postJson("/api/v1/suppressions/check", {
      identityType: "email",
      value: email,
      channel: "email",
    });
    expect(((await eligible.json()) as { eligible: boolean }).eligible).toBe(true);
    context.role = "operator";
  });
});
