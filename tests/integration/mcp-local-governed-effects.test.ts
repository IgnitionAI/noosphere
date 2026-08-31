import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase, type Database, type DatabaseExecutor } from "@outbound/infrastructure/database/client";
import {
  approvalItems,
  campaigns,
  contentAssetVersions,
  contentAssets,
  contentBriefs,
  contentPublications,
  contentGenerationRuns,
  contentIdeas,
  contactIdentities,
  contacts,
  conversations,
  connectedAccounts,
  contactSuppressions,
  editorialStrategies,
  editorialStrategyVersions,
  icpVersions,
  icps,
  messages,
  meetingProposals,
  offers,
  offerVersions,
  jobs,
  mcpEffectIntentions,
  mcpEffectProposals,
  mcpEffectReconciliations,
  mcpEffectTraces,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { PostgresMcpExternalEffectAttemptRepository } from "@outbound/infrastructure/mcp/postgres-mcp-effect-attempt-repository";
import { PostgresMcpEffectReconciliationRepository } from "@outbound/infrastructure/mcp/postgres-mcp-effect-reconciliation-repository";
import { PostgresMcpGovernedEffectExecutor, PostgresMcpGovernedEffectSourceReader } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-executor";
import { PostgresMcpGovernedEffectWorker } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-worker";
import { PostgresExternalEffectFactsReader } from "@outbound/infrastructure/mcp/postgres-external-effect-facts-reader";
import { ExternalEffectPolicy } from "@outbound/application/mcp/external-effect-policy";
import {
  createLocalGovernedEffectFakes,
  resetLocalFakeCounters,
} from "@outbound/infrastructure/mcp/local-governed-effect-fakes";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationEnabled = process.env.MCP_LOCAL_GOVERNED_EFFECTS_INTEGRATION === "1" && Boolean(databaseUrl);
const databaseDescribe = integrationEnabled ? describe : describe.skip;

type LocalFakeOptions = Parameters<typeof createLocalGovernedEffectFakes>[0];
type LocalFakes = ReturnType<typeof createLocalGovernedEffectFakes>;

/**
 * Scope each sub-case's process-local fake registry, including assertion and
 * fixture failures. Production keeps its one-instance fail-closed contract.
 */
async function withLocalFakes<T>(
  options: LocalFakeOptions,
  callback: (fakes: LocalFakes) => Promise<T> | T,
): Promise<T> {
  resetLocalFakeCounters();
  try {
    return await callback(createLocalGovernedEffectFakes(options));
  } finally {
    resetLocalFakeCounters();
  }
}

databaseDescribe("local governed-effect fake adapters through the durable worker", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const now = new Date("2026-08-31T12:00:00.000Z");
  const fixtureIds: string[] = [];

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
  });

  // The local fake registry is intentionally one-instance fail-closed. Keep
  // each integration case isolated even when setup/assertions throw early.
  beforeEach(() => resetLocalFakeCounters());
  afterEach(() => resetLocalFakeCounters());

  afterAll(async () => {
    try {
      for (const workspaceId of fixtureIds) await cleanupFixture(database, workspaceId);
    } finally {
      resetLocalFakeCounters();
      await database.close();
    }
  });

  test("persists marker before a local conversation callback and terminal result", async () => {
    const fixture = await createConversationFixture(database, now);
    fixtureIds.push(fixture.workspaceId);
    const localFakes = createLocalGovernedEffectFakes(localOptions("success"));
    let markerWasCommitted = false;
    const delegate = localFakes.adapters.outbound!;
    const executor = new PostgresMcpGovernedEffectExecutor(database.db, {
      ...localFakes.adapters,
      outbound: {
        send: async (input) => {
          const markerRows = await database.db.select({ id: mcpEffectTraces.id }).from(mcpEffectTraces).where(and(
            eq(mcpEffectTraces.workspaceId, fixture.workspaceId),
            eq(mcpEffectTraces.proposalId, fixture.proposalId),
            eq(mcpEffectTraces.stage, "attempt"),
          ));
          markerWasCommitted = markerRows.length === 1;
          return delegate.send(input);
        },
      },
    });
    const { result, acknowledgements } = await processFixture(database, fixture, executor, localFakes, () => ({ decision: "allow", code: "OK", factsVersion: 1 }));

    expect(markerWasCommitted).toBe(true);
    expect(result).toMatchObject({ outcome: "already_completed", code: "DELIVERED" });
    expect(localFakes.counters.conversationReply).toBe(1);
    expect(acknowledgements).toBe(1);
    const [proposal] = await database.db.select({ status: mcpEffectProposals.status }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, fixture.proposalId));
    const [intention] = await database.db.select({ state: mcpEffectIntentions.state }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, fixture.intentionId));
    const traces = await database.db.select({ stage: mcpEffectTraces.stage }).from(mcpEffectTraces).where(and(
      eq(mcpEffectTraces.workspaceId, fixture.workspaceId),
      eq(mcpEffectTraces.proposalId, fixture.proposalId),
    )).orderBy(asc(mcpEffectTraces.sequence));
    expect(proposal?.status).toBe("delivered");
    expect(intention?.state).toBe("completed");
    expect(traces.map((trace) => trace.stage)).toEqual(["policy", "attempt", "result"]);
  });

  test("records an ambiguous local outcome once and replays without resending", async () => {
    const fixture = await createConversationFixture(database, now);
    fixtureIds.push(fixture.workspaceId);
    const localFakes = createLocalGovernedEffectFakes(localOptions("ambiguous"));
    const executor = new PostgresMcpGovernedEffectExecutor(database.db, localFakes.adapters);
    const first = await processFixture(database, fixture, executor, localFakes, () => ({ decision: "allow", code: "OK", factsVersion: 1 }));
    const second = await processFixture(database, fixture, executor, localFakes, () => ({ decision: "allow", code: "OK", factsVersion: 1 }));

    expect(first.result).toMatchObject({ outcome: "invalidated", code: "MCP_LOCAL_FAKE_AMBIGUOUS" });
    expect(second.result).toMatchObject({ outcome: "already_claimed", code: "MCP_EFFECT_ALREADY_CLAIMED" });
    expect(localFakes.counters.conversationReply).toBe(1);
    const reconciliation = await database.db.select({ id: mcpEffectReconciliations.id }).from(mcpEffectReconciliations).where(eq(mcpEffectReconciliations.workspaceId, fixture.workspaceId));
    expect(reconciliation).toHaveLength(1);
    expect(first.acknowledgements + second.acknowledgements).toBe(2);
  });

  test("fails closed on final policy denial without crossing any fake adapter", async () => {
    const fixture = await createConversationFixture(database, now);
    fixtureIds.push(fixture.workspaceId);
    const localFakes = createLocalGovernedEffectFakes(localOptions("success"));
    const executor = new PostgresMcpGovernedEffectExecutor(database.db, localFakes.adapters);
    let policyCalls = 0;
    const { result, acknowledgements } = await processFixture(database, fixture, executor, localFakes, () => {
      policyCalls += 1;
      return { decision: "deny" as const, code: "CONTACT_SUPPRESSED" as const, factsVersion: 1 };
    });

    expect(result).toMatchObject({ outcome: "policy_denied", code: "CONTACT_SUPPRESSED" });
    expect(policyCalls).toBe(1);
    expect(localFakes.counters.conversationReply).toBe(0);
    expect(acknowledgements).toBe(1);
    const traces = await database.db.select({ stage: mcpEffectTraces.stage }).from(mcpEffectTraces).where(eq(mcpEffectTraces.proposalId, fixture.proposalId));
    expect(traces.map((trace) => trace.stage)).toEqual(["policy"]);
  });

  test("fails closed when the authoritative contact is anonymized without claiming contact-null", async () => {
    const fixture = await createConversationFixture(database, now);
    fixtureIds.push(fixture.workspaceId);
    await database.db.update(contacts).set({ anonymizedAt: now }).where(eq(contacts.id, fixture.contactId));
    const localFakes = createLocalGovernedEffectFakes(localOptions("success"));
    const executor = new PostgresMcpGovernedEffectExecutor(database.db, localFakes.adapters);
    const policy = new ExternalEffectPolicy(new PostgresExternalEffectFactsReader(database.db, () => now));
    const { result, acknowledgements } = await processFixture(database, fixture, executor, localFakes, undefined, policy);

    expect(result).toMatchObject({ outcome: "invalidated", code: "ADAPTER_UNAVAILABLE" });
    expect(localFakes.counters.conversationReply).toBe(0);
    expect(acknowledgements).toBe(1);
  });

  test("uses the real PostgreSQL facts policy for opt-out, human reply, and revision changes", async () => {
    const policy = new ExternalEffectPolicy(new PostgresExternalEffectFactsReader(database.db, () => now));

    const suppressed = await createConversationFixture(database, now);
    fixtureIds.push(suppressed.workspaceId);
    await database.db.insert(contactSuppressions).values({
      id: crypto.randomUUID(), workspaceId: suppressed.workspaceId, contactId: suppressed.contactId,
      channel: "global", reason: "local-fake-opt-out", createdAt: now,
    });
    await withLocalFakes(localOptions("success"), async (suppressedFakes) => {
      const suppressedRun = await processFixture(database, suppressed, new PostgresMcpGovernedEffectExecutor(database.db, suppressedFakes.adapters), suppressedFakes, undefined, policy);
      expect(suppressedRun.result).toMatchObject({ outcome: "policy_denied", code: "CONTACT_SUPPRESSED" });
      expect(suppressedFakes.counters.conversationReply).toBe(0);
      expect(suppressedRun.acknowledgements).toBe(1);
    });

    const replied = await createConversationFixture(database, now);
    fixtureIds.push(replied.workspaceId);
    await database.db.insert(messages).values({
      id: crypto.randomUUID(), workspaceId: replied.workspaceId, conversationId: replied.conversationId,
      providerMessageId: `local-fake-reply-${replied.conversationId}`, direction: "inbound", senderType: "contact",
      body: "private fixture reply", receivedAt: now, createdAt: now,
    });
    await withLocalFakes(localOptions("success"), async (repliedFakes) => {
      const repliedRun = await processFixture(database, replied, new PostgresMcpGovernedEffectExecutor(database.db, repliedFakes.adapters), repliedFakes, undefined, policy);
      expect(repliedRun.result).toMatchObject({ outcome: "policy_denied", code: "HUMAN_REPLY_ARRIVED" });
      expect(repliedFakes.counters.conversationReply).toBe(0);
      expect(repliedRun.acknowledgements).toBe(1);
    });

    const revised = await createConversationFixture(database, now);
    fixtureIds.push(revised.workspaceId);
    await database.db.update(contacts).set({ revision: 2, updatedAt: new Date(now.getTime() + 1_000) }).where(eq(contacts.id, revised.contactId));
    await withLocalFakes(localOptions("success"), async (revisedFakes) => {
      const revisedRun = await processFixture(database, revised, new PostgresMcpGovernedEffectExecutor(database.db, revisedFakes.adapters), revisedFakes, undefined, policy);
      expect(revisedRun.result).toMatchObject({ outcome: "invalidated", code: "SOURCE_STALE" });
      expect(revisedFakes.counters.conversationReply).toBe(0);
      expect(revisedRun.acknowledgements).toBe(1);
    });
  });

  test("maps each local fake deterministic failure through the real worker and executor", async () => {
    const cases = [
      { kind: "conversation_reply" as const, code: "MCP_LOCAL_FAKE_REJECTED", expectedCount: "conversationReply" as const },
      { kind: "content_publication" as const, code: "MCP_LOCAL_FAKE_REJECTED", expectedCount: "contentPublication" as const },
      { kind: "meeting_proposal" as const, code: "CALCOM_SLOT_UNAVAILABLE", expectedCount: "meetingProposal" as const },
      { kind: "campaign_activation" as const, code: "ADAPTER_UNAVAILABLE", expectedCount: "campaignActivation" as const },
    ];
    for (const scenario of cases) {
      const rollback = new Error(`ROLLBACK_LOCAL_FAILURE_${scenario.kind}`);
      await expect(database.db.transaction(async (tx) => {
        const fixture = await createFailureFixture(tx, scenario.kind, now);
        await withLocalFakes(localOptionsForFailure(scenario.kind, scenario.code), async (fakes) => {
          const sourceReader = new PostgresMcpGovernedEffectSourceReader(tx, () => now);
          await expect(sourceReader.read({ workspaceId: fixture.workspaceId, proposalId: fixture.proposalId, kind: scenario.kind, aggregateId: fixture.aggregateId })).resolves.toMatchObject({ kind: scenario.kind });
          const executor = new PostgresMcpGovernedEffectExecutor(tx as unknown as Database, fakes.adapters, sourceReader, () => now);
          const run = await processWorker(tx as unknown as Database, fixture, executor, fakes, () => ({ decision: "allow", code: "OK", factsVersion: 1 }));
          expect(run.result).toMatchObject({ outcome: "invalidated", code: scenario.code });
          expect(run.acknowledgements).toBe(1);
          expect(fakes.counters[scenario.expectedCount]).toBe(scenario.kind === "campaign_activation" ? 0 : 1);
          const counts = Object.values(fakes.counters);
          expect(counts.reduce((sum, value) => sum + value, 0)).toBe(scenario.kind === "campaign_activation" ? 0 : 1);
          throw rollback;
        });
      })).rejects.toBe(rollback);
    }
  });

  test("reconciles a content unknown through the real read-only executor without a second mutation", async () => {
    const rollback = new Error("ROLLBACK_LOCAL_RECONCILIATION");
    await expect(database.db.transaction(async (tx) => {
      const base = localOptions("success");
      const fixture = await createFailureFixture(tx, "content_publication", now);
      const fakes = createLocalGovernedEffectFakes({
        ...base,
        outcomes: {
          ...base.outcomes,
          content_publication: { kind: "ambiguous", safeCode: "MCP_LOCAL_FAKE_AMBIGUOUS", providerReference: "fake-post" },
        },
      });
      const sourceReader = new PostgresMcpGovernedEffectSourceReader(tx, () => now);
      await expect(sourceReader.read({ workspaceId: fixture.workspaceId, proposalId: fixture.proposalId, kind: "content_publication", aggregateId: fixture.aggregateId })).resolves.toMatchObject({ kind: "content_publication", accountId: "local-fake-account", text: "Local fake body" });
      const executor = new PostgresMcpGovernedEffectExecutor(tx as unknown as Database, fakes.adapters, sourceReader, () => now);
      const first = await processWorker(tx as unknown as Database, fixture, executor, fakes, () => ({ decision: "allow", code: "OK", factsVersion: 1 }));
      expect(first.result).toMatchObject({ outcome: "invalidated", code: "MCP_LOCAL_FAKE_AMBIGUOUS" });
      expect(fakes.counters.contentPublication).toBe(1);

      const reconciliation = await tx.select({ id: mcpEffectReconciliations.id, status: mcpEffectReconciliations.status })
        .from(mcpEffectReconciliations).where(and(eq(mcpEffectReconciliations.workspaceId, fixture.workspaceId), eq(mcpEffectReconciliations.proposalId, fixture.proposalId)));
      expect(reconciliation).toHaveLength(1);
      const providerPostId = fakes.outcomeFor("content_publication").providerReference;
      if (!providerPostId) throw new Error("MCP_LOCAL_FAKE_PROVIDER_REFERENCE_MISSING");
      let readOnlyCalls = 0;
      const readOnlyExecutor = new PostgresMcpGovernedEffectExecutor(tx as unknown as Database, {
        socialContentReader: {
          listOwnContent: async (input) => {
            readOnlyCalls += 1;
            expect(input.accountId).toBe("local-fake-account");
            expect(input.cursor).toBeNull();
            expect(input.limit).toBe(100);
            return {
              data: [{ providerPostId, socialId: null, authorProviderId: null, text: "authoritative fake content", url: null, publishedAt: now, observedAt: now }],
              nextCursor: null,
            };
          },
        },
      }, new PostgresMcpGovernedEffectSourceReader(tx, () => now), () => now);
      const reconciliationRepository = new PostgresMcpExternalEffectAttemptRepository(tx as unknown as Database, readOnlyExecutor, () => now);
      if (!reconciliationRepository.reconcileDue) throw new Error("RECONCILIATION_DUE_UNAVAILABLE");
      await expect(reconciliationRepository.reconcileDue({ workspaceId: fixture.workspaceId, now, limit: 1 })).resolves.toBe(1);
      await expect(reconciliationRepository.reconcileDue({ workspaceId: fixture.workspaceId, now, limit: 1 })).resolves.toBe(0);
      expect(readOnlyCalls).toBe(1);
      expect(fakes.counters.contentPublication).toBe(1);
      const final = await tx.select({ status: mcpEffectReconciliations.status, result: mcpEffectReconciliations.resultSnapshot })
        .from(mcpEffectReconciliations).where(eq(mcpEffectReconciliations.id, reconciliation[0]!.id));
      expect(final[0]).toMatchObject({ status: "matched", result: { socialId: null, url: null } });
      expect(final[0]?.result).not.toHaveProperty("providerPostId");
      const rawCriteria = await tx.select({ criteria: mcpEffectReconciliations.criteriaSnapshot })
        .from(mcpEffectReconciliations).where(eq(mcpEffectReconciliations.id, reconciliation[0]!.id));
      expect(rawCriteria[0]?.criteria).toMatchObject({ providerPostId });
      const publicRecord = await new PostgresMcpEffectReconciliationRepository(tx as unknown as Database).get({ workspaceId: fixture.workspaceId, reconciliationId: reconciliation[0]!.id });
      expect(publicRecord?.criteriaSnapshot).not.toHaveProperty("providerPostId");
      const [proposal] = await tx.select({ status: mcpEffectProposals.status }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, fixture.proposalId));
      const [intention] = await tx.select({ state: mcpEffectIntentions.state }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, fixture.intentionId));
      expect(proposal?.status).toBe("delivered");
      expect(intention?.state).toBe("completed");
      throw rollback;
    })).rejects.toBe(rollback);
  });
});

