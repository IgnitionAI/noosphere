import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase, type DatabaseExecutor, type Database } from "@outbound/infrastructure/database/client";
import { ExternalEffectPolicy } from "@outbound/application/mcp/external-effect-policy";
import {
  approvalItems,
  contactSuppressions,
  contentAssetVersions,
  contentAssets,
  contentBriefs,
  contentGenerationRuns,
  contentIdeas,
  contentPublications,
  contactIdentities,
  contacts,
  conversations,
  editorialStrategies,
  editorialStrategyVersions,
  jobs,
  mcpEffectIntentions,
  mcpEffectProposals,
  mcpEffectReconciliations,
  mcpEffectTraces,
  meetingProposals,
  messages,
  icpVersions,
  icps,
  offerVersions,
  offers,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import type { ExternalEffectAttemptIdentity, ExternalEffectReadOnlyResult } from "@outbound/application/mcp/external-effect-attempt";
import { PostgresMcpExternalEffectAttemptRepository } from "@outbound/infrastructure/mcp/postgres-mcp-effect-attempt-repository";
import { PostgresMcpGovernedEffectWorker } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-worker";
import { PostgresMcpGovernedEffectExecutor, PostgresMcpGovernedEffectSourceReader } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-executor";
import { PostgresExternalEffectFactsReader } from "@outbound/infrastructure/mcp/postgres-external-effect-facts-reader";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("durable governed-effect attempt boundary", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const now = new Date("2026-08-29T12:00:00.000Z");

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values({ id: workspaceId, slug: `attempt-${workspaceId}`, name: "Attempt fixture" });
    await database.db.insert(contacts).values({
      id: contactId, workspaceId, firstName: "Attempt", lastName: "Fixture", status: "active", source: "manual", createdAt: now, updatedAt: now,
    });
    await database.db.insert(contactIdentities).values({
      id: crypto.randomUUID(), workspaceId, contactId, type: "linkedin", value: "provider-person", normalizedValue: "provider-person", source: "manual", createdAt: now, updatedAt: now,
    });
    await database.db.insert(conversations).values({
      id: conversationId, workspaceId, contactId, provider: "unipile", providerAccountId: "fixture-account",
      providerThreadId: `thread-${conversationId}`, channel: "linkedin", status: "open", lastMessageAt: now, createdAt: now, updatedAt: now,
    });
  });

  afterAll(async () => {
    try {
      await database.client`delete from mcp_effect_traces where workspace_id = ${workspaceId}`;
      await database.client`update mcp_effect_proposals set approval_item_id = null, reconciliation_id = null, job_id = null where workspace_id = ${workspaceId}`;
      await database.client`delete from mcp_effect_reconciliations where workspace_id = ${workspaceId}`;
      await database.client`delete from approval_items where workspace_id = ${workspaceId}`;
      await database.client`delete from mcp_effect_intentions where workspace_id = ${workspaceId}`;
      await database.client`delete from jobs where workspace_id = ${workspaceId}`;
      await database.client`delete from mcp_effect_proposals where workspace_id = ${workspaceId}`;
      await database.client`delete from meeting_proposals where workspace_id = ${workspaceId}`;
      await database.client`delete from contact_suppressions where workspace_id = ${workspaceId}`;
      await database.client`delete from conversations where workspace_id = ${workspaceId}`;
      await database.client`delete from contacts where workspace_id = ${workspaceId}`;
      await database.client`delete from workspaces where id = ${workspaceId}`;
    } finally {
      await database.close();
    }
  });

  async function fixture(options: { readonly expired?: boolean; readonly kind?: "conversation_reply" | "meeting_proposal" } = {}): Promise<ExternalEffectAttemptIdentity> {
    const kind = options.kind ?? "conversation_reply";
    const aggregateId = kind === "meeting_proposal" ? crypto.randomUUID() : conversationId;
    if (kind === "meeting_proposal") {
      const meetingConversationId = crypto.randomUUID();
      const meetingExpiresAt = options.expired ? now : new Date(now.getTime() + 60_000);
      await database.db.insert(conversations).values({
        id: meetingConversationId, workspaceId, contactId, provider: "unipile", providerAccountId: "fixture-account",
        providerThreadId: `thread-${meetingConversationId}`, channel: "linkedin", status: "open", lastMessageAt: now, createdAt: now, updatedAt: now,
      });
      await database.db.insert(meetingProposals).values({
        id: aggregateId, workspaceId, conversationId: meetingConversationId, contactId, status: "offered", timeZone: "UTC",
        slots: [{ start: "2026-08-29T13:00:00.000Z", end: "2026-08-29T13:30:00.000Z" }],
        idempotencyKey: `attempt-meeting-${aggregateId}`, expiresAt: meetingExpiresAt, revision: 1, sourceVersion: 1, createdAt: now, updatedAt: now,
      });
    }
    const proposalId = crypto.randomUUID();
    const approvalId = kind === "meeting_proposal" ? crypto.randomUUID() : null;
    const intentionId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const leaseToken = crypto.randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + (options.expired ? -1 : 60_000));
    await database.db.insert(mcpEffectProposals).values({
      id: proposalId, workspaceId, clientId: "attempt-test", kind, requestKey: crypto.randomUUID(), inputHash: "a".repeat(64), aggregateId,
      intentSnapshot: kind === "meeting_proposal" ? { kind, aggregateId, slotPosition: 1 } : { kind, aggregateId, body: "bounded" },
      sourceSnapshot: kind === "meeting_proposal"
        ? { kind, aggregateId, status: "offered", sourceId: "meeting:fixture", sourceUpdatedAt: now.toISOString(), factsVersion: 1, revision: 1, sourceVersion: 1, slotPosition: 1, slotStart: "2026-08-29T13:00:00.000Z", slotEnd: "2026-08-29T13:30:00.000Z", timeZone: "UTC", expiresAt: new Date(now.getTime() + (options.expired ? 0 : 60_000)).toISOString() }
        : { kind, aggregateId, status: "open", sourceId: "conversation:fixture", sourceUpdatedAt: now.toISOString(), factsVersion: 1, revision: 1, sourceVersion: 1, suppressed: false, humanReplyAt: null },
      revision: 1, sourceVersion: 1, policyPreview: { decision: "allow", code: "OK", factsVersion: 1 }, policyFinal: { decision: "allow", code: "OK", factsVersion: 1 },
      status: "accepted", version: 2, approvalItemId: null, jobId: null, correlationId, createdAt: now, updatedAt: now,
    });
    if (approvalId) {
      await database.db.insert(approvalItems).values({
        id: approvalId, workspaceId, proposalId, itemType: "mcp_external_effect", channel: "mcp",
        contentOriginal: { kind, aggregateId, slotPosition: 1 }, context: { proposalId, kind, aggregateId }, status: "approved", createdAt: now, updatedAt: now,
      });
      await database.db.update(mcpEffectProposals).set({ approvalItemId: approvalId }).where(eq(mcpEffectProposals.id, proposalId));
    }
    await database.db.insert(jobs).values({
      id: jobId, workspaceId, type: "mcp.external-effect.execute", payload: { workspaceId, proposalId, intentionId, kind, aggregateId, correlationId },
      idempotencyKey: `attempt:${proposalId}`, correlationId, maxAttempts: 5, status: "running", attempts: 1, availableAt: now, lockedAt: now,
      lockedUntil: new Date(now.getTime() + 60_000), lockedBy: "attempt-worker", createdAt: now, updatedAt: now,
    });
    await database.db.insert(mcpEffectIntentions).values({
      id: intentionId, workspaceId, proposalId, kind, aggregateId, state: "started", idempotencyKey: `attempt:${proposalId}`,
      jobId, leaseToken, leaseExpiresAt, correlationId, createdAt: now, updatedAt: now,
    });
    return { workspaceId, proposalId, intentionId, jobId, kind, aggregateId, correlationId, leaseToken, leaseExpiresAt };
  }

  async function queuedWorkerFixture() {
    const proposalId = crypto.randomUUID();
    const approvalId = crypto.randomUUID();
    const intentionId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    await database.db.insert(mcpEffectProposals).values({
      id: proposalId, workspaceId, clientId: "attempt-worker-test", kind: "conversation_reply", requestKey: crypto.randomUUID(), inputHash: "b".repeat(64), aggregateId: conversationId,
      intentSnapshot: { kind: "conversation_reply", aggregateId: conversationId, body: "bounded" },
      sourceSnapshot: { kind: "conversation_reply", aggregateId: conversationId, status: "open", sourceId: "conversation:fixture", sourceUpdatedAt: now.toISOString(), factsVersion: 2, revision: 1, sourceVersion: 1, suppressed: false, humanReplyAt: null },
      revision: 1, sourceVersion: 1, policyPreview: { decision: "allow", code: "OK", factsVersion: 2 }, policyFinal: null,
      status: "queued", version: 2, approvalItemId: null, jobId: null, correlationId, createdAt: now, updatedAt: now,
    });
    await database.db.insert(approvalItems).values({
      id: approvalId, workspaceId, proposalId, itemType: "mcp_external_effect", channel: "mcp", contentOriginal: { kind: "conversation_reply", aggregateId: conversationId, body: "bounded" },
      context: { proposalId, kind: "conversation_reply", aggregateId: conversationId }, status: "approved", createdAt: now, updatedAt: now,
    });
    await database.db.insert(jobs).values({
      id: jobId, workspaceId, type: "mcp.external-effect.execute", payload: { workspaceId, proposalId, intentionId, kind: "conversation_reply", aggregateId: conversationId, correlationId },
      idempotencyKey: `attempt-worker:${proposalId}`, correlationId, maxAttempts: 5, status: "running", attempts: 1, availableAt: now, lockedAt: now,
      lockedUntil: new Date(now.getTime() + 60_000), lockedBy: "attempt-worker", createdAt: now, updatedAt: now,
    });
    await database.db.insert(mcpEffectIntentions).values({
      id: intentionId, workspaceId, proposalId, kind: "conversation_reply", aggregateId: conversationId, state: "queued", idempotencyKey: `attempt-worker:${proposalId}`,
      jobId, correlationId, createdAt: now, updatedAt: now,
    });
    await database.db.update(mcpEffectProposals).set({ approvalItemId: approvalId, jobId }).where(and(eq(mcpEffectProposals.workspaceId, workspaceId), eq(mcpEffectProposals.id, proposalId)));
    return { proposalId, intentionId, jobId };
  }

  async function contentWorkerFixture(target: DatabaseExecutor = database.db) {
    const ids = {
      offer: crypto.randomUUID(), offerVersion: crypto.randomUUID(), icp: crypto.randomUUID(), icpVersion: crypto.randomUUID(),
      strategy: crypto.randomUUID(), strategyVersion: crypto.randomUUID(), idea: crypto.randomUUID(), asset: crypto.randomUUID(),
      run: crypto.randomUUID(), brief: crypto.randomUUID(), assetVersion: crypto.randomUUID(), publication: crypto.randomUUID(),
      proposal: crypto.randomUUID(), approval: crypto.randomUUID(), intention: crypto.randomUUID(), job: crypto.randomUUID(), correlation: crypto.randomUUID(),
    };
    await target.insert(offers).values({ id: ids.offer, workspaceId, name: `Attempt content offer ${ids.offer}`, status: "draft", currentVersion: 1, category: "saas", valueProposition: "Proof", targetAudience: "Operators" });
    await target.insert(offerVersions).values({ id: ids.offerVersion, workspaceId, offerId: ids.offer, version: 1, name: "Attempt content offer", category: "saas", valueProposition: "Proof", targetAudience: "Operators", publishedAt: now });
    await target.insert(icps).values({ id: ids.icp, workspaceId, name: "Attempt content ICP", currentVersion: 1 });
    await target.insert(icpVersions).values({ id: ids.icpVersion, workspaceId, icpId: ids.icp, version: 1, name: "Attempt content ICP", confidence: "0.9000", criteria: {}, buyingCommittee: {}, problems: [], signals: [], exclusions: [], unknowns: [], unresolvedContradictions: [], blockedFindings: [], publishedAt: now });
    await target.insert(editorialStrategies).values({ id: ids.strategy, workspaceId, name: `Attempt strategy ${ids.strategy}`, offerId: ids.offer, offerVersionId: ids.offerVersion, icpId: ids.icp, icpVersionId: ids.icpVersion, status: "active", currentVersion: 1, draft: {}, provider: "fixture", model: "fixture", promptVersion: "v1" });
    await target.insert(editorialStrategyVersions).values({ id: ids.strategyVersion, workspaceId, strategyId: ids.strategy, version: 1, offerVersionId: ids.offerVersion, icpVersionId: ids.icpVersion, snapshot: {}, provider: "fixture", model: "fixture", promptVersion: "v1", publishedAt: now });
    await target.insert(contentIdeas).values({ id: ids.idea, workspaceId, strategyVersionId: ids.strategyVersion, status: "discovered", angle: "Attempt angle", rationale: "Attempt rationale", audience: "Operators", pillar: "Proof", priority: 80, fingerprint: `${ids.idea.replaceAll("-", "")}00000000000000000000000000000000`, freshnessUntil: new Date(now.getTime() + 86_400_000), firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now });
    await target.insert(contentAssets).values({ id: ids.asset, workspaceId, ideaId: ids.idea, type: "linkedin_text", status: "ready", latestVersion: 1, revision: 1, createdAt: now, updatedAt: now });
    await target.insert(contentGenerationRuns).values({ id: ids.run, workspaceId, ideaId: ids.idea, assetId: ids.asset, strategyVersionId: ids.strategyVersion, status: "ready", stage: "completed", createdAt: now, updatedAt: now });
    await target.insert(contentBriefs).values({ id: ids.brief, workspaceId, runId: ids.run, ideaId: ids.idea, strategyVersionId: ids.strategyVersion, snapshot: {}, evidenceSnapshot: {}, createdAt: now });
    await target.insert(contentAssetVersions).values({ id: ids.assetVersion, workspaceId, assetId: ids.asset, briefId: ids.brief, generationRunId: ids.run, version: 1, body: "Attempt content body", draft: {}, audit: {}, critique: {}, readiness: { ready: true }, ready: true, createdAt: now });
    await target.insert(contentPublications).values({ id: ids.publication, workspaceId, assetId: ids.asset, assetVersionId: ids.assetVersion, network: "linkedin", provider: "unipile", status: "scheduled", requestKey: `attempt-publication-${ids.publication}`, scheduledFor: now, contentSnapshot: { body: "Attempt content body" }, policySnapshot: { policyVersion: "attempt-v1" }, accountSnapshot: { provider: "unipile", providerAccountId: "content-attempt-account" }, createdAt: now, updatedAt: now });
    await target.insert(mcpEffectProposals).values({
      id: ids.proposal, workspaceId, clientId: "attempt-content", kind: "content_publication", requestKey: crypto.randomUUID(), inputHash: "c".repeat(64), aggregateId: ids.publication,
      intentSnapshot: { kind: "content_publication", aggregateId: ids.publication }, sourceSnapshot: { kind: "content_publication", aggregateId: ids.publication, status: "scheduled", revision: 1, sourceVersion: 1, factsVersion: 1 },
      revision: 1, sourceVersion: 1, policyPreview: { decision: "allow", code: "OK", factsVersion: 1 }, policyFinal: null, status: "queued", version: 2,
      approvalItemId: null, jobId: null, correlationId: ids.correlation, createdAt: now, updatedAt: now,
    });
    await target.insert(approvalItems).values({ id: ids.approval, workspaceId, proposalId: ids.proposal, itemType: "mcp_external_effect", channel: "mcp", contentOriginal: { kind: "content_publication", aggregateId: ids.publication }, context: { proposalId: ids.proposal, kind: "content_publication", aggregateId: ids.publication }, status: "approved", createdAt: now, updatedAt: now });
    await target.insert(jobs).values({ id: ids.job, workspaceId, type: "mcp.external-effect.execute", payload: { workspaceId, proposalId: ids.proposal, intentionId: ids.intention, kind: "content_publication", aggregateId: ids.publication, correlationId: ids.correlation }, idempotencyKey: `attempt-content-job-${ids.job}`, correlationId: ids.correlation, maxAttempts: 5, status: "running", attempts: 1, availableAt: now, lockedAt: now, lockedUntil: new Date(now.getTime() + 60_000), lockedBy: "attempt-content-worker", createdAt: now, updatedAt: now });
    await target.insert(mcpEffectIntentions).values({ id: ids.intention, workspaceId, proposalId: ids.proposal, kind: "content_publication", aggregateId: ids.publication, state: "queued", idempotencyKey: `attempt-content-job-${ids.job}`, jobId: ids.job, correlationId: ids.correlation, createdAt: now, updatedAt: now });
    await target.update(mcpEffectProposals).set({ approvalItemId: ids.approval, jobId: ids.job }).where(eq(mcpEffectProposals.id, ids.proposal));
    return { identity: { workspaceId, proposalId: ids.proposal, intentionId: ids.intention, jobId: ids.job, kind: "content_publication" as const, aggregateId: ids.publication, correlationId: ids.correlation, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(now.getTime() + 60_000) }, publicationId: ids.publication };
  }

  test("commits the started trace before an authoritative outcome and replays it", async () => {
    const identity = await fixture();
    const repository = new PostgresMcpExternalEffectAttemptRepository(database.db, undefined, () => now);
    const marker = await repository.recordBeforeProvider(identity);
    const markerTrace = await database.db.select().from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, identity.proposalId), eq(mcpEffectTraces.stage, "attempt"))).orderBy(asc(mcpEffectTraces.sequence));
    expect(markerTrace).toHaveLength(1);
    expect(marker).toMatchObject({ state: "started", attempt: 1, sequence: 1 });
    const outcome = await repository.recordOutcome({ ...identity, outcome: "delivered", authoritative: true, result: { providerId: "reference-only", accepted: true } });
    expect(outcome).toMatchObject({ state: "completed", proposalStatus: "delivered" });
    const replay = await repository.recordOutcome({ ...identity, outcome: "delivered", authoritative: true, result: { accepted: true, providerId: "reference-only" } });
    expect(replay).toEqual(outcome);
    await database.db.update(jobs).set({ status: "completed", lockedBy: null, lockedUntil: null }).where(eq(jobs.id, identity.jobId));
    await expect(repository.recordOutcome({ ...identity, outcome: "delivered", authoritative: true, result: { accepted: true, providerId: "reference-only" } })).resolves.toEqual(outcome);
    const traces = await database.db.select().from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, identity.proposalId))).orderBy(asc(mcpEffectTraces.sequence));
    const [beforeProposal] = await database.db.select({ status: mcpEffectProposals.status, version: mcpEffectProposals.version }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, identity.proposalId));
    const [beforeIntention] = await database.db.select({ state: mcpEffectIntentions.state }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, identity.intentionId));
    await expect(repository.recordOutcome({ ...identity, outcome: "delivered", authoritative: true, result: { accepted: false, providerId: "reference-only" }, sourceEventId: outcome.sourceEventId, idempotencyKey: outcome.idempotencyKey })).rejects.toMatchObject({ code: "MCP_EFFECT_OUTCOME_REPLAY_CONFLICT" });
    const [afterProposal] = await database.db.select({ status: mcpEffectProposals.status, version: mcpEffectProposals.version }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, identity.proposalId));
    const [afterIntention] = await database.db.select({ state: mcpEffectIntentions.state }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, identity.intentionId));
    const afterTraces = await database.db.select().from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, identity.proposalId))).orderBy(asc(mcpEffectTraces.sequence));
    expect(traces.filter((trace) => trace.stage === "attempt")).toHaveLength(1);
    expect(traces.filter((trace) => trace.stage === "result")).toHaveLength(1);
    expect(afterProposal).toEqual(beforeProposal);
    expect(afterIntention).toEqual(beforeIntention);
    expect(afterTraces).toEqual(traces);
    expect(JSON.stringify(traces)).not.toContain("secret");
  });

  test("integrates claim, marker, fail-closed adapter outcome, and queue acknowledgement", async () => {
    const value = await queuedWorkerFixture();
    const calls: string[] = [];
    const worker = new PostgresMcpGovernedEffectWorker(database.db, { final: async () => ({ decision: "allow", code: "OK", factsVersion: 2 }) }, {
      now: () => now,
      attemptPort: new PostgresMcpExternalEffectAttemptRepository(database.db, undefined, () => now),
      queue: { acknowledge: async () => { calls.push("ack"); } },
    });
    const job = (await database.db.select().from(jobs).where(eq(jobs.id, value.jobId)).limit(1))[0]!;
    const result = await worker.process({ id: job.id, type: job.type, status: "running", workspaceId, payload: job.payload, lockedUntil: job.lockedUntil!, lockedBy: job.lockedBy! });
    expect(result).toMatchObject({ outcome: "invalidated", code: "ADAPTER_UNAVAILABLE" });
    expect(calls).toEqual(["ack"]);
    const traces = await database.db.select({ stage: mcpEffectTraces.stage, eventType: mcpEffectTraces.eventType }).from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, value.proposalId))).orderBy(asc(mcpEffectTraces.sequence));
    expect(traces.map((trace) => trace.stage)).toEqual(["policy", "attempt", "result"]);
    const [intention] = await database.db.select({ state: mcpEffectIntentions.state }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, value.intentionId));
    expect(intention?.state).toBe("completed");
  });

  test("uses fresh PostgreSQL suppression and human-reply facts to block provider execution", async () => {
    const suppressionId = crypto.randomUUID();
    const suppressed = await queuedWorkerFixture();
    await database.db.insert(contactSuppressions).values({ id: suppressionId, workspaceId, contactId, channel: "global", reason: "opt_out", createdAt: now });
    let providerCalls = 0;
    let acknowledgements = 0;
    const policy = new ExternalEffectPolicy(new PostgresExternalEffectFactsReader(database.db, () => now));
    const blockedWorker = new PostgresMcpGovernedEffectWorker(database.db, policy, {
      now: () => now,
      executor: async () => { providerCalls += 1; return { outcome: "delivered" as const, authoritative: true, code: "DELIVERED" }; },
      queue: { acknowledge: async () => { acknowledgements += 1; } },
    });
    const suppressedJob = (await database.db.select().from(jobs).where(eq(jobs.id, suppressed.jobId)).limit(1))[0]!;
    const suppressedResult = await blockedWorker.process({ id: suppressedJob.id, type: suppressedJob.type, status: "running", workspaceId, payload: suppressedJob.payload, lockedUntil: suppressedJob.lockedUntil!, lockedBy: suppressedJob.lockedBy! });
    expect(suppressedResult).toMatchObject({ outcome: "policy_denied", code: "CONTACT_SUPPRESSED" });
    expect(providerCalls).toBe(0);
    expect(acknowledgements).toBe(1);

    await database.db.delete(contactSuppressions).where(eq(contactSuppressions.id, suppressionId));
    const replied = await queuedWorkerFixture();
    await database.db.insert(messages).values({ id: crypto.randomUUID(), workspaceId, conversationId, providerMessageId: `attempt-reply-${replied.proposalId}`, direction: "inbound", senderType: "contact", body: "private reply", receivedAt: now, createdAt: now });
    const repliedJob = (await database.db.select().from(jobs).where(eq(jobs.id, replied.jobId)).limit(1))[0]!;
    const repliedResult = await blockedWorker.process({ id: repliedJob.id, type: repliedJob.type, status: "running", workspaceId, payload: repliedJob.payload, lockedUntil: repliedJob.lockedUntil!, lockedBy: repliedJob.lockedBy! });
    expect(repliedResult).toMatchObject({ outcome: "policy_denied", code: "HUMAN_REPLY_ARRIVED" });
    expect(providerCalls).toBe(0);
    expect(acknowledgements).toBe(2);
  });

  test("loads the tenant-bound source from PostgreSQL before calling a fake provider", async () => {
    const identity = await fixture();
    const marker = {
      ...identity,
      state: "started" as const,
      attempt: 1,
      sequence: 1,
      sourceEventId: crypto.randomUUID(),
      idempotencyKey: `attempt:${identity.intentionId}`,
    };
    let calls = 0;
    const executor = new PostgresMcpGovernedEffectExecutor(database.db, {
      outbound: {
        send: async (request) => {
          calls += 1;
          expect(request).toMatchObject({
            accountId: "fixture-account",
            channel: "linkedin",
            conversationId: `thread-${conversationId}`,
            body: "bounded",
            idempotencyKey: marker.idempotencyKey,
          });
          return { providerRequestId: "fixture-request", conversationId: `thread-${conversationId}` };
        },
      },
    });
    await expect(executor.execute({ identity, marker })).resolves.toMatchObject({ outcome: "delivered", authoritative: true, result: { providerRequestId: "fixture-request" } });
    expect(calls).toBe(1);
  });

  test("runs an offered meeting through the real worker, durable marker, fake provider, and outcome", async () => {
    const identity = await fixture({ kind: "meeting_proposal" });
    await database.db.update(mcpEffectProposals).set({ status: "queued", policyFinal: null }).where(eq(mcpEffectProposals.id, identity.proposalId));
    await database.db.update(mcpEffectIntentions).set({ state: "queued", leaseToken: null, leaseExpiresAt: null }).where(eq(mcpEffectIntentions.id, identity.intentionId));
    const [job] = await database.db.select().from(jobs).where(eq(jobs.id, identity.jobId));
    let providerCalls = 0;
    let acknowledgements = 0;
    const executor = new PostgresMcpGovernedEffectExecutor(database.db, {
      calendar: {
        resolve: async () => null,
        schedulingContext: async () => ({ status: "ready", bookingUrl: null, timeZone: "UTC", canBook: true, slots: [] }),
        book: async (input) => {
          providerCalls += 1;
          expect(input).toMatchObject({ workspaceId, contactId, start: "2026-08-29T13:00:00.000Z" });
          return { bookingId: "fixture-booking", start: input.start, end: "2026-08-29T13:30:00.000Z", meetingUrl: "https://example.test/meeting", label: "Fixture meeting" };
        },
        reschedule: async () => { throw new Error("not used"); },
        cancel: async () => { throw new Error("not used"); },
      },
    }, undefined, () => now);
    const worker = new PostgresMcpGovernedEffectWorker(database.db, { final: async () => ({ decision: "allow", code: "OK", factsVersion: 2 }) }, {
      now: () => now,
      attemptPort: new PostgresMcpExternalEffectAttemptRepository(database.db, executor, () => now),
      executor: (input) => executor.execute(input),
      queue: { acknowledge: async () => { acknowledgements += 1; } },
    });
    const result = await worker.process({ id: job!.id, type: job!.type, status: "running", workspaceId, payload: job!.payload, lockedUntil: job!.lockedUntil!, lockedBy: job!.lockedBy! });
    expect(result).toMatchObject({ outcome: "already_completed", code: "DELIVERED" });
    expect(providerCalls).toBe(1);
    expect(acknowledgements).toBe(1);
    const [proposal] = await database.db.select({ status: mcpEffectProposals.status }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, identity.proposalId));
    const [intention] = await database.db.select({ state: mcpEffectIntentions.state }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, identity.intentionId));
    const traces = await database.db.select({ stage: mcpEffectTraces.stage }).from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, identity.proposalId))).orderBy(asc(mcpEffectTraces.sequence));
    expect(proposal?.status).toBe("delivered");
    expect(intention?.state).toBe("completed");
    expect(traces.map((trace) => trace.stage)).toEqual(["policy", "attempt", "result"]);
  });

  test("rejects a meeting intent slot that differs from the offered authoritative slot", async () => {
    const identity = await fixture({ kind: "meeting_proposal" });
    await database.db.update(mcpEffectProposals).set({
      intentSnapshot: { kind: "meeting_proposal", aggregateId: identity.aggregateId, slotPosition: 1, slotStart: "2026-08-29T14:00:00.000Z" },
    }).where(eq(mcpEffectProposals.id, identity.proposalId));
    const source = await new PostgresMcpGovernedEffectSourceReader(database.db).read({
      workspaceId, proposalId: identity.proposalId, kind: "meeting_proposal", aggregateId: identity.aggregateId,
    });
    expect(source).toBeNull();
  });

  test("invalidates an offered meeting at its exact expiry before policy or provider", async () => {
    const identity = await fixture({ kind: "meeting_proposal", expired: true });
    await database.db.update(mcpEffectProposals).set({ status: "queued", policyFinal: null }).where(eq(mcpEffectProposals.id, identity.proposalId));
    await database.db.update(mcpEffectIntentions).set({ state: "queued", leaseToken: null, leaseExpiresAt: null }).where(eq(mcpEffectIntentions.id, identity.intentionId));
    const [job] = await database.db.select().from(jobs).where(eq(jobs.id, identity.jobId));
    let policyCalls = 0;
    let providerCalls = 0;
    let acknowledgements = 0;
    const worker = new PostgresMcpGovernedEffectWorker(database.db, { final: async () => { policyCalls += 1; return { decision: "allow", code: "OK", factsVersion: 2 }; } }, {
      now: () => now,
      executor: async () => { providerCalls += 1; return { outcome: "delivered" as const, authoritative: true, code: "DELIVERED" }; },
      queue: { acknowledge: async () => { acknowledgements += 1; } },
    });
    await expect(worker.process({ id: job!.id, type: job!.type, status: "running", workspaceId, payload: job!.payload, lockedUntil: job!.lockedUntil!, lockedBy: job!.lockedBy! })).resolves.toMatchObject({ outcome: "invalidated", code: "SOURCE_STALE" });
    expect(policyCalls).toBe(0);
    expect(providerCalls).toBe(0);
    expect(acknowledgements).toBe(1);
    const [proposal] = await database.db.select({ status: mcpEffectProposals.status }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, identity.proposalId));
    const [intention] = await database.db.select({ state: mcpEffectIntentions.state }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, identity.intentionId));
    expect(proposal?.status).toBe("invalidated");
    expect(intention?.state).toBe("completed");
  });

  test("runs text-only content through the real worker and replays without a second publish", async () => {
    const rollback = new Error("ROLLBACK_CONTENT_EXECUTION");
    await expect(database.db.transaction(async (tx) => {
      const fixtureValue = await contentWorkerFixture(tx);
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, fixtureValue.identity.jobId));
      let providerCalls = 0;
      let acknowledgements = 0;
      const runtimeDatabase = tx as unknown as Database;
      const executor = new PostgresMcpGovernedEffectExecutor(runtimeDatabase, {
        publisher: {
          observeCapabilities: async () => ({ network: "linkedin", accountId: "content-attempt-account", accountHealthy: true, textPublishing: "available" as const, observedAt: now }),
          publishText: async (input) => {
            providerCalls += 1;
            expect(input).toEqual({ accountId: "content-attempt-account", text: "Attempt content body", requestKey: `mcp-effect:${fixtureValue.identity.intentionId}:attempt:v1` });
            return { providerPostId: "attempt-post", socialId: "attempt-social", url: "https://example.test/attempt-post", publishedAt: now };
          },
        },
      }, undefined, () => now);
      const worker = new PostgresMcpGovernedEffectWorker(runtimeDatabase, { final: async () => ({ decision: "allow", code: "OK", factsVersion: 2 }) }, {
        now: () => now,
        attemptPort: new PostgresMcpExternalEffectAttemptRepository(runtimeDatabase, executor, () => now),
        executor: (input) => executor.execute(input),
        queue: { acknowledge: async () => { acknowledgements += 1; } },
      });
      const leasedJob = { id: job!.id, type: job!.type, status: "running", workspaceId, payload: job!.payload, lockedUntil: job!.lockedUntil!, lockedBy: job!.lockedBy! };
      await expect(worker.process(leasedJob)).resolves.toMatchObject({ outcome: "already_completed", code: "DELIVERED" });
      await expect(worker.process(leasedJob)).resolves.toMatchObject({ outcome: "already_completed", code: "MCP_EFFECT_ALREADY_COMPLETED" });
      expect(providerCalls).toBe(1);
      expect(acknowledgements).toBe(2);
      const [proposal] = await tx.select({ status: mcpEffectProposals.status }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, fixtureValue.identity.proposalId));
      const [intention] = await tx.select({ state: mcpEffectIntentions.state }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, fixtureValue.identity.intentionId));
      const traces = await tx.select({ stage: mcpEffectTraces.stage, eventType: mcpEffectTraces.eventType }).from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, fixtureValue.identity.proposalId))).orderBy(asc(mcpEffectTraces.sequence));
      expect(proposal?.status).toBe("delivered");
      expect(intention?.state).toBe("completed");
      expect(traces.map((trace) => trace.stage)).toEqual(["policy", "attempt", "result"]);
      throw rollback;
    })).rejects.toThrow("ROLLBACK_CONTENT_EXECUTION");
  });

  test("blocks a cancelled content publication before provider execution", async () => {
    const rollback = new Error("ROLLBACK_CANCELLED_CONTENT");
    await expect(database.db.transaction(async (tx) => {
      const fixtureValue = await contentWorkerFixture(tx);
      await tx.update(contentPublications).set({ status: "cancelled", cancelledAt: now }).where(eq(contentPublications.id, fixtureValue.publicationId));
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, fixtureValue.identity.jobId));
      let providerCalls = 0;
      let acknowledgements = 0;
      const worker = new PostgresMcpGovernedEffectWorker(tx as unknown as Database, { final: async () => ({ decision: "allow", code: "OK", factsVersion: 2 }) }, {
        now: () => now,
        attemptPort: new PostgresMcpExternalEffectAttemptRepository(tx as unknown as Database, undefined, () => now),
        executor: async () => { providerCalls += 1; return { outcome: "delivered" as const, authoritative: true, code: "DELIVERED" }; },
        queue: { acknowledge: async () => { acknowledgements += 1; } },
      });
      await expect(worker.process({ id: job!.id, type: job!.type, status: "running", workspaceId, payload: job!.payload, lockedUntil: job!.lockedUntil!, lockedBy: job!.lockedBy! })).resolves.toMatchObject({ outcome: "invalidated", code: "SOURCE_STALE" });
      expect(providerCalls).toBe(0);
      expect(acknowledgements).toBe(1);
      const traces = await tx.select({ stage: mcpEffectTraces.stage }).from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, fixtureValue.identity.proposalId)));
      expect(traces).toEqual([{ stage: "policy" }]);
      throw rollback;
    })).rejects.toThrow("ROLLBACK_CANCELLED_CONTENT");
  });

  test("does not resolve a content publication after its authoritative asset revision changes", async () => {
    const rollback = new Error("ROLLBACK_REVISED_CONTENT");
    await expect(database.db.transaction(async (tx) => {
      const fixtureValue = await contentWorkerFixture(tx);
      const [publication] = await tx.select({ assetId: contentPublications.assetId }).from(contentPublications).where(eq(contentPublications.id, fixtureValue.publicationId));
      await tx.update(contentAssets).set({ latestVersion: 2 }).where(eq(contentAssets.id, publication!.assetId));
      const source = await new PostgresMcpGovernedEffectSourceReader(tx, () => now).read({ workspaceId, proposalId: fixtureValue.identity.proposalId, kind: "content_publication", aggregateId: fixtureValue.publicationId });
      expect(source).toBeNull();
      throw rollback;
    })).rejects.toThrow("ROLLBACK_REVISED_CONTENT");
  });

  test("fails closed when the content publisher has no text capability", async () => {
    const rollback = new Error("ROLLBACK_UNAVAILABLE_CONTENT");
    await expect(database.db.transaction(async (tx) => {
      const fixtureValue = await contentWorkerFixture(tx);
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, fixtureValue.identity.jobId));
      let providerCalls = 0;
      let capabilityChecks = 0;
      let acknowledgements = 0;
      const runtimeDatabase = tx as unknown as Database;
      const executor = new PostgresMcpGovernedEffectExecutor(runtimeDatabase, {
        publisher: {
          observeCapabilities: async () => {
            capabilityChecks += 1;
            return { network: "linkedin", accountId: "content-attempt-account", accountHealthy: false, textPublishing: "unavailable" as const, observedAt: now };
          },
          publishText: async () => {
            providerCalls += 1;
            return { providerPostId: "must-not-publish", socialId: null, url: null, publishedAt: now };
          },
        },
      }, undefined, () => now);
      const worker = new PostgresMcpGovernedEffectWorker(runtimeDatabase, { final: async () => ({ decision: "allow", code: "OK", factsVersion: 2 }) }, {
        now: () => now,
        attemptPort: new PostgresMcpExternalEffectAttemptRepository(runtimeDatabase, executor, () => now),
        executor: (input) => executor.execute(input),
        queue: { acknowledge: async () => { acknowledgements += 1; } },
      });
      await expect(worker.process({ id: job!.id, type: job!.type, status: "running", workspaceId, payload: job!.payload, lockedUntil: job!.lockedUntil!, lockedBy: job!.lockedBy! })).resolves.toMatchObject({ outcome: "invalidated", code: "ADAPTER_UNAVAILABLE" });
      expect(capabilityChecks).toBe(1);
      expect(providerCalls).toBe(0);
      expect(acknowledgements).toBe(1);
      const [proposal] = await tx.select({ status: mcpEffectProposals.status }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, fixtureValue.identity.proposalId));
      const [intention] = await tx.select({ state: mcpEffectIntentions.state }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, fixtureValue.identity.intentionId));
      const traces = await tx.select({ stage: mcpEffectTraces.stage }).from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, fixtureValue.identity.proposalId))).orderBy(asc(mcpEffectTraces.sequence));
      expect(proposal?.status).toBe("failed");
      expect(intention?.state).toBe("completed");
      expect(traces.map((trace) => trace.stage)).toEqual(["policy", "attempt", "result"]);
      throw rollback;
    })).rejects.toThrow("ROLLBACK_UNAVAILABLE_CONTENT");
  });

  test("persists unknown once and attaches one reconciliation without retrying mutation", async () => {
    const identity = await fixture();
    const repository = new PostgresMcpExternalEffectAttemptRepository(database.db, undefined, () => now);
    const outcome = await repository.recordOutcome({ ...identity, outcome: "unknown", code: "EFFECT_EXECUTOR_AMBIGUOUS", result: { attemptRef: "opaque-reference", evidence: { second: 2, first: 1 } } });
    expect(outcome).toMatchObject({ state: "unknown", proposalStatus: "reconciling" });
    const reconciliation = await database.db.select().from(mcpEffectReconciliations).where(and(eq(mcpEffectReconciliations.workspaceId, workspaceId), eq(mcpEffectReconciliations.proposalId, identity.proposalId))).orderBy(asc(mcpEffectReconciliations.createdAt));
    expect(reconciliation).toHaveLength(1);
    const replay = await repository.recordOutcome({ ...identity, outcome: "unknown", code: "EFFECT_EXECUTOR_AMBIGUOUS", result: { evidence: { first: 1, second: 2 }, attemptRef: "opaque-reference" } });
    expect(replay).toEqual(outcome);
    await expect(repository.recordOutcome({ ...identity, outcome: "unknown", code: "EFFECT_EXECUTOR_AMBIGUOUS", result: { attemptRef: "opaque-reference", evidence: { first: 1, second: 3 } } })).rejects.toMatchObject({ code: "MCP_EFFECT_OUTCOME_REPLAY_CONFLICT" });
    const traces = await database.db.select().from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, identity.proposalId), eq(mcpEffectTraces.stage, "result"))).orderBy(asc(mcpEffectTraces.sequence));
    expect(traces).toHaveLength(1);
    const [intention] = await database.db.select({ state: mcpEffectIntentions.state }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, identity.intentionId));
    expect(intention?.state).toBe("unknown");
  });

  test("maps a source-event collision to a stable error and rolls back the outcome", async () => {
    const identity = await fixture();
    const repository = new PostgresMcpExternalEffectAttemptRepository(database.db, undefined, () => now);
    const marker = await repository.recordBeforeProvider(identity);
    await expect(repository.recordOutcome({ ...identity, outcome: "failed", code: "EFFECT_FAILED", sourceEventId: marker.sourceEventId })).rejects.toMatchObject({ code: "MCP_EFFECT_ATTEMPT_SOURCE_EVENT_CONFLICT" });
    const [intention] = await database.db.select({ state: mcpEffectIntentions.state }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, identity.intentionId));
    expect(intention?.state).toBe("started");
    const [proposal] = await database.db.select({ status: mcpEffectProposals.status }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, identity.proposalId));
    expect(proposal?.status).toBe("accepted");
    const resultTraces = await database.db.select().from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, identity.proposalId), eq(mcpEffectTraces.stage, "result"))).orderBy(asc(mcpEffectTraces.sequence));
    expect(resultTraces).toHaveLength(0);
  });

  test("recovers one expired attempt through read-only reconciliation", async () => {
    const identity = await fixture({ expired: true });
    let readOnlyCalls = 0;
    const repository = new PostgresMcpExternalEffectAttemptRepository(database.db, {
      reconcileReadOnly: async () => {
        readOnlyCalls += 1;
        return { outcome: "matched", authoritative: true, candidateCount: 1, result: { providerId: "reference-only" } };
      },
    }, () => now);
    await expect(repository.recoverExpiredStarted({ workspaceId, now, limit: 1 })).resolves.toBe(1);
    expect(readOnlyCalls).toBe(1);
    const [reconciliation] = await database.db.select().from(mcpEffectReconciliations).where(and(eq(mcpEffectReconciliations.workspaceId, workspaceId), eq(mcpEffectReconciliations.proposalId, identity.proposalId)));
    expect(reconciliation?.status).toBe("matched");
    const [proposal] = await database.db.select({ status: mcpEffectProposals.status }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, identity.proposalId));
    expect(proposal?.status).toBe("delivered");
    const [intention] = await database.db.select({ state: mcpEffectIntentions.state }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, identity.intentionId));
    expect(intention?.state).toBe("completed");
    const [job] = await database.db.select({ status: jobs.status, lockedBy: jobs.lockedBy, lockedUntil: jobs.lockedUntil }).from(jobs).where(eq(jobs.id, identity.jobId));
    expect(job).toMatchObject({ status: "completed", lockedBy: null, lockedUntil: null });
  });

  test("rejects lease owner, token, and expiry divergence without mutating the attempt", async () => {
    const identity = await fixture();
    const repository = new PostgresMcpExternalEffectAttemptRepository(database.db, undefined, () => now);
    await expect(repository.recordBeforeProvider({ ...identity, jobLeaseOwner: "foreign-worker" })).rejects.toMatchObject({ code: "MCP_EFFECT_JOB_LEASE_INVALID" });

    await database.db.update(jobs).set({ lockedBy: "foreign-worker" }).where(eq(jobs.id, identity.jobId));
    await expect(repository.recordBeforeProvider({ ...identity, jobLeaseOwner: "attempt-worker" })).rejects.toMatchObject({ code: "MCP_EFFECT_JOB_LEASE_INVALID" });
    await database.db.update(jobs).set({ lockedBy: "attempt-worker" }).where(eq(jobs.id, identity.jobId));

    await expect(repository.recordBeforeProvider({ ...identity, leaseExpiresAt: new Date(now.getTime() - 1) })).rejects.toMatchObject({ code: "MCP_EFFECT_ATTEMPT_LEASE_LOST" });
    await expect(repository.recordBeforeProvider({ ...identity, leaseToken: crypto.randomUUID() })).rejects.toMatchObject({ code: "MCP_EFFECT_ATTEMPT_LEASE_LOST" });
    const [intention] = await database.db.select({ state: mcpEffectIntentions.state }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, identity.intentionId));
    const traces = await database.db.select().from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, identity.proposalId))).orderBy(asc(mcpEffectTraces.sequence));
    expect(intention?.state).toBe("started");
    expect(traces).toHaveLength(0);
  });

  test("fails closed for foreign tenant and foreign binding identities", async () => {
    const identity = await fixture();
    const repository = new PostgresMcpExternalEffectAttemptRepository(database.db, undefined, () => now);
    await expect(repository.recordBeforeProvider({ ...identity, workspaceId: crypto.randomUUID() })).rejects.toMatchObject({ code: "MCP_EFFECT_WORKSPACE_UNAVAILABLE" });
    await expect(repository.recordBeforeProvider({ ...identity, proposalId: crypto.randomUUID() })).rejects.toMatchObject({ code: "MCP_EFFECT_ATTEMPT_BINDING_CONFLICT" });
    const [proposal] = await database.db.select({ status: mcpEffectProposals.status }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, identity.proposalId));
    expect(proposal?.status).toBe("accepted");
  });

  test("does not reveal or mutate an existing proposal from another workspace", async () => {
    const foreignWorkspaceId = crypto.randomUUID();
    const foreignProposalId = crypto.randomUUID();
    const foreignIntentionId = crypto.randomUUID();
    const foreignJobId = crypto.randomUUID();
    const foreignAggregateId = crypto.randomUUID();
    const foreignCorrelationId = crypto.randomUUID();
    const foreignLeaseToken = crypto.randomUUID();
    const foreignLeaseExpiresAt = new Date(now.getTime() + 60_000);
    await database.db.insert(workspaces).values({ id: foreignWorkspaceId, slug: `attempt-foreign-${foreignWorkspaceId}`, name: "Foreign attempt fixture" });
    try {
      await database.db.insert(mcpEffectProposals).values({
        id: foreignProposalId, workspaceId: foreignWorkspaceId, clientId: "attempt-foreign", kind: "conversation_reply", requestKey: crypto.randomUUID(), inputHash: "f".repeat(64), aggregateId: foreignAggregateId,
        intentSnapshot: { kind: "conversation_reply", aggregateId: foreignAggregateId, body: "foreign" },
        sourceSnapshot: { kind: "conversation_reply", aggregateId: foreignAggregateId, status: "open", sourceId: "foreign", sourceUpdatedAt: now.toISOString(), factsVersion: 1, revision: 1, sourceVersion: 1, suppressed: false, humanReplyAt: null },
        revision: 1, sourceVersion: 1, policyPreview: { decision: "allow", code: "OK", factsVersion: 1 }, policyFinal: { decision: "allow", code: "OK", factsVersion: 1 },
        status: "accepted", version: 2, approvalItemId: null, jobId: null, correlationId: foreignCorrelationId, createdAt: now, updatedAt: now,
      });
      await database.db.insert(jobs).values({
        id: foreignJobId, workspaceId: foreignWorkspaceId, type: "mcp.external-effect.execute", payload: { workspaceId: foreignWorkspaceId, proposalId: foreignProposalId, intentionId: foreignIntentionId, kind: "conversation_reply", aggregateId: foreignAggregateId, correlationId: foreignCorrelationId },
        idempotencyKey: `attempt-foreign:${foreignProposalId}`, correlationId: foreignCorrelationId, maxAttempts: 5, status: "running", attempts: 1, availableAt: now, lockedAt: now,
        lockedUntil: foreignLeaseExpiresAt, lockedBy: "foreign-worker", createdAt: now, updatedAt: now,
      });
      await database.db.insert(mcpEffectIntentions).values({
        id: foreignIntentionId, workspaceId: foreignWorkspaceId, proposalId: foreignProposalId, kind: "conversation_reply", aggregateId: foreignAggregateId, state: "started", idempotencyKey: `attempt-foreign:${foreignProposalId}`,
        jobId: foreignJobId, leaseToken: foreignLeaseToken, leaseExpiresAt: foreignLeaseExpiresAt, correlationId: foreignCorrelationId, createdAt: now, updatedAt: now,
      });
      const repository = new PostgresMcpExternalEffectAttemptRepository(database.db, undefined, () => now);
      await expect(repository.recordBeforeProvider({
        workspaceId, proposalId: foreignProposalId, intentionId: foreignIntentionId, jobId: foreignJobId, kind: "conversation_reply", aggregateId: foreignAggregateId,
        correlationId: foreignCorrelationId, leaseToken: foreignLeaseToken, leaseExpiresAt: foreignLeaseExpiresAt,
      })).rejects.toMatchObject({ code: "MCP_EFFECT_ATTEMPT_BINDING_CONFLICT" });
      const [foreignProposal] = await database.db.select({ status: mcpEffectProposals.status }).from(mcpEffectProposals).where(and(eq(mcpEffectProposals.workspaceId, foreignWorkspaceId), eq(mcpEffectProposals.id, foreignProposalId)));
      const foreignTraces = await database.db.select().from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, foreignWorkspaceId), eq(mcpEffectTraces.proposalId, foreignProposalId))).orderBy(asc(mcpEffectTraces.sequence));
      expect(foreignProposal?.status).toBe("accepted");
      expect(foreignTraces).toHaveLength(0);
    } finally {
      await database.client`delete from mcp_effect_traces where workspace_id = ${foreignWorkspaceId}`;
      await database.client`update mcp_effect_proposals set approval_item_id = null, reconciliation_id = null, job_id = null where workspace_id = ${foreignWorkspaceId}`;
      await database.client`delete from mcp_effect_reconciliations where workspace_id = ${foreignWorkspaceId}`;
      await database.client`delete from mcp_effect_intentions where workspace_id = ${foreignWorkspaceId}`;
      await database.client`delete from jobs where workspace_id = ${foreignWorkspaceId}`;
      await database.client`delete from mcp_effect_proposals where workspace_id = ${foreignWorkspaceId}`;
      await database.client`delete from workspaces where id = ${foreignWorkspaceId}`;
    }
  });

  test("deduplicates concurrent marker transactions and preserves sequence order", async () => {
    const identity = await fixture();
    const repository = new PostgresMcpExternalEffectAttemptRepository(database.db, undefined, () => now);
    const [first, second] = await Promise.all([
      repository.recordBeforeProvider(identity),
      repository.recordBeforeProvider(identity),
    ]);
    expect(first.sourceEventId).toBe(second.sourceEventId);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.sequence).toBe(second.sequence);
    const traces = await database.db.select({ stage: mcpEffectTraces.stage, sequence: mcpEffectTraces.sequence }).from(mcpEffectTraces).where(and(
      eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, identity.proposalId), eq(mcpEffectTraces.stage, "attempt"),
    )).orderBy(asc(mcpEffectTraces.sequence));
    expect(traces).toEqual([{ stage: "attempt", sequence: 1 }]);
  });

  test("recovers expired attempts once across workers and honors a one-item limit", async () => {
    const firstIdentity = await fixture({ expired: true });
    const secondIdentity = await fixture({ expired: true });
    let readOnlyCalls = 0;
    const readOnlyPort = {
      reconcileReadOnly: async () => {
        readOnlyCalls += 1;
        return { outcome: "matched" as const, authoritative: true as const, candidateCount: 1 as const, result: { providerId: "reference-only" } };
      },
    };
    const [first, second] = await Promise.all([
      new PostgresMcpExternalEffectAttemptRepository(database.db, readOnlyPort, () => now).recoverExpiredStarted({ workspaceId, now, limit: 1 }),
      new PostgresMcpExternalEffectAttemptRepository(database.db, readOnlyPort, () => now).recoverExpiredStarted({ workspaceId, now, limit: 1 }),
    ]);
    expect(first + second).toBe(1);
    expect(readOnlyCalls).toBe(1);
    const firstReconciliation = await database.db.select().from(mcpEffectReconciliations).where(and(eq(mcpEffectReconciliations.workspaceId, workspaceId), eq(mcpEffectReconciliations.proposalId, firstIdentity.proposalId))).orderBy(asc(mcpEffectReconciliations.createdAt));
    const secondReconciliation = await database.db.select().from(mcpEffectReconciliations).where(and(eq(mcpEffectReconciliations.workspaceId, workspaceId), eq(mcpEffectReconciliations.proposalId, secondIdentity.proposalId))).orderBy(asc(mcpEffectReconciliations.createdAt));
    expect(firstReconciliation.length + secondReconciliation.length).toBe(1);
    const remaining = await new PostgresMcpExternalEffectAttemptRepository(database.db, readOnlyPort, () => now).recoverExpiredStarted({ workspaceId, now, limit: 1 });
    expect(remaining).toBe(1);
    expect(readOnlyCalls).toBe(2);
    for (const identity of [firstIdentity, secondIdentity]) {
      const [proposal] = await database.db.select({ status: mcpEffectProposals.status }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, identity.proposalId));
      const [intention] = await database.db.select({ state: mcpEffectIntentions.state }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, identity.intentionId));
      const [job] = await database.db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, identity.jobId));
      const [reconciliation] = await database.db.select({ status: mcpEffectReconciliations.status, resultSnapshot: mcpEffectReconciliations.resultSnapshot }).from(mcpEffectReconciliations).where(eq(mcpEffectReconciliations.proposalId, identity.proposalId));
      const traces = await database.db.select({ stage: mcpEffectTraces.stage }).from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, identity.proposalId))).orderBy(asc(mcpEffectTraces.sequence));
      expect(proposal?.status).toBe("delivered");
      expect(intention?.state).toBe("completed");
      expect(job?.status).toBe("completed");
      expect(reconciliation).toMatchObject({ status: "matched", resultSnapshot: { providerId: "reference-only" } });
      expect(traces.filter((trace) => trace.stage === "attempt")).toHaveLength(0);
    }
  });

  test("treats lease expiry at now as recoverable and a future lease as not due", async () => {
    const boundary = await fixture({ expired: true });
    await database.db.update(mcpEffectIntentions).set({ leaseExpiresAt: now }).where(eq(mcpEffectIntentions.id, boundary.intentionId));
    let readOnlyCalls = 0;
    const repository = new PostgresMcpExternalEffectAttemptRepository(database.db, {
      reconcileReadOnly: async () => {
        readOnlyCalls += 1;
        return { outcome: "not_found" as const, candidateCount: 0 as const };
      },
    }, () => now);
    await expect(repository.recoverExpiredStarted({ workspaceId, now, limit: 1 })).resolves.toBe(1);
    const future = await fixture();
    await expect(repository.recoverExpiredStarted({ workspaceId, now, limit: 1 })).resolves.toBe(0);
    expect(readOnlyCalls).toBe(1);
    const [futureIntention] = await database.db.select({ state: mcpEffectIntentions.state, leaseExpiresAt: mcpEffectIntentions.leaseExpiresAt }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, future.intentionId));
    expect(futureIntention?.state).toBe("started");
    expect(futureIntention?.leaseExpiresAt?.getTime()).toBeGreaterThan(now.getTime());
  });

  test("rejects non-authoritative, non-finite, redacted-empty, and oversized delivery evidence", async () => {
    const notAuthoritative = await fixture();
    const repository = new PostgresMcpExternalEffectAttemptRepository(database.db, undefined, () => now);
    await expect(repository.recordOutcome({ ...notAuthoritative, outcome: "delivered", authoritative: false })).rejects.toMatchObject({ code: "MCP_EFFECT_RESULT_NOT_AUTHORITATIVE" });

    const nonFinite = await fixture();
    await expect(repository.recordOutcome({ ...nonFinite, outcome: "delivered", authoritative: true, result: { value: Number.NaN } })).rejects.toMatchObject({ code: "MCP_RECONCILIATION_SNAPSHOT_NON_FINITE_NUMBER" });
    const empty = await fixture();
    await expect(repository.recordOutcome({ ...empty, outcome: "delivered", authoritative: true, result: { apiKey: "must-not-persist" } })).rejects.toMatchObject({ code: "MCP_EFFECT_RESULT_INVALID" });
    const oversized = await fixture();
    await expect(repository.recordOutcome({ ...oversized, outcome: "delivered", authoritative: true, result: { evidence: "x".repeat(33_000) } })).rejects.toMatchObject({ code: "MCP_RECONCILIATION_SNAPSHOT_TOO_LARGE" });
    const [unchanged] = await database.db.select({ state: mcpEffectIntentions.state }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, nonFinite.intentionId));
    expect(unchanged?.state).toBe("started");
  });

  test("replays failed outcomes by identity and rejects outcome/source conflicts", async () => {
    const identity = await fixture();
    const repository = new PostgresMcpExternalEffectAttemptRepository(database.db, undefined, () => now);
    const failed = await repository.recordOutcome({ ...identity, outcome: "failed", code: "EFFECT_FAILED", result: { failureRef: "opaque-reference", details: { second: 2, first: 1 } } });
    await expect(repository.recordOutcome({ ...identity, outcome: "failed", code: "EFFECT_FAILED", result: { details: { first: 1, second: 2 }, failureRef: "opaque-reference" }, sourceEventId: failed.sourceEventId, idempotencyKey: failed.idempotencyKey })).resolves.toEqual(failed);
    const [beforeProposal] = await database.db.select({ status: mcpEffectProposals.status, version: mcpEffectProposals.version }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, identity.proposalId));
    const [beforeIntention] = await database.db.select({ state: mcpEffectIntentions.state }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, identity.intentionId));
    const beforeTraces = await database.db.select().from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, identity.proposalId))).orderBy(asc(mcpEffectTraces.sequence));
    await expect(repository.recordOutcome({ ...identity, outcome: "failed", code: "EFFECT_FAILED", result: { failureRef: "opaque-reference", details: { first: 1, second: 3 } }, sourceEventId: failed.sourceEventId, idempotencyKey: failed.idempotencyKey })).rejects.toMatchObject({ code: "MCP_EFFECT_OUTCOME_REPLAY_CONFLICT" });
    const [afterProposal] = await database.db.select({ status: mcpEffectProposals.status, version: mcpEffectProposals.version }).from(mcpEffectProposals).where(eq(mcpEffectProposals.id, identity.proposalId));
    const [afterIntention] = await database.db.select({ state: mcpEffectIntentions.state }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, identity.intentionId));
    const afterTraces = await database.db.select().from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, identity.proposalId))).orderBy(asc(mcpEffectTraces.sequence));
    expect(afterProposal).toEqual(beforeProposal);
    expect(afterIntention).toEqual(beforeIntention);
    expect(afterTraces).toEqual(beforeTraces);
    await expect(repository.recordOutcome({ ...identity, outcome: "failed", code: "EFFECT_OTHER" })).rejects.toMatchObject({ code: "MCP_EFFECT_OUTCOME_REPLAY_CONFLICT" });
    await expect(repository.recordOutcome({ ...identity, outcome: "failed", code: "EFFECT_FAILED", sourceEventId: crypto.randomUUID(), idempotencyKey: failed.idempotencyKey })).rejects.toMatchObject({ code: "MCP_EFFECT_ATTEMPT_SOURCE_EVENT_CONFLICT" });
    const traces = await database.db.select().from(mcpEffectTraces).where(and(eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, identity.proposalId), eq(mcpEffectTraces.stage, "result"))).orderBy(asc(mcpEffectTraces.sequence));
    expect(traces).toHaveLength(1);
  });

  test("applies matched, not-found, ambiguous, and error observations without mutation replay", async () => {
    const scenarios: Array<{ readonly observation: ExternalEffectReadOnlyResult; readonly reconciliationStatus: string; readonly intentionState: string }> = [
      { observation: { outcome: "not_found", candidateCount: 0 }, reconciliationStatus: "not_found", intentionState: "completed" },
      { observation: { outcome: "ambiguous", candidateCount: 2 }, reconciliationStatus: "ambiguous", intentionState: "unknown" },
      { observation: { outcome: "error", code: "ADAPTER_UNAVAILABLE" }, reconciliationStatus: "error", intentionState: "unknown" },
    ];
    for (const scenario of scenarios) {
      const identity = await fixture({ expired: true });
      let readOnlyCalls = 0;
      const repository = new PostgresMcpExternalEffectAttemptRepository(database.db, {
        reconcileReadOnly: async () => {
          readOnlyCalls += 1;
          return scenario.observation;
        },
      }, () => now);
      await expect(repository.recoverExpiredStarted({ workspaceId, now, limit: 1 })).resolves.toBe(1);
      expect(readOnlyCalls).toBe(1);
      await expect(repository.recoverExpiredStarted({ workspaceId, now, limit: 1 })).resolves.toBe(0);
      expect(readOnlyCalls).toBe(1);
      const [reconciliation] = await database.db.select({ status: mcpEffectReconciliations.status }).from(mcpEffectReconciliations).where(and(
        eq(mcpEffectReconciliations.workspaceId, workspaceId), eq(mcpEffectReconciliations.proposalId, identity.proposalId),
      ));
      const [intention] = await database.db.select({ state: mcpEffectIntentions.state }).from(mcpEffectIntentions).where(eq(mcpEffectIntentions.id, identity.intentionId));
      const traces = await database.db.select({ stage: mcpEffectTraces.stage }).from(mcpEffectTraces).where(and(
        eq(mcpEffectTraces.workspaceId, workspaceId), eq(mcpEffectTraces.proposalId, identity.proposalId),
      )).orderBy(asc(mcpEffectTraces.sequence));
      const [job] = await database.db.select({ status: jobs.status, lockedBy: jobs.lockedBy, lockedUntil: jobs.lockedUntil }).from(jobs).where(eq(jobs.id, identity.jobId));
      expect(reconciliation?.status).toBe(scenario.reconciliationStatus);
      expect(intention?.state).toBe(scenario.intentionState);
      expect(traces.filter((trace) => trace.stage === "attempt")).toHaveLength(0);
      expect(job).toMatchObject({ status: "completed", lockedBy: null, lockedUntil: null });
    }
  });
});
