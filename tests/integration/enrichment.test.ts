import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, companies, contactEmployments, contactIdentities, contacts, workspaces } from "@outbound/infrastructure/database/schema";
import { createEnrichmentHttpHandler } from "@outbound/interface/http/enrichment-handler";
import type { ProspectEnricher } from "@outbound/application/crm/prospect-enrichment-ports";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-025 enrichment foundations", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const companyId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const otherContactId = crypto.randomUUID();
  const email = `enrichment-${contactId}@example.com`;
  const context = { userId, workspaceId, role: "operator" as "operator" | "reviewer" | "viewer" | "admin" | "owner" };
  const enricher: ProspectEnricher = {
    async enrich() {
      return {
        companyWebsite: "https://example.com",
        companyDomain: "example.com",
        queries: ["Ada Lovelace Example"],
        evidence: [{ kind: "email", url: "https://example.com/team", snippet: "Ada Lovelace — ada@example.com", collectedAt: new Date().toISOString() }],
        channels: {
          linkedin: { value: null, normalizedValue: null, status: "unavailable", confidence: "none", source: null },
          email: { value: "ada@example.com", normalizedValue: "ada@example.com", status: "found", confidence: "medium", source: "crawler", evidenceUrl: "https://example.com/team", evidenceSnippet: "Ada Lovelace — ada@example.com" },
          whatsapp: { value: "+33123456789", normalizedValue: "+33123456789", status: "found", confidence: "medium", source: "crawler", phoneKind: "public_company" },
        },
      };
    },
  };
  const handle = createEnrichmentHttpHandler({
    database: database.db,
    contextResolver: { async resolve() { return context; } },
    prospectEnricher: () => enricher,
  });

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `enrich-a-${workspaceId}`, name: "Enrichment A" },
      { id: otherWorkspaceId, slug: `enrich-b-${otherWorkspaceId}`, name: "Enrichment B" },
    ]);
    await database.db.insert(authUsers).values({ id: userId, name: "Enrichment Tester", email: `enrichment-${userId}@example.com` });
    await database.db.insert(companies).values({ id: companyId, workspaceId, name: "Example Enrichment Co", normalizedDomain: "example.com", source: "manual" });
    await database.db.insert(contacts).values([
      { id: contactId, workspaceId, firstName: "Ada", lastName: "Lovelace", source: "manual" },
      { id: otherContactId, workspaceId: otherWorkspaceId, firstName: "Ada", lastName: "Lovelace", source: "manual" },
    ]);
    await database.db.insert(contactEmployments).values({ id: crypto.randomUUID(), workspaceId, contactId, companyId, title: "Engineer", isCurrent: true });
    await database.db.insert(contactIdentities).values({ id: crypto.randomUUID(), workspaceId, contactId, type: "email", value: email, normalizedValue: email, source: "manual" });
  });

  afterAll(async () => {
    await database.client`delete from enrichment_observations where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from enrichment_jobs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from contact_suppressions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`alter table audit_logs disable trigger user`;
    await database.client`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`alter table audit_logs enable trigger user`;
    await database.client`delete from contact_identities where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from contact_employments where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from contacts where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from companies where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`alter table audit_logs disable trigger user`;
    await database.client`delete from auth_users where id = ${userId}`;
    await database.client`alter table audit_logs enable trigger user`;
    await database.client`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.close();
  });

  test("queues idempotently and persists field provenance without promoting probable email", async () => {
    const first = await handle(new Request(`http://localhost/api/v1/contacts/${contactId}/actions/enrich`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestKey: "same-request" }) }));
    expect(first.status).toBe(202);
    const firstBody = await first.json() as { id: string };
    const replay = await handle(new Request(`http://localhost/api/v1/contacts/${contactId}/actions/enrich`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestKey: "same-request" }) }));
    expect(replay.status).toBe(200);
    const job = await handle(new Request(`http://localhost/api/v1/enrichment-jobs/${firstBody.id}`));
    expect(job.status).toBe(200);
    expect((await job.json() as { status: string }).status).toBe("succeeded");
    const observations = await database.client<{ field: string; status: string; evidence_url: string | null; phone_kind: string | null }[]>`select field, status, evidence_url, phone_kind from enrichment_observations where workspace_id = ${workspaceId} order by field`;
    expect(observations.map((item) => item.field)).toEqual(["company.domain", "company.website", "email", "phone"]);
    expect(observations.find((item) => item.field === "email")?.status).toBe("found");
    expect(observations.find((item) => item.field === "email")?.evidence_url).toBe("https://example.com/team");
    expect(observations.find((item) => item.field === "phone")?.phone_kind).toBe("public_company");

    await database.client`insert into contact_suppressions (id, workspace_id, contact_id, channel, identity_type, normalized_value, reason) values (${crypto.randomUUID()}, ${workspaceId}, ${contactId}, 'email', 'email', ${email}, 'opt out')`;
    const suppressed = await handle(new Request(`http://localhost/api/v1/contacts/${contactId}/actions/enrich`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestKey: "suppressed-request" }) }));
    expect(suppressed.status).toBe(202);
    const suppressedJob = await suppressed.json() as { id: string };
    const suppressedObservations = await database.client<{ count: number }[]>`select count(*)::int as count from enrichment_observations where workspace_id = ${workspaceId} and job_id = ${suppressedJob.id}`;
    expect(suppressedObservations[0]?.count).toBe(0);
  });

  test("rejects reviewer and isolates workspaces", async () => {
    context.role = "reviewer";
    const forbidden = await handle(new Request(`http://localhost/api/v1/contacts/${contactId}/actions/enrich`, { method: "POST", body: "{}" }));
    expect(forbidden.status).toBe(403);
    context.role = "operator";
    context.workspaceId = otherWorkspaceId;
    const invisible = await handle(new Request(`http://localhost/api/v1/contacts/${contactId}/enrichment`));
    expect(invisible.status).toBe(200);
    expect((await invisible.json() as { data: unknown[] }).data).toHaveLength(0);
    context.workspaceId = workspaceId;
  });
});
