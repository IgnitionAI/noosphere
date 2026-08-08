import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, eq } from "drizzle-orm";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  authUsers,
  campaigns,
  channelAssessments,
  contactChannelAssignments,
  contactIdentities,
  contacts,
  dailyProspectingSchedules,
  dailySourcingCycles,
  icps,
  icpVersions,
  jobs,
  outreachActions,
  outboxEvents,
  phoneObservations,
  productResearchRuns,
  prospectDiscoveryCandidates,
  prospectDiscoveryRuns,
  prospectingPlans,
  sequences,
  sourcingFrontiers,
  workspaces,
  whatsappReachabilityChecks,
} from "@outbound/infrastructure/database/schema";
import { DailyProspectingScheduler } from "@outbound/infrastructure/campaigns/daily-prospecting-scheduler";
import { PostgresDailySourcingBudget } from "@outbound/infrastructure/crm/postgres-daily-sourcing-budget";
import { CrawlerCompanyProspectSource } from "@outbound/infrastructure/crm/crawler-company-prospect-source";
import { ProspectDiscoveryJobProcessor, ProspectDiscoveryRunner } from "@outbound/infrastructure/crm/prospect-discovery-runner";
import { CampaignAutomationJobProcessor } from "@outbound/infrastructure/campaigns/campaign-automation-runner";
import { PostgresWhatsappReachabilityResolver } from "@outbound/infrastructure/crm/postgres-whatsapp-reachability-resolver";
import type { CrawlerClient } from "@outbound/infrastructure/ai/crawler-client";
import { integrationTestDatabaseUrl } from "../../scripts/run-integration-tests";