function localOptions(conversationOutcome: "success" | "ambiguous") {
  return {
    mode: "local-fake" as const,
    allowNetwork: false as const,
    outcomes: {
      conversation_reply: { kind: conversationOutcome, safeCode: conversationOutcome === "success" ? "MCP_LOCAL_FAKE_ACCEPTED" : "MCP_LOCAL_FAKE_AMBIGUOUS", providerReference: "fake-message" },
      content_publication: { kind: "success" as const, safeCode: "MCP_LOCAL_FAKE_ACCEPTED", providerReference: "fake-post" },
      meeting_proposal: { kind: "success" as const, safeCode: "MCP_LOCAL_FAKE_ACCEPTED", providerReference: "fake-booking" },
      campaign_activation: { kind: "failure" as const, safeCode: "ADAPTER_UNAVAILABLE" },
    },
    counters: { conversationReply: 0, contentPublication: 0, meetingProposal: 0, campaignActivation: 0 },
  };
}

async function processFixture(
  database: ReturnType<typeof createDatabase>,
  fixture: Fixture,
  executor: PostgresMcpGovernedEffectExecutor,
  fakes: ReturnType<typeof createLocalGovernedEffectFakes>,
  final?: () => { readonly decision: "allow" | "deny"; readonly code: "OK" | "CONTACT_SUPPRESSED"; readonly factsVersion: number },
  policy?: Pick<ExternalEffectPolicy, "final">,
) {
  return processWorker(database.db, fixture, executor, fakes, final, policy);
}

