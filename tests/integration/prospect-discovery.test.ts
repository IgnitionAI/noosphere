import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { CreateProductResearchRun } from "@outbound/application/gtm/product-research-use-cases";
import type { ProspectEnricher } from "@outbound/application/crm/prospect-enrichment-ports";
import type { JobQueue, NewJob } from "@outbound/application/jobs/job-queue";
import { CryptoIdGenerator, SystemClock } from "@outbound/application/shared/ports";
import type { ProspectChannel } from "@outbound/domain/crm/prospect-channels";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresProductResearchRepository } from "@outbound/infrastructure/gtm/postgres-product-research-repository";
import {
  ProviderUnavailableError,
  type ProspectSource,
  type ProspectSourceCandidate,
} from "@outbound/infrastructure/crm/unipile-prospect-source";
import {
  authUsers,
  icpProposals,
  icps,
  icpVersions,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { createDiscoveryHttpHandler } from "@outbound/interface/http/discovery-handler";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-023 prospect discovery", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const context = {
    userId,
    workspaceId,
    role: "operator" as "operator" | "viewer",
  };
  let provider: FakeProspectSource;
  let enricher: ProspectEnricher | null = null;
  const handle = createDiscoveryHttpHandler({
    contextResolver: { async resolve() { return context; } },
    database: database.db,
    prospectSource: () => provider,
    prospectEnricher: () => enricher,
  });
  let versionId: string;

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `f023-a-${workspaceId}`, name: "F-023 A" },
      { id: otherWorkspaceId, slug: `f023-b-${otherWorkspaceId}`, name: "F-023 B" },
    ]);
    await database.db.insert(authUsers).values({
      id: userId,
      name: "Discovery Tester",
      email: `f023-${userId}@example.com`,
    });
    const researchRepository = new PostgresProductResearchRepository(database.db);
    const create = new CreateProductResearchRun(
      researchRepository,
      new CryptoIdGenerator(),
      new SystemClock(),
    );
    const run = await create.execute({
      workspaceId,
      brief: {
        productUrl: "https://example.com",
        productName: "Discovery Example",
        description: "",
        geography: "France",
        languages: ["fr"],
        salesMotion: "saas",
        knownCompetitors: [],
        internalDocumentIds: [],
        depth: "standard",
      },
    });
    const proposalId = crypto.randomUUID();
    await database.db.insert(icpProposals).values({
      id: proposalId,
      workspaceId,
      runId: run.snapshot.id,
      name: "Cabinets juridiques français",
      rank: 1,
      confidence: "0.8",
      criteria: { sectors: ["legal", "avocat"], geography: "France", employeeCount: { min: 10, max: 250 } },
      buyingCommittee: ["Managing Partner", "Associé"],
      problems: ["Gouvernance IA dispersée"],
      signals: ["Lancement d’un assistant interne"],
      exclusions: [],
      unknowns: ["Budget"],
    });
    versionId = crypto.randomUUID();
    await database.db.insert(icps).values({
      id: versionId, workspaceId, name: "Cabinets juridiques français", currentVersion: 1,
    });
    await database.db.insert(icpVersions).values({
      id: versionId,
      workspaceId,
      icpId: versionId,
      runId: run.snapshot.id,
      proposalId,
      version: 1,
      name: "Cabinets juridiques français",
      confidence: "0.8",
      criteria: { sectors: ["legal", "avocat"], geography: "France", employeeCount: { min: 10, max: 250 } },
      buyingCommittee: ["Managing Partner", "Associé"],
      problems: ["Gouvernance IA dispersée"],
      signals: ["Lancement d’un assistant interne"],
      exclusions: [],
      unknowns: ["Budget"],
      unresolvedContradictions: [],
      blockedFindings: [],
      publishedBy: userId,
      publishedAt: new Date(),
    });
  });

  afterAll(async () => {
    await database.client`drop trigger if exists audit_logs_immutable_trg on audit_logs`;
    await database.client`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from prospect_discovery_candidates where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from prospect_discovery_runs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from contact_suppressions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from contacts where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from companies where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`drop trigger if exists icp_versions_immutable_trg on icp_versions`;
    await database.client`delete from icp_versions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from icps where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from product_research_runs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
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

  test("lists published ICP versions of the workspace only", async () => {
    const response = await handle(new Request("http://localhost/api/v1/icp-versions"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ id: string; name: string }> };
    expect(body.data.map((version) => version.id)).toContain(versionId);

    context.workspaceId = otherWorkspaceId;
    const foreign = await handle(new Request("http://localhost/api/v1/icp-versions"));
    expect(((await foreign.json()) as { data: unknown[] }).data).toHaveLength(0);
    context.workspaceId = workspaceId;
  });

  test("rejects a search on an unknown version and runs a recorded search otherwise", async () => {
    const missing = await postJson(
      `/api/v1/icp-versions/${crypto.randomUUID()}/discovery-runs`,
      {},
    );
    expect(missing.status).toBe(404);

    provider = new FakeProspectSource([
      {
        fullName: "Marion Delacroix",
        headline: "Associée · Cabinet Delacroix (legal)",
        linkedinUrl: "https://www.linkedin.com/in/marion-delacroix/",
        location: "Paris, France",
        companyName: "Cabinet Delacroix",
        channels: {
          linkedin: {
            value: "https://www.linkedin.com/in/marion-delacroix/",
            normalizedValue: "linkedin.com/in/marion-delacroix",
            status: "verified",
            confidence: "high",
            source: "unipile_linkedin_profile",
          },
          email: {
            value: "marion@cabinet-delacroix.fr",
            normalizedValue: "marion@cabinet-delacroix.fr",
            status: "found",
            confidence: "medium",
            source: "linkedin_contact_info",
          },
          whatsapp: {
            value: "+33 6 12 34 56 78",
            normalizedValue: "+33612345678",
            status: "verified",
            confidence: "high",
            source: "unipile_whatsapp_profile",
          },
        },
        providerData: { providerId: "li_1" },
      },
      {
        fullName: "John Smith",
        headline: "Accountant",
        linkedinUrl: "https://www.linkedin.com/in/john-smith/",
        location: "London, UK",
        companyName: "Smith & Co",
        providerData: { providerId: "li_2" },
      },
    ]);
    const launched = await postJson(`/api/v1/icp-versions/${versionId}/discovery-runs`, {
      limit: 25,
    });
    expect(launched.status).toBe(201);
    const run = (await launched.json()) as {
      id: string;
      status: string;
      filters: { keywords: string; category: string };
      candidateCount: number;
    };
    expect(run.status).toBe("completed");
    expect(run.filters.category).toBe("people");
    expect(run.filters.keywords).toContain("legal");
    expect(run.candidateCount).toBe(2);
    const discoveredEvents = await database.client<{ count: number }[]>`
      select count(*)::int as count
      from outbox_events
      where workspace_id = ${workspaceId}
        and event_type = 'ProspectDiscovered'
        and payload->>'runId' = ${run.id}
    `;
    expect(discoveredEvents[0]?.count).toBe(2);
    const discoveryAudits = await database.client<{ count: number }[]>`
      select count(*)::int as count
      from audit_logs
      where workspace_id = ${workspaceId}
        and action = 'ProspectDiscovered'
        and changes->>'runId' = ${run.id}
    `;
    expect(discoveryAudits[0]?.count).toBe(2);

    const detail = await handle(
      new Request(`http://localhost/api/v1/discovery-runs/${run.id}`),
    );
    const body = (await detail.json()) as {
      candidates: Array<{
        id: string;
        source: string;
        fullName: string;
        icpFit: { matches: string[]; gaps: string[] };
      }>;
    };
    const marion = body.candidates.find((candidate) => candidate.fullName === "Marion Delacroix")!;
    const john = body.candidates.find((candidate) => candidate.fullName === "John Smith")!;
    expect(marion.source).toBe("discovery");
    expect(marion.icpFit.matches.join(" ")).toContain("France");
    expect(john.icpFit.gaps.length).toBeGreaterThan(0);

    // Import the matching candidate with full provenance.
    const imported = await postJson(
      `/api/v1/discovery-runs/${run.id}/candidates/${marion.id}/actions/import`,
      {},
    );
    expect(imported.status).toBe(201);
    const contact = (await imported.json()) as { id: string; source: string };
    expect(contact.source).toBe("discovery");

    const contactDetail = await handle(
      new Request(`http://localhost/api/v1/contacts/${contact.id}`),
    );
    const contactBody = (await contactDetail.json()) as {
      identities: Array<{ type: string; normalizedValue: string }>;
      employments: Array<{ companyName: string; isCurrent: boolean }>;
    };
    expect(
      contactBody.identities.find((identity) => identity.type === "linkedin")?.normalizedValue,
    ).toBe("linkedin.com/in/marion-delacroix");
    expect(
      contactBody.identities.find((identity) => identity.type === "email")?.normalizedValue,
    ).toBe("marion@cabinet-delacroix.fr");
    expect(
      contactBody.identities.find((identity) => identity.type === "whatsapp")?.normalizedValue,
    ).toBe("+33612345678");
    expect(contactBody.employments[0]?.companyName).toBe("Cabinet Delacroix");
    expect(contactBody.employments[0]?.isCurrent).toBe(true);

    // Importing again is idempotent-friendly: it points to the same contact.
    const duplicate = await postJson(
      `/api/v1/discovery-runs/${run.id}/candidates/${marion.id}/actions/import`,
      {},
    );
    expect(duplicate.status).toBe(409);

    // A suppressed identity cannot be imported.
    await postJson(`/api/v1/contacts/${contact.id}/actions/suppress`, {
      channel: "global",
      reason: "Opposition",
    });
    provider = new FakeProspectSource([
      {
        fullName: "Marion Delacroix",
        headline: "Associée",
        linkedinUrl: "https://www.linkedin.com/in/marion-delacroix/",
        location: "Paris, France",
        companyName: "Cabinet Delacroix",
        providerData: { providerId: "li_1" },
      },
    ]);
    const secondRun = (await (
      await postJson(`/api/v1/icp-versions/${versionId}/discovery-runs`, {})
    ).json()) as { id: string };
    const secondDetail = (await (
      await handle(new Request(`http://localhost/api/v1/discovery-runs/${secondRun.id}`))
    ).json()) as { candidates: Array<{ id: string }> };
    const suppressedImport = await postJson(
      `/api/v1/discovery-runs/${secondRun.id}/candidates/${secondDetail.candidates[0]!.id}/actions/import`,
      {},
    );
    expect(suppressedImport.status).toBe(409);
    expect(((await suppressedImport.json()) as { code: string }).code).toBe(
      "CONTACT_SUPPRESSED",
    );
  });

  test("a provider outage fails the run recoverably and retry works", async () => {
    provider = new FakeProspectSource(new ProviderUnavailableError("Unipile down (503)", 503));
    const launched = await postJson(`/api/v1/icp-versions/${versionId}/discovery-runs`, {});
    expect(launched.status).toBe(201);
    const run = (await launched.json()) as { id: string; status: string; errorCode: string };
    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("PROVIDER_UNAVAILABLE");

    provider = new FakeProspectSource([
      {
        fullName: "Recovered Person",
        headline: "Associé",
        linkedinUrl: "https://www.linkedin.com/in/recovered/",
        location: "Lyon, France",
        companyName: "Recovered Co",
        providerData: {},
      },
    ]);
    const retried = await postJson(`/api/v1/discovery-runs/${run.id}/actions/retry`, {});
    expect(retried.status).toBe(200);
    expect(((await retried.json()) as { status: string }).status).toBe("completed");

    provider = new FakeProspectSource(new ProviderUnavailableError("Unipile still down", 503));
    const bounded = (await (await postJson(`/api/v1/icp-versions/${versionId}/discovery-runs`, {})).json()) as { id: string };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const retry = await postJson(`/api/v1/discovery-runs/${bounded.id}/actions/retry`, {});
      expect(retry.status).toBe(200);
      expect(((await retry.json()) as { status: string }).status).toBe("failed");
    }
    const exhausted = await postJson(`/api/v1/discovery-runs/${bounded.id}/actions/retry`, {});
    expect(exhausted.status).toBe(409);
    expect(((await exhausted.json()) as { code: string }).code).toBe("DISCOVERY_RETRY_EXHAUSTED");
  });

  test("runtime scheduling returns immediately and persists a durable discovery job", async () => {
    const jobs: NewJob[] = [];
    const jobQueue: JobQueue = {
      async enqueue(job) {
        jobs.push(job);
        return { inserted: true };
      },
      async lease() { return []; },
      async renewLease() { return true; },
      async acknowledge() {},
      async retry() { return "scheduled"; },
    };
    const asyncHandle = createDiscoveryHttpHandler({
      contextResolver: { async resolve() { return context; } },
      database: database.db,
      prospectSource: () => provider,
      prospectEnricher: () => enricher,
      jobQueue,
    });
    const launchRequest = () =>
      new Request(`http://localhost/api/v1/icp-versions/${versionId}/discovery-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 25 }),
      });
    let runId: string | null = null;
    try {
      const response = await asyncHandle(launchRequest());
      expect(response.status).toBe(202);
      const run = (await response.json()) as { id: string; status: string };
      runId = run.id;
      expect(run.status).toBe("running");
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        workspaceId,
        type: "prospect.discovery.execute",
        payload: { workspaceId, runId: run.id },
        maxAttempts: 3,
      });

      const duplicateResponse = await asyncHandle(launchRequest());
      expect(duplicateResponse.status).toBe(200);
      const duplicateRun = (await duplicateResponse.json()) as { id: string; status: string };
      expect(duplicateRun).toMatchObject({ id: run.id, status: "running" });
      expect(jobs).toHaveLength(1);

      const detail = await asyncHandle(
        new Request(`http://localhost/api/v1/discovery-runs/${run.id}`),
      );
      expect(((await detail.json()) as { status: string }).status).toBe("running");
    } finally {
      if (runId) {
        await database.client`
          update prospect_discovery_runs
          set status = 'failed', completed_at = now()
          where workspace_id = ${workspaceId} and id = ${runId}
        `;
      }
    }
  });

  test("LinkedIn discovery stays person-first and never invokes public web enrichment", async () => {
    provider = new FakeProspectSource(
      [{
        fullName: "Claire Martin",
        headline: "Managing Partner",
        linkedinUrl: "https://www.linkedin.com/in/claire-martin/",
        location: "Paris, France",
        companyName: "Martin Conseil",
        providerData: { providerId: "li_claire" },
      }],
    );
    let enrichmentCalls = 0;
    enricher = {
      async enrich() {
        enrichmentCalls += 1;
        throw new Error("LINKEDIN_DISCOVERY_MUST_NOT_ENRICH_CONTACTS");
      },
    };

    const run = (await (
      await postJson(`/api/v1/icp-versions/${versionId}/discovery-runs`, { limit: 1 })
    ).json()) as { id: string };
    enricher = null;
    const detail = (await (
      await handle(new Request(`http://localhost/api/v1/discovery-runs/${run.id}`))
    ).json()) as {
      candidates: Array<{
        id: string;
        companyWebsite: string | null;
        companyDomain: string | null;
        channels: {
          linkedin: ProspectChannel;
          email: ProspectChannel;
          whatsapp: ProspectChannel;
        };
      }>;
    };
    const candidate = detail.candidates[0]!;
    expect(enrichmentCalls).toBe(0);
    expect(candidate.companyWebsite).toBeNull();
    expect(candidate.companyDomain).toBeNull();
    expect(candidate.channels.linkedin.status).toBe("found");
    expect(candidate.channels.email.status).toBe("unavailable");
    expect(candidate.channels.whatsapp.status).toBe("unavailable");

    const imported = await postJson(
      `/api/v1/discovery-runs/${run.id}/candidates/${candidate.id}/actions/import`,
      {},
    );
    expect(imported.status).toBe(201);
    const contact = (await imported.json()) as { id: string };
    const contactDetail = (await (
      await handle(new Request(`http://localhost/api/v1/contacts/${contact.id}`))
    ).json()) as {
      identities: Array<{ type: string; normalizedValue: string }>;
    };
    expect(contactDetail.identities.map((identity) => identity.type)).toEqual(["linkedin"]);
  });

  test("a viewer cannot launch or import", async () => {
    context.role = "viewer";
    const launched = await postJson(`/api/v1/icp-versions/${versionId}/discovery-runs`, {});
    expect(launched.status).toBe(403);
    context.role = "operator";
  });
});

class FakeProspectSource implements ProspectSource {
  constructor(
    private readonly outcome:
      | readonly ProspectSourceCandidate[]
      | ProviderUnavailableError,
    private readonly whatsappVerification?: ProspectChannel,
  ) {}

  async searchPeople() {
    if (this.outcome instanceof ProviderUnavailableError) throw this.outcome;
    return this.outcome;
  }

  async verifyWhatsappNumber(phone: string): Promise<ProspectChannel> {
    return this.whatsappVerification ?? {
      value: phone,
      normalizedValue: phone,
      status: "unverified",
      confidence: "low",
      source: "unipile_whatsapp_check",
    };
  }
}
