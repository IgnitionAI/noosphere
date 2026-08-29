import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { ExternalEffectPolicy } from "@outbound/application/mcp/external-effect-policy";
import {
  calendarConnections, calendarMeetingTypes, campaignEnrollments, campaigns, connectedAccounts, contentAssetVersions, contentAssets,
  contentBriefs, contentGenerationRuns, contentIdeas, contentPublications, contactIdentities, contacts, contactSuppressions,
  conversations, editorialStrategies, editorialStrategyVersions, icpVersions, icps, mcpEffectProposals, meetingProposals,
  messages, offerVersions, offers, sequenceVersions, sequences, workspaces,
} from "@outbound/infrastructure/database/schema";
import { suppressionFingerprint } from "@outbound/infrastructure/crm/suppression-fingerprint";
import { PostgresExternalEffectFactsReader } from "@outbound/infrastructure/mcp/postgres-external-effect-facts-reader";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("Postgres external-effect facts reader", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const foreignWorkspaceId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const meetingId = crypto.randomUUID();
  const calendarConnectionId = crypto.randomUUID();
  const calendarMeetingTypeId = crypto.randomUUID();
  const proposalId = crypto.randomUUID();
  const conversationProposalId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const identityId = crypto.randomUUID();
  const suppressionId = crypto.randomUUID();
  const now = new Date("2026-09-01T08:00:00.000Z");
  const context = { userId: crypto.randomUUID(), workspaceId, clientId: "fixture", role: "reviewer" as const, scopes: ["mcp:read"] as const, audience: "noosphere" };

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `facts-${workspaceId}`, name: "Facts fixture" },
      { id: foreignWorkspaceId, slug: `facts-${foreignWorkspaceId}`, name: "Foreign fixture" },
    ]);
    await database.db.insert(contacts).values({ id: contactId, workspaceId, firstName: "Fixture", lastName: "Contact" });
    await database.db.insert(connectedAccounts).values({
      id: accountId, workspaceId, provider: "unipile", providerAccountId: "fixture-account", displayName: "Fixture account",
      status: "connected", capabilities: { linkedin: { messaging: true } }, quotas: { linkedin: { remaining: 5 } }, encryptedSecret: "fixture-secret",
      lastCheckedAt: now,
    });
    await database.db.insert(contactIdentities).values({ id: identityId, workspaceId, contactId, type: "email", value: "fixture@example.com", normalizedValue: "fixture@example.com" });
    await database.db.insert(conversations).values({
      id: conversationId, workspaceId, contactId, connectedAccountId: accountId, provider: "unipile", providerAccountId: "fixture-account",
      providerThreadId: `thread-${conversationId}`, channel: "linkedin", lastMessageAt: now,
    });
    await database.db.insert(contactSuppressions).values({
      id: suppressionId, workspaceId, contactId, channel: "global", identityType: "email", normalizedValue: "fixture@example.com",
      identityFingerprint: suppressionFingerprint({ workspaceId, identityType: "email", normalizedValue: "fixture@example.com" }), reason: "fixture",
    });
    await database.db.insert(messages).values({
      id: crypto.randomUUID(), workspaceId, conversationId, providerMessageId: `message-${conversationId}`, direction: "inbound", senderType: "contact",
      body: "private inbound body", receivedAt: now, createdAt: now,
    });
    await database.db.insert(meetingProposals).values({
      id: meetingId, workspaceId, conversationId, contactId, status: "offered", timeZone: "UTC",
      slots: [{ start: "2026-09-02T10:00:00.000Z", end: "2026-09-02T10:30:00.000Z" }],
      idempotencyKey: `fixture-${meetingId}`, expiresAt: new Date("2026-09-03T00:00:00.000Z"),
      revision: 4, sourceVersion: 9, updatedAt: now,
    });
    await database.db.insert(calendarConnections).values({
      id: calendarConnectionId, workspaceId, provider: "calcom", bookingUrl: "https://cal.example.com/fixture", eventTypeId: 42,
      eventTypeSlug: "intro", eventTypeTitle: "Intro", username: "fixture", timeZone: "UTC", status: "active", isDefault: true,
      lastVerifiedAt: now, updatedAt: now,
    });
    await database.db.insert(calendarMeetingTypes).values({
      id: calendarMeetingTypeId, workspaceId, connectionId: calendarConnectionId, providerEventTypeId: 42,
      slug: "intro", title: "Intro", lengthMinutes: 30, bookingUrl: "https://cal.example.com/fixture/intro", timeZone: "UTC", isDefault: true, active: true, updatedAt: now,
    });
    await database.db.insert(mcpEffectProposals).values({
      id: proposalId, workspaceId, clientId: "fixture", kind: "meeting_proposal", requestKey: crypto.randomUUID(),
      inputHash: "a".repeat(64), aggregateId: meetingId,
      intentSnapshot: { kind: "meeting_proposal", aggregateId: meetingId, slotPosition: 1 },
      sourceSnapshot: { kind: "meeting_proposal", aggregateId: meetingId, slotPosition: 1, revision: 4, sourceVersion: 9, factsVersion: 9 },
      revision: 4, sourceVersion: 9, correlationId: crypto.randomUUID(), createdAt: now, updatedAt: now,
    });
    await database.db.insert(mcpEffectProposals).values({
      id: conversationProposalId, workspaceId, clientId: "fixture", kind: "conversation_reply", requestKey: crypto.randomUUID(),
      inputHash: "b".repeat(64), aggregateId: conversationId,
      intentSnapshot: { kind: "conversation_reply", aggregateId: conversationId },
      sourceSnapshot: { kind: "conversation_reply", aggregateId: conversationId, revision: 1, sourceVersion: 1, factsVersion: 1 },
      revision: 1, sourceVersion: 1, correlationId: crypto.randomUUID(), createdAt: now, updatedAt: now,
    });
  });

  afterAll(async () => {
    await database.client`delete from mcp_effect_proposals where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
    await database.client`delete from meeting_proposals where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
    await database.client`delete from calendar_meeting_types where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
    await database.client`delete from calendar_connections where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
    await database.client`delete from conversations where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
    await database.client`delete from connected_accounts where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
    await database.client`delete from contacts where workspace_id in (${workspaceId}, ${foreignWorkspaceId})`;
    await database.client`delete from workspaces where id in (${workspaceId}, ${foreignWorkspaceId})`;
    await database.close();
  });

  test("projects an offered local meeting slot using stored aggregate and versions", async () => {
    const reader = new PostgresExternalEffectFactsReader(database.db, () => new Date("2026-09-01T08:00:00.000Z"));
    const facts = await reader.readFacts({ context, phase: "preview", proposal: {
      proposalId, workspaceId, kind: "meeting_proposal", status: "approval_required", approvalItemId: null,
      correlationId: crypto.randomUUID(), version: 1, revision: 4, sourceVersion: 9,
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    } });
    expect(facts).toMatchObject({ kind: "meeting_proposal", aggregateId: meetingId, revision: 4, sourceVersion: 9, slotPosition: 1, timeZone: "UTC", adapterAvailable: true });
    expect(JSON.stringify(facts)).not.toContain("provider");
  });

  test("uses a transaction-bound executor and fails closed for cross-workspace context", async () => {
    const reader = new PostgresExternalEffectFactsReader(database.db, () => now);
    const proposal = { proposalId, workspaceId, kind: "meeting_proposal" as const, status: "approval_required" as const, approvalItemId: null, correlationId: crypto.randomUUID(), version: 1, revision: 4, sourceVersion: 9, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    const facts = await database.db.transaction((tx) => new PostgresExternalEffectFactsReader(tx).read({ context, proposal, phase: "final" }));
    expect(facts?.aggregateId).toBe(meetingId);
    expect(await reader.read({ context: { ...context, workspaceId: foreignWorkspaceId }, proposal, phase: "preview" })).toBeNull();
  });

  test("projects conversation account, capability, quota, identity suppression and human reply facts", async () => {
    const proposal = { proposalId: conversationProposalId, workspaceId, kind: "conversation_reply" as const, status: "approval_required" as const, approvalItemId: null, correlationId: crypto.randomUUID(), version: 1, revision: 1, sourceVersion: 1, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    const facts = await database.db.transaction((tx) => new PostgresExternalEffectFactsReader(tx, () => now).read({ context, proposal, phase: "preview" }));
    expect(facts).toMatchObject({ kind: "conversation_reply", aggregateId: conversationId, contactPresent: true, suppressed: true, hasHumanReply: true, adapterAvailable: true, accountHealthy: true, quotaAvailable: true });
    expect(JSON.stringify(facts)).not.toContain("private inbound body");
    expect(JSON.stringify(facts)).not.toContain("fixture@example.com");
  });

  test("fails closed for invalid Cal.com event type and provider selection", async () => {
    const proposal = { proposalId, workspaceId, kind: "meeting_proposal" as const, status: "approval_required" as const, approvalItemId: null, correlationId: crypto.randomUUID(), version: 1, revision: 4, sourceVersion: 9, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    const rollback = new Error("ROLLBACK_FACTS_MEETING_VARIANTS");
    await expect(database.db.transaction(async (tx) => {
      await tx.update(calendarMeetingTypes).set({ providerEventTypeId: 99 }).where(eq(calendarMeetingTypes.id, calendarMeetingTypeId));
      const invalidEventType = await new PostgresExternalEffectFactsReader(tx, () => now).read({ context, proposal, phase: "preview" });
      expect(invalidEventType).toMatchObject({ kind: "meeting_proposal", adapterAvailable: false });
      await tx.update(calendarMeetingTypes).set({ providerEventTypeId: 42 }).where(eq(calendarMeetingTypes.id, calendarMeetingTypeId));
      await tx.update(calendarConnections).set({ provider: "other" }).where(eq(calendarConnections.id, calendarConnectionId));
      const invalidProvider = await new PostgresExternalEffectFactsReader(tx, () => now).read({ context, proposal, phase: "preview" });
      expect(invalidProvider).toMatchObject({ kind: "meeting_proposal", adapterAvailable: false });
      throw rollback;
    })).rejects.toBe(rollback);
  });

  test("reads every kind through a tenant-scoped proposal and returns null without its provider aggregate", async () => {
    const kinds = ["conversation_reply", "content_publication", "meeting_proposal", "campaign_activation"] as const;
    const rollback = new Error("ROLLBACK_FACTS_MISSING_KINDS");
    await expect(database.db.transaction(async (tx) => {
      for (const kind of kinds) {
        const proposal = crypto.randomUUID();
        const aggregateId = crypto.randomUUID();
        await tx.insert(mcpEffectProposals).values({
          id: proposal, workspaceId, clientId: "fixture-missing", kind, requestKey: crypto.randomUUID(), inputHash: "c".repeat(64), aggregateId,
          intentSnapshot: { kind, aggregateId }, sourceSnapshot: { kind, aggregateId, revision: 1, sourceVersion: 1, factsVersion: 1 },
          revision: 1, sourceVersion: 1, correlationId: crypto.randomUUID(), createdAt: now, updatedAt: now,
        });
        const facts = await new PostgresExternalEffectFactsReader(tx, () => now).read({ context, proposal: { proposalId: proposal, workspaceId, kind, status: "approval_required", approvalItemId: null, correlationId: crypto.randomUUID(), version: 1, revision: 1, sourceVersion: 1, createdAt: now.toISOString(), updatedAt: now.toISOString() }, phase: "preview" });
        expect(facts).toBeNull();
      }
      throw rollback;
    })).rejects.toBe(rollback);
  });

  test("projects the latest content publication and blocks stale readiness or strategy snapshots", async () => {
    const ids = {
      user: crypto.randomUUID(), offer: crypto.randomUUID(), offerVersion: crypto.randomUUID(), icp: crypto.randomUUID(), icpVersion: crypto.randomUUID(),
      strategy: crypto.randomUUID(), strategyVersion: crypto.randomUUID(), idea: crypto.randomUUID(), asset: crypto.randomUUID(), run: crypto.randomUUID(), brief: crypto.randomUUID(),
      assetVersion: crypto.randomUUID(), oldPublication: crypto.randomUUID(), latestPublication: crypto.randomUUID(), proposal: crypto.randomUUID(),
    };
    const rollback = new Error("ROLLBACK_FACTS_CONTENT_FINAL");
    await expect(database.db.transaction(async (tx) => {
      const later = new Date(now.getTime() + 2_000);
      await tx.insert(offers).values({ id: ids.offer, workspaceId, name: "Content offer", status: "draft", currentVersion: 1, category: "saas", valueProposition: "Proof", targetAudience: "Operators" });
      await tx.insert(offerVersions).values({ id: ids.offerVersion, workspaceId, offerId: ids.offer, version: 1, name: "Content offer", category: "saas", valueProposition: "Proof", targetAudience: "Operators", publishedAt: now });
      await tx.insert(icps).values({ id: ids.icp, workspaceId, name: "Content ICP", currentVersion: 1 });
      await tx.insert(icpVersions).values({ id: ids.icpVersion, workspaceId, icpId: ids.icp, version: 1, name: "Content ICP", confidence: "0.9000", criteria: {}, buyingCommittee: {}, problems: [], signals: [], exclusions: [], unknowns: [], unresolvedContradictions: [], blockedFindings: [], publishedAt: now });
      await tx.insert(editorialStrategies).values({ id: ids.strategy, workspaceId, name: "Content strategy", offerId: ids.offer, offerVersionId: ids.offerVersion, icpId: ids.icp, icpVersionId: ids.icpVersion, status: "active", currentVersion: 1, draft: {}, provider: "fixture", model: "fixture", promptVersion: "v1" });
      await tx.insert(editorialStrategyVersions).values({ id: ids.strategyVersion, workspaceId, strategyId: ids.strategy, version: 1, offerVersionId: ids.offerVersion, icpVersionId: ids.icpVersion, snapshot: {}, provider: "fixture", model: "fixture", promptVersion: "v1", publishedAt: now });
      await tx.insert(contentIdeas).values({ id: ids.idea, workspaceId, strategyVersionId: ids.strategyVersion, status: "discovered", angle: "Content angle", rationale: "Content rationale", audience: "Operators", pillar: "Proof", priority: 80, fingerprint: "f".repeat(64), freshnessUntil: new Date(now.getTime() + 86_400_000), firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now });
      await tx.insert(contentAssets).values({ id: ids.asset, workspaceId, ideaId: ids.idea, type: "linkedin_text", status: "ready", latestVersion: 1, revision: 1, createdAt: now, updatedAt: now });
      await tx.insert(contentGenerationRuns).values({ id: ids.run, workspaceId, ideaId: ids.idea, assetId: ids.asset, strategyVersionId: ids.strategyVersion, status: "ready", stage: "completed", createdAt: now, updatedAt: now });
      await tx.insert(contentBriefs).values({ id: ids.brief, workspaceId, runId: ids.run, ideaId: ids.idea, strategyVersionId: ids.strategyVersion, snapshot: {}, evidenceSnapshot: {}, createdAt: now });
      await tx.insert(contentAssetVersions).values({ id: ids.assetVersion, workspaceId, assetId: ids.asset, briefId: ids.brief, generationRunId: ids.run, version: 1, body: "safe body", draft: {}, audit: {}, critique: {}, readiness: { ready: true }, ready: true, createdAt: now });
      await tx.insert(connectedAccounts).values([
        { id: crypto.randomUUID(), workspaceId, provider: "unipile", providerAccountId: "collision-account", displayName: "Unipile content", status: "connected", capabilities: { linkedin: { publishing: true } }, quotas: { linkedin: { remaining: 4 } }, encryptedSecret: "fixture-unipile", lastCheckedAt: now },
        { id: crypto.randomUUID(), workspaceId, provider: "other", providerAccountId: "collision-account", displayName: "Other content", status: "connected", capabilities: {}, quotas: {}, encryptedSecret: "fixture-other", lastCheckedAt: now },
      ]);
      await tx.insert(contentPublications).values([
        { id: ids.oldPublication, workspaceId, assetId: ids.asset, assetVersionId: ids.assetVersion, network: "linkedin", provider: "unipile", status: "scheduled", requestKey: `content-old-${ids.oldPublication}`, scheduledFor: new Date(now.getTime() + 86_400_000), contentSnapshot: { body: "private old" }, policySnapshot: { policyVersion: "content-v1" }, accountSnapshot: { provider: "unipile", providerAccountId: "collision-account" }, createdAt: now, updatedAt: now },
        { id: ids.latestPublication, workspaceId, assetId: ids.asset, assetVersionId: ids.assetVersion, network: "linkedin", provider: "unipile", status: "scheduled", requestKey: `content-latest-${ids.latestPublication}`, scheduledFor: new Date(now.getTime() + 86_400_000), contentSnapshot: { body: "private latest" }, policySnapshot: { policyVersion: "content-v1" }, accountSnapshot: { provider: "unipile", providerAccountId: "collision-account" }, createdAt: later, updatedAt: later },
      ]);
      const sourceSnapshot = { kind: "content_publication", aggregateId: ids.asset, assetId: ids.asset, revision: 1, sourceVersion: 1, factsVersion: 11, sourceId: `content-publication:${ids.latestPublication}`, sourceUpdatedAt: later.toISOString(), status: "scheduled", publicationId: ids.latestPublication, assetVersionId: ids.assetVersion, contentVersion: 1, policyVersion: "content-v1", assetReady: true, assetStatus: "ready", strategyActive: true, strategyDeleted: false, strategyVersionId: ids.strategyVersion, strategyVersion: 1 } as const;
      await tx.insert(mcpEffectProposals).values({ id: ids.proposal, workspaceId, clientId: "content-fixture", kind: "content_publication", requestKey: crypto.randomUUID(), inputHash: "d".repeat(64), aggregateId: ids.asset, intentSnapshot: { kind: "content_publication", aggregateId: ids.asset, assetId: ids.asset }, sourceSnapshot, revision: 1, sourceVersion: 1, correlationId: crypto.randomUUID(), createdAt: now, updatedAt: now });
      const proposal = { proposalId: ids.proposal, workspaceId, kind: "content_publication" as const, status: "approval_required" as const, approvalItemId: null, correlationId: crypto.randomUUID(), version: 1, revision: 1, sourceVersion: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(), aggregateId: ids.asset, sourceSnapshot };
      const reader = new PostgresExternalEffectFactsReader(tx, () => now);
      const policy = new ExternalEffectPolicy(reader);
      const facts = await reader.read({ context, proposal, phase: "preview" });
      expect(facts).toMatchObject({ kind: "content_publication", aggregateId: ids.asset, publicationId: ids.latestPublication, assetId: ids.asset, assetVersionId: ids.assetVersion, contentVersion: 1, assetReady: true, assetStatus: "ready", strategyActive: true, strategyDeleted: false, strategyVersionId: ids.strategyVersion, strategyVersion: 1, adapterAvailable: true, accountHealthy: true, quotaAvailable: true });
      expect(JSON.stringify(facts)).not.toContain("provider");
      expect(JSON.stringify(facts)).not.toContain("private latest");
      await expect(policy.preview({ context, proposal, sourceSnapshot, phase: "preview" })).resolves.toMatchObject({ decision: "allow", code: "OK", factsVersion: 11 });
      expect(await new PostgresExternalEffectFactsReader(tx, () => now).read({ context: { ...context, workspaceId: foreignWorkspaceId }, proposal, phase: "preview" })).toBeNull();

      await tx.update(contentAssets).set({ status: "draft" }).where(eq(contentAssets.id, ids.asset));
      const nonReady = await reader.read({ context, proposal, phase: "preview" });
      expect(nonReady).toMatchObject({ assetReady: false, assetStatus: "draft" });
      await expect(policy.preview({ context, proposal, sourceSnapshot, phase: "preview" })).resolves.toMatchObject({ decision: "deny", code: "SOURCE_STALE" });

      await tx.update(editorialStrategies).set({ deletedAt: later }).where(eq(editorialStrategies.id, ids.strategy));
      const deletedStrategy = await reader.read({ context, proposal, phase: "preview" });
      expect(deletedStrategy).toMatchObject({ strategyDeleted: true });
      await expect(policy.preview({ context, proposal, sourceSnapshot, phase: "preview" })).resolves.toMatchObject({ decision: "deny", code: "SOURCE_STALE" });

      const strategyVersion2 = crypto.randomUUID();
      await tx.insert(editorialStrategyVersions).values({ id: strategyVersion2, workspaceId, strategyId: ids.strategy, version: 2, offerVersionId: ids.offerVersion, icpVersionId: ids.icpVersion, snapshot: {}, provider: "fixture", model: "fixture", promptVersion: "v2", publishedAt: later });
      await tx.update(contentIdeas).set({ strategyVersionId: strategyVersion2 }).where(eq(contentIdeas.id, ids.idea));
      const strategyChanged = await reader.read({ context, proposal, phase: "preview" });
      expect(strategyChanged).toMatchObject({ strategyVersionId: strategyVersion2, strategyVersion: 2 });
      await expect(policy.preview({ context, proposal, sourceSnapshot, phase: "preview" })).resolves.toMatchObject({ decision: "deny", code: "SOURCE_STALE" });
      throw rollback;
    })).rejects.toBe(rollback);
  });

  test("projects campaign enrollment changes without hashing factsVersion and fails closed cross-tenant", async () => {
    const ids = { icp: crypto.randomUUID(), icpVersion: crypto.randomUUID(), sequence: crypto.randomUUID(), sequenceVersion: crypto.randomUUID(), campaign: crypto.randomUUID(), contact: crypto.randomUUID(), enrollmentA: crypto.randomUUID(), enrollmentB: crypto.randomUUID(), proposal: crypto.randomUUID() };
    const rollback = new Error("ROLLBACK_FACTS_CAMPAIGN_FINAL");
    await expect(database.db.transaction(async (tx) => {
      await tx.insert(icps).values({ id: ids.icp, workspaceId, name: "Campaign ICP", currentVersion: 1 });
      await tx.insert(icpVersions).values({ id: ids.icpVersion, workspaceId, icpId: ids.icp, version: 1, name: "Campaign ICP", confidence: "0.9000", criteria: {}, buyingCommittee: {}, problems: [], signals: [], exclusions: [], unknowns: [], unresolvedContradictions: [], blockedFindings: [], publishedAt: now });
      await tx.insert(sequences).values({ id: ids.sequence, workspaceId, name: "Campaign sequence", status: "published", createdAt: now, updatedAt: now });
      await tx.insert(sequenceVersions).values({ id: ids.sequenceVersion, workspaceId, sequenceId: ids.sequence, version: 1, steps: [], publishedAt: now, createdAt: now });
      await tx.insert(contacts).values({ id: ids.contact, workspaceId, firstName: "Campaign", lastName: "Contact" });
      await tx.insert(campaigns).values({ id: ids.campaign, workspaceId, name: "Campaign fixture", objective: "Test", status: "active", icpVersionId: ids.icpVersion, channel: "linkedin", sequenceId: ids.sequence, autopilotPolicy: { policyVersion: "campaign-v1", scheduleWindow: { start: "2026-09-01T07:00:00.000Z", end: "2026-09-01T18:00:00.000Z", timeZone: "UTC" } }, automationStage: "ready", createdAt: now, updatedAt: now });
      await tx.insert(campaignEnrollments).values([
        { id: ids.enrollmentA, workspaceId, campaignId: ids.campaign, contactId, sequenceVersionId: ids.sequenceVersion, status: "active", enrolledAt: now, createdAt: now },
        { id: ids.enrollmentB, workspaceId, campaignId: ids.campaign, contactId: ids.contact, sequenceVersionId: ids.sequenceVersion, status: "active", enrolledAt: now, createdAt: now },
      ]);
      const sourceSnapshot = { kind: "campaign_activation", aggregateId: ids.campaign, revision: 1, sourceVersion: 1, factsVersion: 13, sourceId: `campaign:${ids.campaign}`, sourceUpdatedAt: now.toISOString(), status: "active", policyVersion: "campaign-v1", automationStage: "ready", enrollmentFingerprint: "a".repeat(64), campaignActive: true, enrollmentActive: true, scheduleWindow: { start: "2026-09-01T07:00:00.000Z", end: "2026-09-01T18:00:00.000Z", timeZone: "UTC" }, accountHealth: { status: "unhealthy", checkedAt: now.toISOString() }, adapterAvailable: false, accountHealthy: false, quotaAvailable: false } as const;
      await tx.insert(mcpEffectProposals).values({ id: ids.proposal, workspaceId, clientId: "campaign-fixture", kind: "campaign_activation", requestKey: crypto.randomUUID(), inputHash: "e".repeat(64), aggregateId: ids.campaign, intentSnapshot: { kind: "campaign_activation", aggregateId: ids.campaign }, sourceSnapshot, revision: 1, sourceVersion: 1, correlationId: crypto.randomUUID(), createdAt: now, updatedAt: now });
      const proposal = { proposalId: ids.proposal, workspaceId, kind: "campaign_activation" as const, status: "approval_required" as const, approvalItemId: null, correlationId: crypto.randomUUID(), version: 1, revision: 1, sourceVersion: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(), aggregateId: ids.campaign, sourceSnapshot };
      const reader = new PostgresExternalEffectFactsReader(tx, () => now);
      const facts = await reader.read({ context, proposal, phase: "preview" });
      if (!facts || facts.kind !== "campaign_activation") throw new Error("campaign facts missing");
      expect(facts).toMatchObject({ kind: "campaign_activation", aggregateId: ids.campaign, adapterAvailable: false, enrollmentActive: true, campaignActive: true, factsVersion: 13, policyVersion: "campaign-v1", automationStage: "ready" });
      expect(typeof facts.enrollmentFingerprint).toBe("string");
      expect(facts.enrollmentFingerprint).not.toBe(String(facts.factsVersion));
      expect(JSON.stringify(facts)).not.toContain("provider");
      expect(JSON.stringify(facts)).not.toContain("raw");
      expect(await reader.read({ context: { ...context, workspaceId: foreignWorkspaceId }, proposal, phase: "preview" })).toBeNull();
      const alignedProposal = { ...proposal, sourceSnapshot: { ...sourceSnapshot, enrollmentFingerprint: facts.enrollmentFingerprint } };

      await tx.update(campaignEnrollments).set({ status: "completed", completedAt: now }).where(eq(campaignEnrollments.id, ids.enrollmentA));
      await tx.update(campaignEnrollments).set({ status: "completed", completedAt: now }).where(eq(campaignEnrollments.id, ids.enrollmentB));
      const changed = await reader.read({ context, proposal, phase: "preview" });
      if (!changed || changed.kind !== "campaign_activation") throw new Error("changed campaign facts missing");
      expect(changed).toMatchObject({ adapterAvailable: false, enrollmentActive: false, factsVersion: 13 });
      expect(changed?.enrollmentFingerprint).not.toBe(facts?.enrollmentFingerprint);
      expect(changed?.factsVersion).toBe(facts?.factsVersion);
      const changedSnapshot = { ...sourceSnapshot, enrollmentFingerprint: facts?.enrollmentFingerprint };
      await expect(new ExternalEffectPolicy(reader).preview({ context, proposal: alignedProposal, sourceSnapshot: changedSnapshot, phase: "preview" })).resolves.toMatchObject({ decision: "deny", code: "CAMPAIGN_NOT_ACTIVE", factsVersion: 13 });
      throw rollback;
    })).rejects.toBe(rollback);
  });
});