async function processWorker(
  database: Database,
  fixture: Fixture,
  executor: PostgresMcpGovernedEffectExecutor,
  fakes: ReturnType<typeof createLocalGovernedEffectFakes>,
  final?: () => { readonly decision: "allow" | "deny"; readonly code: "OK" | "CONTACT_SUPPRESSED"; readonly factsVersion: number },
  policy?: Pick<ExternalEffectPolicy, "final">,
) {
  const job = (await database.select().from(jobs).where(eq(jobs.id, fixture.jobId)).limit(1))[0]!;
  const acknowledgements: string[] = [];
  const finalPolicy = policy ?? { final: async () => {
    if (!final) throw new Error("MCP_LOCAL_FAKE_POLICY_MISSING");
    return final();
  } };
  const worker = new PostgresMcpGovernedEffectWorker(database, finalPolicy, {
    now: () => fixture.now,
    attemptPort: new PostgresMcpExternalEffectAttemptRepository(database, executor, () => fixture.now),
    executor: (input) => executor.execute(input),
    queue: { acknowledge: async (id) => { acknowledgements.push(id); } },
  });
  const result = await worker.process({ id: job.id, type: job.type, status: "running", workspaceId: fixture.workspaceId, payload: job.payload, lockedUntil: job.lockedUntil!, lockedBy: job.lockedBy! });
  return { result, acknowledgements: acknowledgements.length, counters: fakes.counters };
}