describe("WhatsApp sourcing V1", () => {
  const database = createDatabase(integrationTestDatabaseUrl(process.env));
  const workspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const icpVersionId = crypto.randomUUID();
  const icpId = crypto.randomUUID();
  const planId = crypto.randomUUID();
  const assessmentId = crypto.randomUUID();
  const sequenceId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const now = new Date("2026-08-06T04:00:00.000Z");
  const clock = { now: () => new Date(now) };

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
    await database.db.insert(workspaces).values({
      id: workspaceId,
      slug: `wa-source-${workspaceId}`,
      name: "WhatsApp sourcing V1",
    });
    await database.db.insert(authUsers).values({
      id: userId,
      name: "Sourcing Tester",
      email: `wa-source-${userId}@example.com`,
    });
    await database.db.insert(productResearchRuns).values({
      id: runId,
      workspaceId,
      brief: { productName: "Fixture" },
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(icps).values({
      id: icpId,
      workspaceId,
      name: "Cabinets indépendants",
      currentVersion: 1,
    });
    await database.db.insert(icpVersions).values({
      id: icpVersionId,
      workspaceId,
      icpId,
      runId,
      proposalId: crypto.randomUUID(),
      version: 1,
      name: "Cabinets indépendants",
      confidence: "0.8",
      criteria: {},
      buyingCommittee: [],
      problems: [],
      signals: [],
      exclusions: [],
      unknowns: [],
      unresolvedContradictions: [],
      blockedFindings: [],
      publishedBy: userId,
      publishedAt: now,
    });
    await database.db.insert(sequences).values({
      id: sequenceId,
      workspaceId,
      name: "WhatsApp fixture",
      status: "draft",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(prospectingPlans).values({
      id: planId,
      workspaceId,
      icpVersionId,
      name: "Plan fixture",
      status: "ready",
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(channelAssessments).values({
      id: assessmentId,
      workspaceId,
      planId,
      channel: "whatsapp",
      status: "completed",
      recommendation: "recommended",
      score: 80,
      strategy: { query: "cabinet indépendant", sourceKinds: ["web"], sampleSize: 12 },
      metrics: {},
      evidence: [],
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(campaigns).values({
      id: campaignId,
      workspaceId,
      icpVersionId,
      planId,
      assessmentId,
      channel: "whatsapp",
      name: "WhatsApp · Cabinets indépendants",
      status: "active",
      sequenceId,
      automationStage: "running",
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(dailyProspectingSchedules).values({
      workspaceId,
      enabled: true,
      localTime: "06:00",
      timezone: "Europe/Paris",
      nextRunAt: new Date(now.getTime() - 1_000),
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await database.client`delete from jobs where workspace_id = ${workspaceId}`;
    await database.client`delete from outbox_events where workspace_id = ${workspaceId}`;
    await database.client`delete from contact_channel_assignments where workspace_id = ${workspaceId}`;
    await database.client`delete from campaign_prospects where workspace_id = ${workspaceId}`;
    await database.client`delete from contact_employments where workspace_id = ${workspaceId}`;
    await database.client`delete from contact_identities where workspace_id = ${workspaceId}`;
    await database.client`delete from contacts where workspace_id = ${workspaceId}`;
    await database.client`delete from phone_observations where workspace_id = ${workspaceId}`;
    await database.client`delete from whatsapp_reachability_checks where workspace_id = ${workspaceId}`;
    await database.client`delete from prospect_discovery_candidates where workspace_id = ${workspaceId}`;
    await database.client`delete from prospect_discovery_runs where workspace_id = ${workspaceId}`;
    await database.client`delete from sourcing_frontiers where workspace_id = ${workspaceId}`;
    await database.client`delete from daily_sourcing_cycles where workspace_id = ${workspaceId}`;
    await database.client`delete from daily_prospecting_schedules where workspace_id = ${workspaceId}`;
    await database.client`delete from campaigns where workspace_id = ${workspaceId}`;
    await database.client`delete from channel_assessments where workspace_id = ${workspaceId}`;
    await database.client`delete from prospecting_plans where workspace_id = ${workspaceId}`;
    await database.client`delete from sequences where workspace_id = ${workspaceId}`;
    // Published ICP versions are immutable and retain provenance to their run;
    // this test uses a disposable workspace and must not bypass those guards.
    await database.close();
  });

  test("reserves a shared daily budget atomically", async () => {
    const cycleId = crypto.randomUUID();
    await database.db.insert(dailySourcingCycles).values({
      id: cycleId,
      workspaceId,
      localDate: "2026-08-05",
      deadlineAt: new Date(now.getTime() + 60_000),
      pageLimit: 10,
      verificationLimit: 3,
      createdAt: now,
      updatedAt: now,
    });
    const budget = new PostgresDailySourcingBudget(database.db);
    const results = await Promise.all(Array.from({ length: 30 }, () => budget.reserve({
      cycleId,
      resource: "page",
      amount: 1,
      now,
    })));
    expect(results.filter((result) => result.accepted)).toHaveLength(10);
    const [cycle] = await database.db
      .select()
      .from(dailySourcingCycles)
      .where(eq(dailySourcingCycles.id, cycleId));
    expect(cycle?.pageAttempts).toBe(10);
  });

  test("scopes the 30-day reachability cache to the selected provider account", async () => {
    let liveCalls = 0;
    const budget = new PostgresDailySourcingBudget(database.db);
    const resolver = new PostgresWhatsappReachabilityResolver(
      database.db,
      {
        async searchPeople() { return []; },
        async resolveHealthyAccount() { return "wa-account-a"; },
        async verifyWhatsappReachability() {
          liveCalls += 1;
          return {
            status: "verified",
            providerAccountId: "wa-account-a",
            checkedAt: now,
            expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
            source: "live",
            errorCode: null,
          };
        },
      },
      budget,
    );
    const first = await resolver.resolve({
      workspaceId,
      phone: "+33612345678",
      e164: "+33612345678",
      sourcingCycleId: null,
      now,
    });
    const second = await resolver.resolve({
      workspaceId,
      phone: "+33612345678",
      e164: "+33612345678",
      sourcingCycleId: null,
      now: new Date(now.getTime() + 60_000),
    });
    expect(first.source).toBe("live");
    expect(second.source).toBe("cache");
    expect(liveCalls).toBe(1);

    const changedAccount = new PostgresWhatsappReachabilityResolver(
      database.db,
      {
        async searchPeople() { return []; },
        async resolveHealthyAccount() { return "wa-account-b"; },
        async verifyWhatsappReachability() {
          return {
            status: "not_registered",
            providerAccountId: "wa-account-b",
            checkedAt: now,
            expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
            source: "live",
            errorCode: null,
          };
        },
      },
      budget,
    );
    expect((await changedAccount.resolve({
      workspaceId,
      phone: "+33612345678",
      e164: "+33612345678",
      sourcingCycleId: null,
      now,
    })).status).toBe("not_registered");
    const checks = await database.db
      .select()
      .from(whatsappReachabilityChecks)
      .where(eq(whatsappReachabilityChecks.workspaceId, workspaceId));
    expect(checks.map((check) => check.providerAccountId).sort()).toEqual([
      "wa-account-a",
      "wa-account-b",
    ]);
  });

  test("runs the shared 06:00 pass into CRM without creating an outreach action", async () => {
    const scheduled = await new DailyProspectingScheduler(database.db, clock).reconcile();
    expect(scheduled).toBe(1);
    expect(await new DailyProspectingScheduler(database.db, clock).reconcile()).toBe(0);
    const [cycle] = await database.db
      .select()
      .from(dailySourcingCycles)
      .where(and(
        eq(dailySourcingCycles.workspaceId, workspaceId),
        eq(dailySourcingCycles.localDate, "2026-08-06"),
      ));
    expect(cycle).toMatchObject({ status: "running", scheduledRunCount: 1 });
    const [run] = await database.db
      .select()
      .from(prospectDiscoveryRuns)
      .where(eq(prospectDiscoveryRuns.sourcingCycleId, cycle!.id));
    expect(run?.campaignId).toBe(campaignId);
    const budget = new PostgresDailySourcingBudget(database.db);
    const companySource = new CrawlerCompanyProspectSource(
      fakeCrawler(),
      () => ({ async searchPeople() { return []; } }),
      {
        budget,
        reachability: {
          async resolve() {
            return {
              status: "verified",
              providerAccountId: "wa-fixture",
              checkedAt: now,
              expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
              source: "live",
              errorCode: null,
            };
          },
        },
        now: () => now,
      },
    );
    const queue = acknowledgementQueue();
    const discoveryProcessor = new ProspectDiscoveryJobProcessor(
      database.db,
      queue,
      new ProspectDiscoveryRunner(
        database.db,
        () => ({ async searchPeople() { return []; } }),
        undefined,
        () => companySource,
      ),
      clock,
    );
    await discoveryProcessor.process(jobFor(run!.id, workspaceId, "prospect.discovery.execute"));
    const [observation] = await database.db
      .select()
      .from(phoneObservations)
      .where(eq(phoneObservations.runId, run!.id));
    expect(observation).toMatchObject({
      e164: "+33612345678",
      attributionStatus: "strong",
      reachabilityStatus: "verified",
      providerAccountId: "wa-fixture",
    });
    const [automationJob] = await database.db
      .select()
      .from(jobs)
      .where(and(
        eq(jobs.workspaceId, workspaceId),
        eq(jobs.type, "campaign.automation.advance"),
      ));
    expect(automationJob).toBeDefined();
    await new CampaignAutomationJobProcessor(database.db, queue, clock).process({
      ...jobFor(automationJob!.id, workspaceId, automationJob!.type),
      payload: automationJob!.payload,
    });
    const imported = await database.db
      .select({ contactId: contacts.id, identity: contactIdentities.normalizedValue })
      .from(contacts)
      .innerJoin(
        contactIdentities,
        and(
          eq(contactIdentities.workspaceId, contacts.workspaceId),
          eq(contactIdentities.contactId, contacts.id),
        ),
      )
      .where(eq(contacts.workspaceId, workspaceId));
    expect(imported).toHaveLength(1);
    expect(imported[0]?.identity).toBe("+33612345678");
    const assignments = await database.db
      .select()
      .from(contactChannelAssignments)
      .where(eq(contactChannelAssignments.workspaceId, workspaceId));
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.campaignId).toBe(campaignId);
    const sends = await database.db
      .select()
      .from(outreachActions)
      .where(eq(outreachActions.workspaceId, workspaceId));
    expect(sends).toHaveLength(0);
  });
});

function fakeCrawler(): CrawlerClient {
  return {
    async search() {
      return [{
        url: "https://cabinet-durand.fr/contact",
        canonicalUrl: "https://cabinet-durand.fr/contact",
        title: "Cabinet Durand — Conseil",
        description: "Cabinet indépendant",
        provider: "searxng",
      }];
    },
    async discover() {
      return [{
        url: "https://cabinet-durand.fr/contact",
        title: "Contact",
        depth: 1,
        path: "/contact",
      }];
    },
    async readPages() {
      return [{
        url: "https://cabinet-durand.fr/contact",
        canonicalUrl: "https://cabinet-durand.fr/contact",
        title: "Contact",
        markdown: "Cabinet Durand — Contact professionnel — Portable : +33 6 12 34 56 78",
        contentHash: "fixture-content-hash",
        collectedAt: "2026-08-06T04:01:00.000Z",
        metadata: {},
      }];
    },
  } as unknown as CrawlerClient;
}

function jobFor(id: string, workspaceId: string, type: string): LeasedJob {
  return {
    id,
    workspaceId,
    type,
    payload: { workspaceId, runId: id },
    idempotencyKey: `fixture:${id}`,
    correlationId: `fixture:${id}`,
    attempts: 1,
    maxAttempts: 3,
    availableAt: new Date(),
    lockedUntil: new Date(Date.now() + 60_000),
    lockedBy: "fixture-worker",
  };
}

function acknowledgementQueue(): JobQueue {
  return {
    async enqueue() { return { inserted: true }; },
    async lease() { return []; },
    async renewLease() { return true; },
    async acknowledge() {},
    async retry() { return "scheduled"; },
  };
}
