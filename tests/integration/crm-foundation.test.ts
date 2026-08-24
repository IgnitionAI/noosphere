import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { approvalItems, authUsers, campaignProspects, campaigns, contacts, contactSuppressions, enrichmentJobs, icps, icpVersions, jobs, prospectDecisions, prospectDiscoveryCandidates, prospectDiscoveryRuns, workspaces } from "@outbound/infrastructure/database/schema";
import { eq } from "drizzle-orm";
import { createCrmHttpHandler } from "@outbound/interface/http/crm-handler";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
import { ProspectDecisionJobProcessor } from "@outbound/infrastructure/campaigns/prospect-decision-runner";

const databaseUrl = process.env.TEST_DATABASE_URL;
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
    await database.client`drop trigger if exists icp_versions_immutable_trg on icp_versions`;
    await database.client`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from prospect_decisions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from jobs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from campaign_prospects where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from prospect_discovery_candidates where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from prospect_discovery_runs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from campaigns where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from icp_versions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from icps where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from contact_suppressions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from companies where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from contacts where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from auth_users where id = ${userId}`;
    await database.client`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`create trigger icp_versions_immutable_trg before update or delete on icp_versions for each row execute function reject_icp_version_mutation()`;
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

  test("prospects: filters contacts in a campaign or outside every campaign", async () => {
    const insideContactId = crypto.randomUUID();
    const outsideContactId = crypto.randomUUID();
    const icpId = crypto.randomUUID();
    const icpVersionId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const candidateId = crypto.randomUUID();
    await database.db.insert(contacts).values([
      { id: insideContactId, workspaceId, firstName: "Inside", lastName: "Campaign" },
      { id: outsideContactId, workspaceId, firstName: "Outside", lastName: "Campaign" },
    ]);
    await database.db.insert(icps).values({ id: icpId, workspaceId, name: "Prospect filter ICP" });
    await database.db.insert(icpVersions).values({
      id: icpVersionId,
      workspaceId,
      icpId,
      version: 1,
      name: "Prospect filter ICP",
      confidence: "0.9000",
      criteria: [],
      buyingCommittee: [],
      problems: [],
      signals: [],
      exclusions: [],
      unknowns: [],
      unresolvedContradictions: [],
      blockedFindings: [],
      publishedAt: new Date(),
    });
    await database.db.insert(campaigns).values({
      id: campaignId,
      workspaceId,
      icpVersionId,
      name: "Prospect filter campaign",
      status: "draft",
      channel: "linkedin",
      sequenceId: crypto.randomUUID(),
    });
    await database.db.insert(prospectDiscoveryRuns).values({
      id: runId,
      workspaceId,
      icpVersionId,
      campaignId,
      channel: "linkedin",
      filters: {},
      status: "completed",
      completedAt: new Date(),
    });
    await database.db.insert(prospectDiscoveryCandidates).values({
      id: candidateId,
      workspaceId,
      runId,
      fullName: "Inside Campaign",
      channels: {
        linkedin: { value: null, normalizedValue: null, status: "unavailable", confidence: "none", source: null },
        email: { value: null, normalizedValue: null, status: "unavailable", confidence: "none", source: null },
        whatsapp: { value: null, normalizedValue: null, status: "unavailable", confidence: "none", source: null },
      },
      providerData: {},
      icpFit: { matches: [], gaps: [] },
      importedContactId: insideContactId,
    });
    await database.db.insert(campaignProspects).values({
      workspaceId,
      campaignId,
      contactId: insideContactId,
      candidateId,
    });

    const inCampaign = await handle(new Request(
      "http://localhost/api/v1/prospects?limit=100&campaignScope=in_campaign",
    ));
    expect(inCampaign.status).toBe(200);
    const inCampaignBody = await inCampaign.json() as {
      data: { id: string }[];
      filters: { campaigns: { id: string; name: string }[] };
    };
    expect(inCampaignBody.data.map((item) => item.id)).toContain(insideContactId);
    expect(inCampaignBody.data.map((item) => item.id)).not.toContain(outsideContactId);
    expect(inCampaignBody.filters.campaigns).toContainEqual(expect.objectContaining({ id: campaignId }));

    const outsideCampaign = await handle(new Request(
      "http://localhost/api/v1/prospects?limit=100&campaignScope=outside_campaign",
    ));
    expect(outsideCampaign.status).toBe(200);
    const outsideCampaignBody = await outsideCampaign.json() as { data: { id: string }[] };
    expect(outsideCampaignBody.data.map((item) => item.id)).toContain(outsideContactId);
    expect(outsideCampaignBody.data.map((item) => item.id)).not.toContain(insideContactId);

    const exactCampaign = await handle(new Request(
      `http://localhost/api/v1/prospects?limit=100&campaignId=${campaignId}`,
    ));
    expect(exactCampaign.status).toBe(200);
    expect(((await exactCampaign.json()) as { data: { id: string }[] }).data.map((item) => item.id))
      .toContain(insideContactId);
  });

  test("prospects: filters durable status and update period without broadening the workspace", async () => {
    const recentActiveId = crypto.randomUUID();
    const recentSuppressedId = crypto.randomUUID();
    const oldActiveId = crypto.randomUUID();
    await database.db.insert(contacts).values([
      { id: recentActiveId, workspaceId, firstName: "Recent", lastName: "Active", status: "active", updatedAt: new Date() },
      { id: recentSuppressedId, workspaceId, firstName: "Recent", lastName: "Suppressed", status: "suppressed", updatedAt: new Date() },
      { id: oldActiveId, workspaceId, firstName: "Old", lastName: "Active", status: "active", updatedAt: new Date("2020-01-01T00:00:00.000Z") },
    ]);

    const response = await handle(new Request("http://localhost/api/v1/prospects?limit=100&period=7d&status=active"));
    expect(response.status).toBe(200);
    const ids = ((await response.json()) as { data: { id: string }[] }).data.map((item) => item.id);
    expect(ids).toContain(recentActiveId);
    expect(ids).not.toContain(recentSuppressedId);
    expect(ids).not.toContain(oldActiveId);

    expect((await handle(new Request("http://localhost/api/v1/prospects?period=forever"))).status).toBe(400);
    expect((await handle(new Request("http://localhost/api/v1/prospects?status=unknown"))).status).toBe(400);
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

  // Regression: ISSUE-001 — campaign context must be verified and persisted.
  // Found by /qa on 2026-08-13.
  test("keeps a verified campaign context on a manual prospect dry-run", async () => {
    const contactId = crypto.randomUUID();
    const icpId = crypto.randomUUID();
    const icpVersionId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const candidateId = crypto.randomUUID();
    await database.db.insert(contacts).values({ id: contactId, workspaceId, firstName: "Campaign", lastName: "Context" });
    await database.db.insert(icps).values({ id: icpId, workspaceId, name: "Campaign context ICP" });
    await database.db.insert(icpVersions).values({
      id: icpVersionId,
      workspaceId,
      icpId,
      version: 1,
      name: "Campaign context ICP",
      confidence: "0.9000",
      criteria: [],
      buyingCommittee: [],
      problems: [],
      signals: [],
      exclusions: [],
      unknowns: [],
      unresolvedContradictions: [],
      blockedFindings: [],
      publishedAt: new Date(),
    });
    await database.db.insert(campaigns).values({
      id: campaignId,
      workspaceId,
      icpVersionId,
      name: "Campaign context test",
      status: "draft",
      channel: "linkedin",
      sequenceId: crypto.randomUUID(),
    });
    await database.db.insert(prospectDiscoveryRuns).values({
      id: runId,
      workspaceId,
      icpVersionId,
      campaignId,
      channel: "linkedin",
      filters: {},
      status: "completed",
      completedAt: new Date(),
    });
    await database.db.insert(prospectDiscoveryCandidates).values({
      id: candidateId,
      workspaceId,
      runId,
      fullName: "Campaign Context",
      linkedinUrl: "https://www.linkedin.com/in/campaign-context",
      linkedinNormalized: "https://www.linkedin.com/in/campaign-context",
      channels: {
        linkedin: {
          value: "https://www.linkedin.com/in/campaign-context",
          normalizedValue: "linkedin.com/in/campaign-context",
          status: "verified",
          confidence: "high",
          source: "release_qa_fixture",
        },
        email: { value: null, normalizedValue: null, status: "unavailable", confidence: "none", source: null },
        whatsapp: { value: null, normalizedValue: null, status: "unavailable", confidence: "none", source: null },
      },
      providerData: {},
      icpFit: { matches: [], gaps: [] },
      importedContactId: contactId,
    });
    await database.db.insert(campaignProspects).values({
      workspaceId,
      campaignId,
      contactId,
      candidateId,
      score: 80,
      eligible: true,
    });

    const accepted = await postJson(`/api/v1/prospects/${contactId}/actions/dry-run`, {
      reason: "Conserver le contexte de campagne.",
      requestKey: crypto.randomUUID(),
      campaignId,
    });
    expect(accepted.status).toBe(202);
    const result = await accepted.json() as { decisionId: string };
    const [decision] = await database.db.select().from(prospectDecisions).where(eq(prospectDecisions.id, result.decisionId));
    expect(decision?.campaignId).toBe(campaignId);

    const prospectViewResponse = await handle(new Request(`http://localhost/api/v1/prospects/${contactId}`));
    expect(prospectViewResponse.status).toBe(200);
    expect(await prospectViewResponse.json()).toMatchObject({
      socialSignalAssessment: {
        baseScore: 80,
        socialBoost: 0,
        effectiveScore: 80,
        openLinkedinConversation: false,
      },
    });

    expect((await postJson(`/api/v1/prospects/${contactId}/actions/dry-run`, {
      reason: "Refuser un contexte non lié.",
      requestKey: crypto.randomUUID(),
      campaignId: crypto.randomUUID(),
    })).status).toBe(404);
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