interface Fixture {
  readonly workspaceId: string;
  readonly contactId: string;
  readonly conversationId: string;
  readonly proposalId: string;
  readonly intentionId: string;
  readonly jobId: string;
  readonly kind: FailureKind;
  readonly aggregateId: string;
  readonly now: Date;
}

async function createConversationFixture(database: ReturnType<typeof createDatabase>, now: Date): Promise<Fixture> {
  const workspaceId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const proposalId = crypto.randomUUID();
  const approvalId = crypto.randomUUID();
  const intentionId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();
  const connectedAccountId = crypto.randomUUID();
  await database.db.insert(workspaces).values({ id: workspaceId, slug: `local-fake-${workspaceId}`, name: "Local fake fixture" });
  await database.db.insert(contacts).values({ id: contactId, workspaceId, firstName: "Local", lastName: "Fake", status: "active", source: "manual", createdAt: now, updatedAt: now });
  await database.db.insert(contactIdentities).values({ id: crypto.randomUUID(), workspaceId, contactId, type: "linkedin", value: "fake-recipient", normalizedValue: "fake-recipient", source: "manual", createdAt: now, updatedAt: now });
  await database.db.insert(connectedAccounts).values({ id: connectedAccountId, workspaceId, provider: "unipile", providerAccountId: "fake-account", displayName: "Local fake", status: "connected", capabilities: { linkedin: { messaging: true } }, quotas: { linkedin: { remaining: 5 } }, encryptedSecret: "local-fake-secret", lastCheckedAt: now, createdAt: now, updatedAt: now });
  await database.db.insert(conversations).values({ id: conversationId, workspaceId, contactId, connectedAccountId, provider: "unipile", providerAccountId: "fake-account", providerThreadId: `fake-thread-${conversationId}`, channel: "linkedin", status: "open", lastMessageAt: now, createdAt: now, updatedAt: now });
  await database.db.insert(mcpEffectProposals).values({
    id: proposalId, workspaceId, clientId: "local-fake-test", kind: "conversation_reply", requestKey: crypto.randomUUID(), inputHash: "a".repeat(64), aggregateId: conversationId,
    intentSnapshot: { kind: "conversation_reply", aggregateId: conversationId, body: "local fake body" },
    sourceSnapshot: { kind: "conversation_reply", aggregateId: conversationId, status: "open", sourceId: `conversation:${conversationId}`, sourceUpdatedAt: now.toISOString(), factsVersion: 1, revision: 1, sourceVersion: 1, suppressed: false, humanReplyAt: null },
    revision: 1, sourceVersion: 1, policyPreview: { decision: "allow", code: "OK", factsVersion: 1 }, policyFinal: null, status: "queued", version: 1, approvalItemId: null, jobId: null, correlationId, createdAt: now, updatedAt: now,
  });
  await database.db.insert(approvalItems).values({ id: approvalId, workspaceId, proposalId, itemType: "mcp_external_effect", channel: "mcp", contentOriginal: { kind: "conversation_reply", aggregateId: conversationId, body: "local fake body" }, context: { proposalId, kind: "conversation_reply", aggregateId: conversationId }, status: "approved", createdAt: now, updatedAt: now });
  await database.db.insert(jobs).values({ id: jobId, workspaceId, type: "mcp.external-effect.execute", payload: { workspaceId, proposalId, intentionId, kind: "conversation_reply", aggregateId: conversationId, correlationId }, idempotencyKey: `local-fake:${proposalId}`, correlationId, maxAttempts: 1, status: "running", attempts: 1, availableAt: now, lockedAt: now, lockedUntil: new Date(now.getTime() + 60_000), lockedBy: "local-fake-worker", createdAt: now, updatedAt: now });
  await database.db.insert(mcpEffectIntentions).values({ id: intentionId, workspaceId, proposalId, kind: "conversation_reply", aggregateId: conversationId, state: "queued", idempotencyKey: `local-fake:${proposalId}`, jobId, leaseToken: null, leaseExpiresAt: null, correlationId, createdAt: now, updatedAt: now });
  await database.db.update(mcpEffectProposals).set({ approvalItemId: approvalId, jobId }).where(eq(mcpEffectProposals.id, proposalId));
  return { workspaceId, contactId, conversationId, proposalId, intentionId, jobId, kind: "conversation_reply", aggregateId: conversationId, now };
}

