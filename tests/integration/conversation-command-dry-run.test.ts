import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { CONVERSATION_COMMAND_JOB_TYPE } from "@outbound/application/campaigns/autonomous-prospecting";
import type { ProspectContextBundle } from "@outbound/domain/prospect-memory/prospect-memory";
import { ConversationCommandJobProcessor } from "@outbound/infrastructure/campaigns/conversation-command-runner";
import { PostgresConversationCommandRepository } from "@outbound/infrastructure/campaigns/postgres-conversation-command-repository";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  authUsers,
  contactIdentities,
  contacts,
  conversationCommands,
  conversations,
  jobs,
  messages,
  outboxEvents,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("Prospect 360 Setter dry-run", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const queue = new PostgresJobQueue(database.client);
  const workspaceId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const oldCommitmentMessageId = crypto.randomUUID();
  const now = new Date("2026-08-23T10:00:00.000Z");

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
    await database.db.insert(workspaces).values({
      id: workspaceId,
      slug: `setter-dry-run-${workspaceId}`,
      name: "Setter dry-run",
    });
    await database.db.insert(authUsers).values({
      id: ownerId,
      name: "Dry-run owner",
      email: `setter-dry-run-${ownerId}@example.com`,
    });
    await database.db.insert(contacts).values({
      id: contactId,
      workspaceId,
      firstName: "Marie",
      lastName: "Dupont",
      source: "provider",
    });
    await database.db.insert(contactIdentities).values({
      id: crypto.randomUUID(),
      workspaceId,
      contactId,
      type: "linkedin",
      value: "linkedin-member-fixture",
      normalizedValue: "linkedin-member-fixture",
      verificationStatus: "verified",
      source: "provider",
    });
    await database.db.insert(conversations).values({
      id: conversationId,
      workspaceId,
      contactId,
      campaignId: null,
      provider: "unipile",
      providerAccountId: "linkedin-account-fixture",
      providerThreadId: "linkedin-thread-fixture",
      channel: "linkedin",
      origin: "outside_campaign",
      automationMode: "human",
      status: "open",
      lastMessageAt: now,
    });
    await database.db.insert(messages).values({
      id: oldCommitmentMessageId,
      workspaceId,
      conversationId,
      providerMessageId: "linkedin-inbound-fixture",
      direction: "inbound",
      senderType: "contact",
      body: "Pouvez-vous me rappeler ce que vous aviez promis ?",
      sentAt: now,
      createdAt: now,
    });
    await database.db.insert(messages).values(Array.from({ length: 120 }, (_, index) => ({
      id: crypto.randomUUID(),
      workspaceId,
      conversationId,
      providerMessageId: `linkedin-inbound-recent-${index}`,
      direction: "inbound" as const,
      senderType: "contact",
      body: `Message récent ${index + 1}`,
      sentAt: new Date(now.getTime() + (index + 1) * 1_000),
      createdAt: new Date(now.getTime() + (index + 1) * 1_000),
    })));
  });

  afterAll(async () => {
    await database.client`delete from jobs where workspace_id = ${workspaceId}`;
    await database.client`delete from outbox_events where workspace_id = ${workspaceId}`;
    await database.client`delete from conversation_commands where workspace_id = ${workspaceId}`;
    await database.client`delete from messages where workspace_id = ${workspaceId}`;
    await database.client`delete from conversations where workspace_id = ${workspaceId}`;
    await database.client`delete from contact_identities where workspace_id = ${workspaceId}`;
    await database.client`delete from contacts where workspace_id = ${workspaceId}`;
    await database.client`delete from auth_users where id = ${ownerId}`;
    await database.client`delete from workspaces where id = ${workspaceId}`;
    await database.close();
  });

  test("generates from shadow memory without a provider send or calendar effect", async () => {
    const repository = new PostgresConversationCommandRepository(database.db);
    const command = await repository.create({
      workspaceId,
      conversationId,
      requestedBy: ownerId,
      mode: "setter",
      executionMode: "dry_run",
      body: null,
      idempotencyKey: `setter-dry-run:${conversationId}`,
      now,
    });
    const replayed = await repository.create({
      workspaceId,
      conversationId,
      requestedBy: ownerId,
      mode: "setter",
      executionMode: "dry_run",
      body: null,
      idempotencyKey: `setter-dry-run:${conversationId}`,
      now,
    });
    expect(replayed.id).toBe(command.id);
    expect(await database.db.select().from(jobs).where(and(
      eq(jobs.workspaceId, workspaceId),
      eq(jobs.type, CONVERSATION_COMMAND_JOB_TYPE),
    ))).toHaveLength(1);
    const [job] = await queue.lease({
      workerId: "setter-dry-run-worker",
      types: [CONVERSATION_COMMAND_JOB_TYPE],
      limit: 1,
      leaseMs: 30_000,
      now,
    });
    expect(job).toBeDefined();

    let gatewayCalls = 0;
    let agentCalls = 0;
    let shadowComparisons = 0;
    const processor = new ConversationCommandJobProcessor(
      database.db,
      queue,
      {
        async send() {
          gatewayCalls += 1;
          return { providerRequestId: "must-not-exist", conversationId: null };
        },
      },
      {
        async decide(input) {
          agentCalls += 1;
          expect(input.prospectContext).toMatchObject({
            memory: { commercialState: { commitments: [{ sourceId: oldCommitmentMessageId }] } },
          });
          expect(input.prospectContextReference).toMatchObject({ mode: "shadow", receiptId: "receipt-dry-run" });
          expect(input.prospectContextAllowedProviders).toEqual(["codex-cli"]);
          return {
            intent: "question",
            confidence: 0.95,
            action: "reply",
            replyBody: "Oui — voici l’engagement exact que nous avions pris.",
            rationale: "Réponse fondée sur la mémoire durable.",
            metadata: {
              provider: "codex-cli",
              model: "gpt-test",
              promptVersion: "setter-test",
              aiRunId: "ai-run-dry-run",
              memoryReceiptId: "receipt-dry-run",
              memorySnapshotId: "snapshot-dry-run",
              memorySnapshotVersion: 4,
              memoryWatermark: 50,
            },
          };
        },
      },
      { now: () => now },
      null,
      undefined,
      { assemble: async () => shadowBundle(workspaceId, contactId, oldCommitmentMessageId, now) },
      {
        compare: async () => {
          shadowComparisons += 1;
          return { aiRunId: "shadow-comparison-run" };
        },
      },
      {
        find: async () => ({
          flags: {
            prospectMemoryCapture: true,
            prospectMemoryShadow: true,
            prospectMemorySetter: false,
            enabledCapabilities: [],
          },
          processingProfiles: [{
            provider: "codex-cli",
            encryptedInTransit: true,
            trainingUse: "none",
            providerRetentionDays: 0,
            regionOrJurisdiction: "Local CLI",
            operatorAccessPolicy: "Workspace operator only",
            subprocessorsReviewed: true,
            deletionProcedure: "Delete the local run artifacts",
            personalDataAllowed: true,
            allowedCapabilities: ["setter_campaign"],
            reviewedAt: now,
          }],
          maxDailySemanticRefreshes: 100,
          maxDailyCostUsd: 10,
        }),
      },
    );

    await processor.process(job!);

    const [persisted] = await database.db.select().from(conversationCommands).where(and(
      eq(conversationCommands.workspaceId, workspaceId),
      eq(conversationCommands.id, command.id),
    ));
    expect(persisted).toMatchObject({
      status: "generated",
      executionMode: "dry_run",
      generatedBody: "Oui — voici l’engagement exact que nous avions pris.",
      generationMetadata: {
        provider: "codex-cli",
        model: "gpt-test",
        promptVersion: "setter-test",
        aiRunId: "ai-run-dry-run",
        memoryReceiptId: "receipt-dry-run",
        memorySnapshotId: "snapshot-dry-run",
        memorySnapshotVersion: 4,
        memoryWatermark: 50,
        intent: "question",
        action: "reply",
        calendarAction: null,
      },
      providerRequestId: null,
      sentAt: null,
    });
    expect(gatewayCalls).toBe(0);
    expect(agentCalls).toBe(1);
    expect(shadowComparisons).toBe(1);
    expect(await database.db.select().from(messages).where(and(
      eq(messages.workspaceId, workspaceId),
      eq(messages.direction, "outbound"),
    ))).toHaveLength(0);
    expect(await database.db.select().from(outboxEvents).where(and(
      eq(outboxEvents.workspaceId, workspaceId),
      eq(outboxEvents.eventType, "SetterReplyGeneratedDryRun"),
    ))).toHaveLength(1);
  });
});

function shadowBundle(
  workspaceId: string,
  contactId: string,
  oldCommitmentMessageId: string,
  now: Date,
): ProspectContextBundle {
  return {
    workspaceId,
    contactId,
    capability: "setter_campaign",
    mode: "shadow",
    status: "fresh",
    snapshotId: crypto.randomUUID(),
    snapshotVersion: 1,
    receiptId: "receipt-dry-run",
    watermark: 50,
    privacyEpoch: 0,
    assembledAt: now,
    currentState: {
      displayName: "Marie Dupont",
      companyName: null,
      jobTitle: null,
      locale: "fr",
      availableChannels: ["linkedin"],
      suppressed: false,
      anonymized: false,
      activeCampaignIds: [],
      activeDecisionId: null,
    },
    activeDecisionId: null,
    context: {
      memory: {
        commercialState: {
          commitments: [{ eventId: "event-old", sourceId: oldCommitmentMessageId }],
        },
      },
    },
    sourceEventIds: ["event-old"],
    excludedSourceEventIds: [],
    estimatedTokens: 150,
    automaticActionAllowed: false,
    waitCode: null,
  };
}
