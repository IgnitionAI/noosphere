import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { and, count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { InboundReplyAgent } from "@outbound/application/campaigns/inbound-reply-agent";
import { PROSPECT_DECISION_JOB_TYPE } from "@outbound/application/campaigns/prospect-decision";
import type { LeasedJob } from "@outbound/application/jobs/job-queue";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  campaignEnrollments,
  campaignProspects,
  campaigns,
  contacts,
  connectedAccounts,
  conversations,
  icps,
  icpVersions,
  jobs,
  outboxEvents,
  outreachActions,
  prospectDecisions,
  prospectDiscoveryCandidates,
  prospectDiscoveryRuns,
  sequenceVersions,
  sequences,
  workspaceChannelAccounts,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { InboundReplyJobProcessor } from "@outbound/infrastructure/campaigns/inbound-reply-runner";
import { OutreachDispatchJobProcessor } from "@outbound/infrastructure/campaigns/outreach-dispatch-runner";
import { PostgresProspectDecisionScheduler } from "@outbound/infrastructure/campaigns/postgres-prospect-decision-scheduler";
import { ProspectDecisionJobProcessor } from "@outbound/infrastructure/campaigns/prospect-decision-runner";
import { UnipileWebhookIngestor } from "@outbound/infrastructure/campaigns/unipile-webhook-ingestor";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("outbound send safety", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const queue = new PostgresJobQueue(database.client);
  const workspaceId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const icpId = crypto.randomUUID();
  const icpVersionId = crypto.randomUUID();
  const discoveryRunId = crypto.randomUUID();
  const candidateId = crypto.randomUUID();
  const now = new Date("2026-08-13T12:00:00.000Z");
  const clock = { now: () => new Date(now) };

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
    await database.db.insert(workspaces).values({
      id: workspaceId,
      slug: `send-safety-${workspaceId}`,
      name: "Outbound send safety",
    });
    await database.db.insert(contacts).values({
      id: contactId,
      workspaceId,
      firstName: "Marie",
      lastName: "Durand",
    });
    await database.db.insert(icps).values({
      id: icpId,
      workspaceId,
      name: "ICP send safety",
      currentVersion: 1,
    });
    await database.db.insert(icpVersions).values({
      id: icpVersionId,
      workspaceId,
      icpId,
      version: 1,
      name: "ICP send safety",
      confidence: "0.9000",
      criteria: {},
      buyingCommittee: [],
      problems: [],
      signals: [],
      exclusions: [],
      unknowns: [],
      unresolvedContradictions: [],
      blockedFindings: [],
      publishedAt: now,
    });
    await database.db.insert(prospectDiscoveryRuns).values({
      id: discoveryRunId,
      workspaceId,
      icpVersionId,
      channel: "linkedin",
      filters: {},
      status: "completed",
      completedAt: now,
    });
    await database.db.insert(prospectDiscoveryCandidates).values({
      id: candidateId,
      workspaceId,
      runId: discoveryRunId,
      fullName: "Marie Durand",
      providerData: { providerId: "person-send-safety" },
    });
  });

  afterAll(async () => {
    // Published ICP versions are immutable snapshots. Like the existing V3
    // qualification suite, leave this isolated disposable workspace graph.
    await database.close();
  });

  test("a wait reply resumes only the action from the replying campaign", async () => {
    await database.client`delete from jobs where workspace_id = ${workspaceId}`;
    const first = await campaignFixture("reply-campaign", `reply-account-${workspaceId}`);
    const second = await campaignFixture("other-campaign", `other-account-${workspaceId}`, "cancelled", -1_000);
    await database.db.insert(campaignProspects).values({
      workspaceId,
      campaignId: first.campaignId,
      candidateId,
      contactId,
      status: "enrolled",
    });

    const eventId = crypto.randomUUID();
    await database.client`
      insert into integration_events (
        id, workspace_id, provider, provider_event_id, event_type, payload, status, received_at
      ) values (
        ${eventId}, ${workspaceId}, 'unipile', ${`provider:${eventId}`}, 'message_received',
        ${database.client.json({
          event: "message_received",
          account_id: first.accountId,
          account_type: "LINKEDIN",
          chat_id: `chat-${eventId}`,
          id: `message-${eventId}`,
          text: "Recontactez-moi le mois prochain.",
          sender: { attendee_provider_id: `person-${eventId}` },
          timestamp: now.toISOString(),
        })},
        'pending', ${now}
      )
    `;
    await database.client`
      insert into conversations (
        id, workspace_id, contact_id, campaign_id, provider, provider_account_id,
        provider_thread_id, channel, status, unread_count, last_message_at, created_at, updated_at
      ) values (
        ${crypto.randomUUID()}, ${workspaceId}, ${contactId}, ${first.campaignId}, 'unipile',
        ${first.accountId}, ${`chat-${eventId}`}, 'linkedin', 'open', 0, ${now}, ${now}, ${now}
      )
    `;

    const agent: InboundReplyAgent = {
      async decide() {
        return {
          intent: "not_now",
          confidence: 0.99,
          action: "wait",
          replyBody: null,
          rationale: "Le prospect demande un report explicite.",
          suggestedNextAction: "Reprendre dans trente jours.",
          resumeAt: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
          evidence: ["le mois prochain"],
          metadata: { provider: "fixture", model: "fixture", promptVersion: "fixture" },
        };
      },
    };
    const inboundJob = await prepareLeasedJob({
      id: crypto.randomUUID(),
      workspaceId,
      type: "inbound.reply.process",
      payload: { workspaceId, integrationEventId: eventId },
      idempotencyKey: `process:${eventId}`,
      correlationId: eventId,
      maxAttempts: 1,
      availableAt: now,
    }, "reply-worker");
    await new InboundReplyJobProcessor(database.db, queue, agent, clock, null).process(inboundJob);

    const [replyAction, otherAction] = await Promise.all([
      action(first.actionId),
      action(second.actionId),
    ]);
    expect(replyAction).toMatchObject({ status: "scheduled", lastErrorCode: null });
    expect(otherAction).toMatchObject({ status: "cancelled", lastErrorCode: "PROSPECT_REPLIED" });
    const [decision] = await database.db
      .select()
      .from(prospectDecisions)
      .where(and(eq(prospectDecisions.workspaceId, workspaceId), eq(prospectDecisions.outreachActionId, first.actionId)));
    expect(decision).toMatchObject({ campaignId: first.campaignId, outreachActionId: first.actionId });
  });

  test("an inbound reply that races after the final gate blocks the provider send", async () => {
    await database.client`delete from jobs where workspace_id = ${workspaceId}`;
    await database.db
      .update(campaignEnrollments)
      .set({ status: "cancelled", completedAt: now })
      .where(and(eq(campaignEnrollments.workspaceId, workspaceId), eq(campaignEnrollments.contactId, contactId)));
    const fixture = await campaignFixture("racing-campaign", `racing-account-${workspaceId}`, "scheduled");
    const dispatchJob = await leasedJob(fixture.actionId, "dispatch-worker");
    let providerSends = 0;
    let webhookCompletedBeforeProviderAcceptance: boolean | undefined;
    let statusBeforeProviderAcceptance: string | undefined;
    let racingWebhook: Promise<unknown> | undefined;
    const processor = new OutreachDispatchJobProcessor(
      database.db,
      queue,
      {
        async send() {
          let webhookCompleted = false;
          racingWebhook = new UnipileWebhookIngestor(database.db, () => clock.now()).ingest(JSON.stringify({
            event: "message_received",
            account_id: fixture.accountId,
            account_type: "LINKEDIN",
            chat_id: `chat-${fixture.actionId}`,
            id: `reply-${fixture.actionId}`,
            text: "Merci, je vous réponds.",
            sender: { attendee_provider_id: "person-send-safety" },
            timestamp: now.toISOString(),
          })).then((result) => {
            webhookCompleted = true;
            return result;
          });
          await new Promise((resolve) => setTimeout(resolve, 50));
          webhookCompletedBeforeProviderAcceptance = webhookCompleted;
          statusBeforeProviderAcceptance = (await action(fixture.actionId))?.status;
          providerSends += 1;
          return { providerRequestId: "unsafe-send", conversationId: "unsafe-chat" };
        },
      },
      clock,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        async resolveHealthyAccount() {
          return { accountId: fixture.accountId };
        },
      },
    );

    await processor.process(dispatchJob);
    await racingWebhook;

    expect(providerSends).toBe(1);
    expect(webhookCompletedBeforeProviderAcceptance).toBe(false);
    expect(statusBeforeProviderAcceptance).toBe("executing");
    expect(await action(fixture.actionId)).toMatchObject({
      status: "sent",
      lastErrorCode: null,
    });
  });

  test("a current account mapping wins over historical actions from another workspace", async () => {
    await database.client`delete from jobs where workspace_id = ${workspaceId}`;
    const accountId = `reassigned-account-${workspaceId}`;
    const fixture = await campaignFixture("historical-account", accountId);
    expect(fixture.actionId).toBeDefined();
    const currentWorkspaceId = crypto.randomUUID();
    const currentUserId = crypto.randomUUID();
    await database.client`
      insert into workspaces (id, slug, name, status)
      values (${currentWorkspaceId}, ${`current-${currentWorkspaceId}`}, 'Current owner', 'active')
    `;
    await database.client`
      insert into auth_users (id, name, email)
      values (${currentUserId}, 'Current owner', ${`current-${currentUserId}@example.com`})
    `;
    await database.db.insert(workspaceChannelAccounts).values({
      workspaceId: currentWorkspaceId,
      channel: "linkedin",
      provider: "unipile",
      providerAccountId: accountId,
      displayName: "Reassigned LinkedIn",
      selectedBy: currentUserId,
    });

    const result = await new UnipileWebhookIngestor(database.db, () => clock.now()).ingest(JSON.stringify({
      event: "message_received",
      account_id: accountId,
      account_type: "LINKEDIN",
      chat_id: `chat-reassigned-${workspaceId}`,
      id: `reply-reassigned-${workspaceId}`,
      text: "Bonjour depuis le compte réaffecté.",
      sender: { attendee_provider_id: "unmatched-current-contact" },
      timestamp: now.toISOString(),
    }));

    expect(result.duplicate).toBe(false);
    const [job] = await database.db
      .select({ workspaceId: jobs.workspaceId })
      .from(jobs)
      .where(and(eq(jobs.workspaceId, currentWorkspaceId), eq(jobs.type, "inbound.reply.process")));
    expect(job).toMatchObject({ workspaceId: currentWorkspaceId });
    await database.db.delete(workspaceChannelAccounts).where(eq(workspaceChannelAccounts.workspaceId, currentWorkspaceId));
    await database.client`delete from jobs where workspace_id = ${currentWorkspaceId}`;
    await database.client`delete from integration_events where workspace_id = ${currentWorkspaceId}`;
    await database.client`delete from auth_users where id = ${currentUserId}`;
    await database.client`delete from workspaces where id = ${currentWorkspaceId}`;
  });

  test("an unsent action follows the workspace current healthy sender without a retry", async () => {
    await database.client`delete from jobs where workspace_id = ${workspaceId}`;
    await database.db
      .update(campaignEnrollments)
      .set({ status: "cancelled", completedAt: now })
      .where(and(eq(campaignEnrollments.workspaceId, workspaceId), eq(campaignEnrollments.contactId, contactId)));
    const fixture = await campaignFixture("sender-rebind", `historical-sender-${workspaceId}`, "scheduled");
    const currentProviderAccountId = `current-sender-${workspaceId}`;
    const connectedAccountId = crypto.randomUUID();
    await database.db.insert(connectedAccounts).values({
      id: connectedAccountId,
      workspaceId,
      provider: "unipile",
      providerAccountId: currentProviderAccountId,
      displayName: "Current LinkedIn sender",
      status: "connected",
      encryptedSecret: "provider-managed",
    });
    const dispatchJob = await leasedJob(fixture.actionId, "sender-rebind-worker");
    const sentWith: string[] = [];
    await new OutreachDispatchJobProcessor(
      database.db,
      queue,
      {
        async send(request) {
          sentWith.push(request.accountId);
          return { providerRequestId: "sender-rebind-request", conversationId: "sender-rebind-chat" };
        },
      },
      clock,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        async resolveHealthyAccount() {
          return { accountId: currentProviderAccountId };
        },
      },
    ).process(dispatchJob);

    expect(sentWith).toEqual([currentProviderAccountId]);
    expect(await action(fixture.actionId)).toMatchObject({
      status: "sent",
      providerAccountId: currentProviderAccountId,
      connectedAccountId,
      lastErrorCode: null,
    });
  });

  test("an open LinkedIn thread atomically cancels a newly planned cold DM", async () => {
    await database.client`delete from jobs where workspace_id = ${workspaceId}`;
    await database.db
      .update(campaignEnrollments)
      .set({ status: "cancelled", completedAt: now })
      .where(and(eq(campaignEnrollments.workspaceId, workspaceId), eq(campaignEnrollments.contactId, contactId)));
    const fixture = await campaignFixture("open-thread-decision", `open-thread-account-${workspaceId}`, "scheduled");
    await database.db.insert(campaignProspects).values({
      workspaceId,
      campaignId: fixture.campaignId,
      candidateId,
      contactId,
      status: "enrolled",
      score: 78,
      eligible: true,
    });
    await database.db.insert(conversations).values({
      id: crypto.randomUUID(),
      workspaceId,
      contactId,
      campaignId: fixture.campaignId,
      provider: "unipile",
      providerAccountId: fixture.accountId,
      providerThreadId: `open-thread-${fixture.actionId}`,
      channel: "linkedin",
      origin: "campaign",
      status: "open",
      lastMessageAt: now,
    });

    const decisionId = crypto.randomUUID();
    const scheduler = new PostgresProspectDecisionScheduler(database.db, clock);
    await scheduler.schedule({
      id: decisionId,
      workspaceId,
      contactId,
      campaignId: fixture.campaignId,
      outreachActionId: fixture.actionId,
      kind: "scheduled_touch",
      reason: "Envoyer le premier DM LinkedIn.",
      dueAt: now,
      idempotencyKey: `open-thread:${fixture.actionId}`,
      correlationId: decisionId,
    });
    const [decisionJob] = await queue.lease({
      workerId: "open-thread-decision-worker",
      types: [PROSPECT_DECISION_JOB_TYPE],
      limit: 1,
      leaseMs: 30_000,
      now,
    });
    expect(decisionJob).toBeDefined();
    let agentCalls = 0;
    const processor = new ProspectDecisionJobProcessor(database.db, queue, {
      async decide() {
        agentCalls += 1;
        return {
          observation: "Le prospect correspond à l’ICP et le DM est prêt.",
          action: "send",
          reason: "Démarrer la séquence LinkedIn.",
          nextDueAt: null,
          nextReason: null,
        };
      },
    }, clock);
    await processor.process(decisionJob!);
    const replay = await scheduler.schedule({
      id: crypto.randomUUID(),
      workspaceId,
      contactId,
      campaignId: fixture.campaignId,
      outreachActionId: fixture.actionId,
      kind: "scheduled_touch",
      reason: "Rejouer la même décision logique.",
      dueAt: now,
      idempotencyKey: `open-thread:${fixture.actionId}`,
      correlationId: decisionId,
    });

    expect(await action(fixture.actionId)).toMatchObject({
      status: "cancelled",
      lastErrorCode: "LINKEDIN_CONVERSATION_ALREADY_OPEN",
      cancelledAt: now,
    });
    const [decision] = await database.db
      .select()
      .from(prospectDecisions)
      .where(and(eq(prospectDecisions.workspaceId, workspaceId), eq(prospectDecisions.id, decisionId)));
    expect(decision).toMatchObject({
      status: "cancelled",
      proposedAction: "send",
    });
    expect(decision?.result).toMatchObject({
      socialSignalAssessment: {
        baseScore: 78,
        effectiveScore: 78,
        openLinkedinConversation: true,
        decisionImpact: "conversation_open",
      },
    });
    const [dispatchCount] = await database.db
      .select({ value: count() })
      .from(jobs)
      .where(and(
        eq(jobs.workspaceId, workspaceId),
        eq(jobs.type, "outreach.dispatch"),
      ));
    expect(dispatchCount?.value).toBe(0);
    const [blockedBeforeReplay] = await database.db
      .select({ value: count() })
      .from(outboxEvents)
      .where(and(
        eq(outboxEvents.workspaceId, workspaceId),
        eq(outboxEvents.aggregateId, decisionId),
        eq(outboxEvents.eventType, "ProspectDecisionBlocked"),
      ));

    const [blockedAfterReplay] = await database.db
      .select({ value: count() })
      .from(outboxEvents)
      .where(and(
        eq(outboxEvents.workspaceId, workspaceId),
        eq(outboxEvents.aggregateId, decisionId),
        eq(outboxEvents.eventType, "ProspectDecisionBlocked"),
      ));
    expect(agentCalls).toBe(1);
    expect(replay).toMatchObject({ created: false, decision: { id: decisionId, status: "cancelled" } });
    expect(blockedBeforeReplay?.value).toBe(1);
    expect(blockedAfterReplay?.value).toBe(1);
  });

  async function campaignFixture(
    label: string,
    accountId: string,
    status: "cancelled" | "scheduled" | "executing" = "cancelled",
    dueOffsetMs = 0,
  ) {
    const sequenceId = crypto.randomUUID();
    const sequenceVersionId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    const enrollmentId = crypto.randomUUID();
    const actionId = crypto.randomUUID();
    await database.db.insert(sequences).values({
      id: sequenceId,
      workspaceId,
      name: `Sequence ${label}`,
      status: "published",
    });
    await database.db.insert(sequenceVersions).values({
      id: sequenceVersionId,
      workspaceId,
      sequenceId,
      version: 1,
      steps: [],
      publishedAt: now,
    });
    await database.db.insert(campaigns).values({
      id: campaignId,
      workspaceId,
      name: `Campaign ${label}`,
      status: "active",
      icpVersionId,
      channel: "linkedin",
      sequenceId,
      sequenceVersionId,
      autopilotPolicy: { enabled: true, executionMode: "live" },
    });
    await database.db.insert(campaignEnrollments).values({
      id: enrollmentId,
      workspaceId,
      campaignId,
      contactId,
      sequenceVersionId,
      status: status === "cancelled" ? "cancelled" : "active",
      completedAt: status === "cancelled" ? now : null,
    });
    await database.db.insert(outreachActions).values({
      id: actionId,
      workspaceId,
      campaignId,
      enrollmentId,
      candidateId,
      contactId,
      sequenceVersionId,
      providerAccountId: accountId,
      channel: "linkedin",
      stepPosition: 1,
      stepKind: "linkedin_message",
      status,
      idempotencyKey: `${label}:send`,
      dueAt: new Date(now.getTime() + dueOffsetMs),
      contentSnapshot: {
        body: `Bonjour pour ${label}`,
        subject: null,
        recipient: {
          value: "Marie Durand",
          normalizedValue: "linkedin.com/in/marie-durand",
          providerUserId: `person-${actionId}`,
        },
      },
      lastErrorCode: status === "cancelled" ? "PROSPECT_REPLIED" : null,
    });
    return { actionId, accountId, campaignId, enrollmentId };
  }

  async function action(actionId: string) {
    const [row] = await database.db
      .select()
      .from(outreachActions)
      .where(and(eq(outreachActions.workspaceId, workspaceId), eq(outreachActions.id, actionId)));
    return row;
  }

  async function leasedJob(actionId: string, workerId: string): Promise<LeasedJob> {
    return prepareLeasedJob({
      id: crypto.randomUUID(),
      workspaceId,
      type: "outreach.dispatch",
      payload: { workspaceId, actionId },
      idempotencyKey: `${actionId}:dispatch`,
      correlationId: actionId,
      maxAttempts: 3,
      availableAt: now,
    }, workerId);
  }

  async function prepareLeasedJob(
    job: Omit<LeasedJob, "attempts" | "lockedBy" | "lockedUntil">,
    workerId: string,
  ): Promise<LeasedJob> {
    await queue.enqueue(job);
    const lockedUntil = new Date(now.getTime() + 30_000);
    await database.db
      .update(jobs)
      .set({
        status: "running",
        attempts: 1,
        lockedAt: now,
        lockedUntil,
        lockedBy: workerId,
        updatedAt: now,
      })
      .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, job.id)));
    return { ...job, attempts: 1, lockedBy: workerId, lockedUntil };
  }
});