type FailureKind = "conversation_reply" | "content_publication" | "meeting_proposal" | "campaign_activation";

function localOptionsForFailure(kind: FailureKind, code: string) {
  const base = localOptions("success");
  const failed = { kind: "failure" as const, safeCode: code, ...(kind === "campaign_activation" ? {} : { providerReference: `fake-${kind}` }) };
  return {
    ...base,
    outcomes: {
      ...base.outcomes,
      conversation_reply: kind === "conversation_reply" ? failed : base.outcomes.conversation_reply,
      content_publication: kind === "content_publication" ? failed : base.outcomes.content_publication,
      meeting_proposal: kind === "meeting_proposal" ? failed : base.outcomes.meeting_proposal,
      campaign_activation: kind === "campaign_activation" ? failed : base.outcomes.campaign_activation,
    },
  };
}

async function createFailureFixture(database: DatabaseExecutor, kind: FailureKind, now: Date): Promise<Fixture> {
  const workspaceId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const aggregateId = kind === "conversation_reply" ? conversationId : crypto.randomUUID();
  await database.insert(workspaces).values({ id: workspaceId, slug: `local-fake-${workspaceId}`, name: "Local failure fixture" });

  if (kind === "conversation_reply" || kind === "meeting_proposal") {
    await database.insert(contacts).values({ id: contactId, workspaceId, firstName: "Local", lastName: "Fake", status: "active", source: "manual", createdAt: now, updatedAt: now });
    if (kind === "conversation_reply") await database.insert(contactIdentities).values({ id: crypto.randomUUID(), workspaceId, contactId, type: "linkedin", value: "fake-recipient", normalizedValue: "fake-recipient", source: "manual", createdAt: now, updatedAt: now });
    await database.insert(conversations).values({ id: conversationId, workspaceId, contactId, provider: "unipile", providerAccountId: "local-fake-account", providerThreadId: `local-fake-thread-${conversationId}`, channel: "linkedin", status: "open", lastMessageAt: now, createdAt: now, updatedAt: now });
  }
  if (kind === "meeting_proposal") {
    await database.insert(meetingProposals).values({
      id: aggregateId, workspaceId, conversationId, contactId, status: "offered", timeZone: "UTC",
      slots: [{ start: "2026-08-31T13:00:00.000Z", end: "2026-08-31T13:30:00.000Z" }],
      idempotencyKey: `local-fake-meeting-${aggregateId}`, expiresAt: new Date("2026-08-31T14:00:00.000Z"), revision: 1, sourceVersion: 1, createdAt: now, updatedAt: now,
    });
  }
  if (kind === "content_publication") await createContentAggregate(database, workspaceId, aggregateId, now);
  if (kind === "campaign_activation") await createCampaignAggregate(database, workspaceId, aggregateId, now);

  const proposalId = crypto.randomUUID();
  const approvalId = crypto.randomUUID();
  const intentionId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();
  const intentSnapshot = kind === "meeting_proposal" ? { kind, aggregateId, slotPosition: 1 } : { kind, aggregateId, body: "local fake body" };
  const sourceSnapshot = { kind, aggregateId, status: kind === "meeting_proposal" ? "offered" : kind === "campaign_activation" ? "active" : kind === "content_publication" ? "scheduled" : "open", sourceId: `${kind}:${aggregateId}`, sourceUpdatedAt: now.toISOString(), factsVersion: 1, revision: 1, sourceVersion: 1, ...(kind === "conversation_reply" ? { suppressed: false, humanReplyAt: null } : {}) };
  await database.insert(mcpEffectProposals).values({
    id: proposalId, workspaceId, clientId: "local-fake-test", kind, requestKey: crypto.randomUUID(), inputHash: "f".repeat(64), aggregateId,
    intentSnapshot, sourceSnapshot, revision: 1, sourceVersion: 1, policyPreview: { decision: "allow", code: "OK", factsVersion: 1 }, policyFinal: null,
    status: "queued", version: 1, approvalItemId: null, jobId: null, correlationId, createdAt: now, updatedAt: now,
  });
  await database.insert(approvalItems).values({ id: approvalId, workspaceId, proposalId, itemType: "mcp_external_effect", channel: "mcp", contentOriginal: intentSnapshot, context: { proposalId, kind, aggregateId }, status: "approved", createdAt: now, updatedAt: now });
  await database.insert(jobs).values({ id: jobId, workspaceId, type: "mcp.external-effect.execute", payload: { workspaceId, proposalId, intentionId, kind, aggregateId, correlationId }, idempotencyKey: `local-fake:${proposalId}`, correlationId, maxAttempts: 1, status: "running", attempts: 1, availableAt: now, lockedAt: now, lockedUntil: new Date(now.getTime() + 60_000), lockedBy: "local-fake-worker", createdAt: now, updatedAt: now });
  await database.insert(mcpEffectIntentions).values({ id: intentionId, workspaceId, proposalId, kind, aggregateId, state: "queued", idempotencyKey: `local-fake:${proposalId}`, jobId, leaseToken: null, leaseExpiresAt: null, correlationId, createdAt: now, updatedAt: now });
  await database.update(mcpEffectProposals).set({ approvalItemId: approvalId, jobId }).where(eq(mcpEffectProposals.id, proposalId));
  return { workspaceId, contactId, conversationId, proposalId, intentionId, jobId, kind, aggregateId, now };
}

async function createContentAggregate(database: DatabaseExecutor, workspaceId: string, publicationId: string, now: Date): Promise<void> {
  const offerId = crypto.randomUUID();
  const offerVersionId = crypto.randomUUID();
  const icpId = crypto.randomUUID();
  const icpVersionId = crypto.randomUUID();
  const strategyId = crypto.randomUUID();
  const strategyVersionId = crypto.randomUUID();
  const ideaId = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  const generationRunId = crypto.randomUUID();
  const briefId = crypto.randomUUID();
  const assetVersionId = crypto.randomUUID();
  await database.insert(offers).values({ id: offerId, workspaceId, name: `Local fake offer ${offerId}`, status: "draft", currentVersion: 1, category: "saas", valueProposition: "Local", targetAudience: "Local" });
  await database.insert(offerVersions).values({ id: offerVersionId, workspaceId, offerId, version: 1, name: "Local fake offer", category: "saas", valueProposition: "Local", targetAudience: "Local", publishedAt: now });
  await database.insert(icps).values({ id: icpId, workspaceId, name: "Local fake ICP", currentVersion: 1 });
  await database.insert(icpVersions).values({ id: icpVersionId, workspaceId, icpId, version: 1, name: "Local fake ICP", confidence: "0.9000", criteria: {}, buyingCommittee: {}, problems: [], signals: [], exclusions: [], unknowns: [], unresolvedContradictions: [], blockedFindings: [], publishedAt: now });
  await database.insert(editorialStrategies).values({ id: strategyId, workspaceId, name: "Local fake strategy", offerId, offerVersionId, icpId, icpVersionId, status: "active", currentVersion: 1, draft: {}, provider: "fixture", model: "fixture", promptVersion: "v1" });
  await database.insert(editorialStrategyVersions).values({ id: strategyVersionId, workspaceId, strategyId, version: 1, offerVersionId, icpVersionId, snapshot: {}, provider: "fixture", model: "fixture", promptVersion: "v1", publishedAt: now });
  await database.insert(contentIdeas).values({ id: ideaId, workspaceId, strategyVersionId, status: "discovered", angle: "Local", rationale: "Local", audience: "Local", pillar: "Local", priority: 50, fingerprint: "f".repeat(64), freshnessUntil: new Date(now.getTime() + 86_400_000), firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now });
  await database.insert(contentAssets).values({ id: assetId, workspaceId, ideaId, type: "linkedin_text", status: "ready", latestVersion: 1, revision: 1, createdAt: now, updatedAt: now });
  await database.insert(contentGenerationRuns).values({ id: generationRunId, workspaceId, ideaId, assetId, strategyVersionId, status: "ready", stage: "completed", createdAt: now, updatedAt: now });
  await database.insert(contentBriefs).values({ id: briefId, workspaceId, runId: generationRunId, ideaId, strategyVersionId, snapshot: {}, evidenceSnapshot: {}, createdAt: now });
  await database.insert(contentAssetVersions).values({ id: assetVersionId, workspaceId, assetId, briefId, generationRunId, version: 1, body: "Local fake body", draft: {}, audit: {}, critique: {}, readiness: { ready: true }, ready: true, createdAt: now });
  await database.insert(contentPublications).values({ id: publicationId, workspaceId, assetId, assetVersionId, network: "linkedin", provider: "unipile", status: "scheduled", requestKey: `local-fake-publication-${publicationId}`, scheduledFor: now, contentSnapshot: { body: "Local fake body" }, policySnapshot: { policyVersion: "local-fake" }, accountSnapshot: { provider: "unipile", providerAccountId: "local-fake-account" }, createdAt: now, updatedAt: now });
}

async function createCampaignAggregate(database: DatabaseExecutor, workspaceId: string, campaignId: string, now: Date): Promise<void> {
  const icpId = crypto.randomUUID();
  const icpVersionId = crypto.randomUUID();
  await database.insert(icps).values({ id: icpId, workspaceId, name: "Local fake campaign ICP", currentVersion: 1 });
  await database.insert(icpVersions).values({ id: icpVersionId, workspaceId, icpId, version: 1, name: "Local fake campaign ICP", confidence: "0.9000", criteria: {}, buyingCommittee: {}, problems: [], signals: [], exclusions: [], unknowns: [], unresolvedContradictions: [], blockedFindings: [], publishedAt: now });
  await database.insert(campaigns).values({ id: campaignId, workspaceId, name: "Local fake campaign", status: "active", icpVersionId, channel: "linkedin", sequenceId: crypto.randomUUID(), autopilotPolicy: {}, automationStage: "active", createdAt: now, updatedAt: now });
}

async function cleanupFixture(database: ReturnType<typeof createDatabase>, workspaceId: string): Promise<void> {
  await database.client`delete from mcp_effect_traces where workspace_id = ${workspaceId}`;
  await database.client`update mcp_effect_proposals set approval_item_id = null, reconciliation_id = null, job_id = null where workspace_id = ${workspaceId}`;
  await database.client`delete from mcp_effect_reconciliations where workspace_id = ${workspaceId}`;
  await database.client`delete from approval_items where workspace_id = ${workspaceId}`;
  await database.client`delete from mcp_effect_intentions where workspace_id = ${workspaceId}`;
  await database.client`delete from mcp_effect_proposals where workspace_id = ${workspaceId}`;
  await database.client`delete from jobs where workspace_id = ${workspaceId}`;
  await database.client`delete from conversations where workspace_id = ${workspaceId}`;
  await database.client`delete from connected_accounts where workspace_id = ${workspaceId}`;
  await database.client`delete from contacts where workspace_id = ${workspaceId}`;
  await database.client`delete from workspaces where id = ${workspaceId}`;
}
