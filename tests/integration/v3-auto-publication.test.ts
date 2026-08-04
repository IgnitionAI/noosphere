import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  CreateProductResearchRun,
  StartProductResearchRun,
} from "@outbound/application/gtm/product-research-use-cases";
import { ResearchOrchestrator } from "@outbound/application/gtm/research-orchestrator";
import type { ResearchAgentExecutor } from "@outbound/application/gtm/product-research-ports";
import type { AgentExecutionResult, AgentStageInput } from "@outbound/contracts/product-research";
import type { ResearchStage } from "@outbound/domain/gtm/product-research";
import type {
  ChannelObservationSource,
  ChannelStrategyPlanner,
} from "@outbound/application/campaigns/channel-assessment";
import { CryptoIdGenerator } from "@outbound/application/shared/ports";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  campaigns,
  campaignProspects,
  channelAssessments,
  icpProposals,
  icpVersions,
  jobs,
  outreachActions,
  outreachAttempts,
  automatedReplies,
  contactSuppressions,
  conversations,
  integrationEvents,
  messages,
  opportunities,
  replyClassifications,
  outboxEvents,
  prospectDiscoveryRuns,
  prospectingPlans,
  sequences,
  sequenceSteps,
  sequenceEnrollments,
  sequenceVersions,
  contacts,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { PostgresProductResearchRepository } from "@outbound/infrastructure/gtm/postgres-product-research-repository";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
import { ChannelAssessmentJobProcessor } from "@outbound/infrastructure/campaigns/channel-assessment-runner";
import { Sha256ContentHasher } from "@outbound/infrastructure/shared/sha256-content-hasher";
import { createCampaignHttpHandler } from "@outbound/interface/http/campaign-handler";
import { PostgresDiscoveryRepository } from "@outbound/infrastructure/crm/postgres-discovery-repository";
import { CampaignAutomationJobProcessor } from "@outbound/infrastructure/campaigns/campaign-automation-runner";
import { CampaignCompositionJobProcessor } from "@outbound/infrastructure/campaigns/campaign-composition-runner";
import type { CampaignContentGenerator } from "@outbound/application/campaigns/campaign-content-generator";
import { OutreachDispatchJobProcessor } from "@outbound/infrastructure/campaigns/outreach-dispatch-runner";
import { UnipileWebhookIngestor } from "@outbound/infrastructure/campaigns/unipile-webhook-ingestor";
import { createUnipileWebhookHttpHandler } from "@outbound/interface/http/unipile-webhook-handler";
import { InboundReplyJobProcessor } from "@outbound/infrastructure/campaigns/inbound-reply-runner";
import { AutomatedReplySendJobProcessor } from "@outbound/infrastructure/campaigns/automated-reply-send-runner";
import { OutboundDeliveryError } from "@outbound/application/campaigns/outbound-channel-gateway";
import { validOutputFor } from "../fixtures/research-agent-fixtures";
import { CampaignSourcingReconciler } from "@outbound/infrastructure/campaigns/campaign-sourcing-reconciler";
import { PostgresProspectViewRepository } from "@outbound/infrastructure/crm/postgres-prospect-view-repository";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("V3 automatic ICP publication", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const repository = new PostgresProductResearchRepository(database.db);
  const queue = new PostgresJobQueue(database.client);
  const ids = new CryptoIdGenerator();
  let currentTime = new Date("2026-08-04T10:00:00.000Z");
  const clock = {
    now: () => new Date(currentTime),
  };
  const workspaceId = crypto.randomUUID();

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
    await database.db.insert(workspaces).values({
      id: workspaceId,
      slug: `v3-auto-${workspaceId}`,
      name: "V3 automatic publication",
    });
  });

  afterAll(async () => {
    await database.client`delete from jobs where workspace_id = ${workspaceId}`;
    await database.client`delete from outbox_events where workspace_id = ${workspaceId}`;
    await database.client`delete from product_research_runs where workspace_id = ${workspaceId}`;
    await database.client`delete from workspaces where id = ${workspaceId}`;
    await database.close();
  });

  test("assesses every channel and creates only recommended mono-channel campaigns", async () => {
    const run = await new CreateProductResearchRun(repository, ids, clock).execute({
      workspaceId,
      brief: {
        productUrl: "https://example.com",
        productName: "V3 publication",
        description: "",
        geography: "France",
        languages: ["fr"],
        salesMotion: "saas",
        knownCompetitors: [],
        internalDocumentIds: [],
        depth: "standard",
        researchVersion: 3,
      },
    });
    await new StartProductResearchRun(repository, ids, clock).execute({
      workspaceId,
      runId: run.snapshot.id,
      correlationId: "v3-auto-publication",
    });
    const orchestrator = new ResearchOrchestrator(
      repository,
      queue,
      new V3PublicationFixtureAgents(),
      ids,
      clock,
      new Sha256ContentHasher(),
    );

    for (let index = 0; index < 10; index += 1) {
      const [job] = await queue.lease({
        workerId: "v3-auto-worker",
        types: ["research.stage.execute"],
        limit: 1,
        leaseMs: 30_000,
        now: clock.now(),
      });
      expect(job).toBeDefined();
      await orchestrator.process(job!);
    }

    const proposals = await database.db
      .select()
      .from(icpProposals)
      .where(eq(icpProposals.runId, run.snapshot.id));
    const versions = await database.db
      .select()
      .from(icpVersions)
      .where(eq(icpVersions.runId, run.snapshot.id));
    const initialCampaigns = await database.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.workspaceId, workspaceId));
    const planRows = await database.db
      .select()
      .from(prospectingPlans)
      .where(eq(prospectingPlans.workspaceId, workspaceId));
    const initialAssessments = await database.db
      .select()
      .from(channelAssessments)
      .where(eq(channelAssessments.workspaceId, workspaceId));
    const discoveryRows = await database.db
      .select()
      .from(prospectDiscoveryRuns)
      .where(eq(prospectDiscoveryRuns.workspaceId, workspaceId));
    const assessmentJobs = await database.db
      .select()
      .from(jobs)
      .where(
        and(eq(jobs.workspaceId, workspaceId), eq(jobs.type, "prospecting.channel.assess")),
      );
    const publishedSequenceVersions = await database.db
      .select()
      .from(sequenceVersions)
      .where(eq(sequenceVersions.workspaceId, workspaceId));
    const events = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, run.snapshot.id));

    expect(proposals).toHaveLength(5);
    expect(proposals.map((proposal) => proposal.rank).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(versions).toHaveLength(5);
    expect(versions.every((version) => version.publishedBy === null)).toBe(true);
    expect(planRows).toHaveLength(5);
    expect(planRows.every((plan) => plan.status === "assessing")).toBe(true);
    expect(initialAssessments).toHaveLength(15);
    expect(initialAssessments.every((assessment) => assessment.status === "pending")).toBe(true);
    expect(assessmentJobs).toHaveLength(15);
    expect(initialCampaigns).toHaveLength(0);
    expect(discoveryRows).toHaveLength(0);
    expect(publishedSequenceVersions).toHaveLength(0);
    expect(events.filter((event) => event.eventType === "ICPVersionPublished")).toHaveLength(5);

    const processor = new ChannelAssessmentJobProcessor(
      database.db,
      queue,
      new FixtureChannelStrategyPlanner(),
      new FixtureChannelObservationSource(),
      clock,
    );
    for (const job of assessmentJobs) {
      const lockedUntil = new Date(clock.now().getTime() + 30_000);
      await database.db
        .update(jobs)
        .set({
          status: "running",
          attempts: 1,
          lockedBy: "channel-assessment-worker",
          lockedAt: clock.now(),
          lockedUntil,
        })
        .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, job.id)));
      await processor.process({
        id: job.id,
        workspaceId: job.workspaceId,
        type: job.type,
        payload: job.payload,
        idempotencyKey: job.idempotencyKey,
        correlationId: job.correlationId,
        maxAttempts: job.maxAttempts,
        availableAt: job.availableAt,
        attempts: 1,
        lockedBy: "channel-assessment-worker",
        lockedUntil,
      });
    }

    const campaignRows = await database.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.workspaceId, workspaceId));
    const sequenceRows = await database.db
      .select()
      .from(sequences)
      .where(eq(sequences.workspaceId, workspaceId));
    const stepRows = await database.db
      .select()
      .from(sequenceSteps)
      .where(eq(sequenceSteps.workspaceId, workspaceId));
    const completedAssessments = await database.db
      .select()
      .from(channelAssessments)
      .where(eq(channelAssessments.workspaceId, workspaceId));
    const completedPlans = await database.db
      .select()
      .from(prospectingPlans)
      .where(eq(prospectingPlans.workspaceId, workspaceId));
    const autonomousSourcingJobs = await database.db
      .select()
      .from(jobs)
      .where(
        and(eq(jobs.workspaceId, workspaceId), eq(jobs.type, "prospect.discovery.execute")),
      );
    const autonomousDiscoveryRuns = await database.db
      .select()
      .from(prospectDiscoveryRuns)
      .where(eq(prospectDiscoveryRuns.workspaceId, workspaceId));

    expect(completedPlans.every((plan) => plan.status === "ready")).toBe(true);
    expect(completedAssessments.filter((item) => item.recommendation === "recommended")).toHaveLength(5);
    expect(completedAssessments.filter((item) => item.recommendation === "optional")).toHaveLength(5);
    expect(completedAssessments.filter((item) => item.recommendation === "unsuitable")).toHaveLength(5);
    expect(campaignRows).toHaveLength(5);
    expect(campaignRows.every((campaign) => campaign.channel === "linkedin")).toBe(true);
    expect(campaignRows.every((campaign) => campaign.status === "draft")).toBe(true);
    expect(campaignRows.every((campaign) => campaign.discoveryRunId !== null)).toBe(true);
    expect(autonomousSourcingJobs).toHaveLength(5);
    expect(autonomousDiscoveryRuns).toHaveLength(5);
    expect(autonomousDiscoveryRuns.every((run) => run.channel === "linkedin")).toBe(true);
    expect(sequenceRows).toHaveLength(5);
    expect(sequenceRows.every((sequence) => sequence.status === "draft")).toBe(true);
    expect(stepRows).toHaveLength(10);
    const staleCampaign = campaignRows[0]!;
    const staleRunId = staleCampaign.discoveryRunId!;
    await database.db
      .update(campaigns)
      .set({ discoveryRunId: null })
      .where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, staleCampaign.id)));
    await database.db
      .delete(jobs)
      .where(and(
        eq(jobs.workspaceId, workspaceId),
        eq(jobs.idempotencyKey, `${staleCampaign.id}:sourcing:v1`),
      ));
    await database.db
      .delete(prospectDiscoveryRuns)
      .where(and(
        eq(prospectDiscoveryRuns.workspaceId, workspaceId),
        eq(prospectDiscoveryRuns.id, staleRunId),
      ));

    const reconciler = new CampaignSourcingReconciler(database.db, clock);
    expect(await reconciler.reconcile({ workspaceId })).toBe(1);
    expect(await reconciler.reconcile({ workspaceId })).toBe(0);
    const [repairedCampaign] = await database.db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, staleCampaign.id)));
    expect(repairedCampaign?.discoveryRunId).not.toBeNull();
    const repairedJobs = await database.db
      .select()
      .from(jobs)
      .where(and(
        eq(jobs.workspaceId, workspaceId),
        eq(jobs.idempotencyKey, `${staleCampaign.id}:sourcing:v2`),
      ));
    expect(repairedJobs).toHaveLength(1);
    await database.db
      .update(prospectDiscoveryRuns)
      .set({
        status: "failed",
        errorCode: "PROVIDER_UNAVAILABLE",
        errorMessage: "Unipile people search failed (400): content_too_large",
        completedAt: clock.now(),
      })
      .where(and(
        eq(prospectDiscoveryRuns.workspaceId, workspaceId),
        eq(prospectDiscoveryRuns.id, repairedCampaign!.discoveryRunId!),
      ));
    expect(await reconciler.reconcile({ workspaceId })).toBe(1);
    expect(await reconciler.reconcile({ workspaceId })).toBe(0);
    const [retriedRun] = await database.db
      .select()
      .from(prospectDiscoveryRuns)
      .where(and(
        eq(prospectDiscoveryRuns.workspaceId, workspaceId),
        eq(prospectDiscoveryRuns.id, repairedCampaign!.discoveryRunId!),
      ));
    expect(retriedRun).toMatchObject({ status: "running", errorCode: null });
    const normalizedRetryJobs = await database.db
      .select()
      .from(jobs)
      .where(and(
        eq(jobs.workspaceId, workspaceId),
        eq(jobs.idempotencyKey, `${staleCampaign.id}:sourcing:normalized:v1`),
      ));
    expect(normalizedRetryJobs).toHaveLength(1);
    const firstCampaign = repairedCampaign!;

    const campaignHandler = createCampaignHttpHandler({
      contextResolver: {
        async resolve() {
          return { userId: crypto.randomUUID(), workspaceId, role: "operator" as const };
        },
      },
      database: database.db,
      jobQueue: queue,
      draftImprover: {
        async improve() {
          throw new Error("Unexpected draft improvement");
        },
      },
    });
    const listResponse = await campaignHandler(new Request("http://localhost/api/v1/campaigns"));
    expect(listResponse.status).toBe(200);
    expect(((await listResponse.json()) as { data: unknown[] }).data).toHaveLength(5);
    const detailResponse = await campaignHandler(
      new Request(`http://localhost/api/v1/campaigns/${firstCampaign.id}`),
    );
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as {
      status: string;
      prospectCount: number;
      sequenceStatus: string;
      steps: unknown[];
      prospects: Array<{ candidateId: string }>;
    };
    expect(detail).toMatchObject({
      status: "draft",
      prospectCount: 0,
      sequenceStatus: "draft",
      channel: "linkedin",
      assessmentRecommendation: "recommended",
    });
    expect(detail.steps).toHaveLength(2);
    expect(detail.prospects).toEqual([]);
    const planResponse = await campaignHandler(
      new Request(`http://localhost/api/v1/prospecting-plans/${completedPlans[0]!.id}`),
    );
    expect(planResponse.status).toBe(200);
    const planDetail = (await planResponse.json()) as {
      assessments: Array<{ channel: string; recommendation: string }>;
    };
    expect(planDetail.assessments).toHaveLength(3);
    expect(planDetail.assessments.find((item) => item.channel === "email")).toMatchObject({
      recommendation: "optional",
    });
    const enabledEmail = await campaignHandler(
      new Request(
        `http://localhost/api/v1/prospecting-plans/${completedPlans[0]!.id}/channels/email/actions/enable`,
        { method: "POST" },
      ),
    );
    expect(enabledEmail.status).toBe(201);
    const emailCampaignId = ((await enabledEmail.json()) as { campaignId: string }).campaignId;
    const emailCampaignResponse = await campaignHandler(
      new Request(`http://localhost/api/v1/campaigns/${emailCampaignId}`),
    );
    const emailCampaign = (await emailCampaignResponse.json()) as {
      channel: string;
      steps: Array<{ kind: string }>;
    };
    expect(emailCampaign.channel).toBe("email");
    expect(emailCampaign.steps.map((step) => step.kind)).toEqual(["email", "email", "email"]);
    const emailPolicyResponse = await campaignHandler(
      new Request(`http://localhost/api/v1/campaigns/${emailCampaignId}/autopilot-policy`),
    );
    expect(emailPolicyResponse.status).toBe(200);
    expect(await emailPolicyResponse.json()).toMatchObject({
      editable: true,
      policy: {
        schedule: { activeDays: [1, 2, 3, 4, 5], windowStart: "09:00", windowEnd: "17:00" },
        email: { followUpDelaysBusinessDays: [4, 10], autoReplyEnabled: true },
      },
    });
    const updatedEmailPolicy = await campaignHandler(
      new Request(`http://localhost/api/v1/campaigns/${emailCampaignId}/autopilot-policy`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schedule: { windowStart: "10:00" },
          email: { replyDelayMinutes: 0, followUpDelaysBusinessDays: [3, 8] },
        }),
      }),
    );
    expect(updatedEmailPolicy.status).toBe(200);
    expect(await updatedEmailPolicy.json()).toMatchObject({
      editable: true,
      policy: {
        schedule: { windowStart: "10:00", windowEnd: "17:00" },
        email: { replyDelayMinutes: 0, followUpDelaysBusinessDays: [3, 8] },
      },
    });

    const firstRunId = firstCampaign.discoveryRunId!;
    await new PostgresDiscoveryRepository(database.db).completeRun({
      workspaceId,
      runId: firstRunId,
      now: clock.now(),
      candidates: [{
        id: crypto.randomUUID(),
        fullName: "Marie Durand",
        headline: "Associée · Cabinet Durand",
        linkedinUrl: "https://www.linkedin.com/in/marie-durand/",
        linkedinNormalized: "linkedin.com/in/marie-durand",
        location: "Paris, France",
        companyName: "Cabinet Durand",
        companyWebsite: null,
        companyDomain: null,
        channels: {
          linkedin: {
            value: "https://www.linkedin.com/in/marie-durand/",
            normalizedValue: "linkedin.com/in/marie-durand",
            status: "verified",
            confidence: "high",
            source: "unipile_linkedin_search",
          },
          email: { value: null, normalizedValue: null, status: "unavailable", confidence: "none", source: null },
          whatsapp: { value: null, normalizedValue: null, status: "unavailable", confidence: "none", source: null },
        },
        providerData: { providerId: "linkedin-marie" },
        icpFit: { matches: ["Secteur juridique", "Rôle décideur"], gaps: [] },
      }],
    });
    const [automationJob] = await queue.lease({
      workerId: "campaign-automation-worker",
      types: ["campaign.automation.advance"],
      limit: 1,
      leaseMs: 30_000,
      now: clock.now(),
    });
    expect(automationJob).toBeDefined();
    await new CampaignAutomationJobProcessor(database.db, queue, clock).process(automationJob!);
    const [scoredProspect] = await database.db
      .select()
      .from(campaignProspects)
      .where(and(
        eq(campaignProspects.workspaceId, workspaceId),
        eq(campaignProspects.campaignId, firstCampaign.id),
      ));
    expect(scoredProspect).toMatchObject({
      state: "imported",
      eligible: true,
      scoreVersion: "icp-fit-v1",
    });
    expect(scoredProspect!.score).toBeGreaterThanOrEqual(45);
    expect(scoredProspect!.contactId).not.toBeNull();
    const importedContacts = await database.db
      .select()
      .from(contacts)
      .where(eq(contacts.workspaceId, workspaceId));
    expect(importedContacts).toHaveLength(1);
    const [compositionJob] = await database.db
      .select()
      .from(jobs)
      .where(and(
        eq(jobs.workspaceId, workspaceId),
        eq(jobs.type, "campaign.messages.compose"),
      ));
    expect(compositionJob).toBeDefined();
    const [leasedCompositionJob] = await queue.lease({
      workerId: "campaign-composition-worker",
      types: ["campaign.messages.compose"],
      limit: 1,
      leaseMs: 30_000,
      now: clock.now(),
    });
    expect(leasedCompositionJob).toBeDefined();
    await new CampaignCompositionJobProcessor(
      database.db,
      queue,
      new FixtureCampaignContentGenerator(),
      {
        async resolveHealthyAccount() {
          return { provider: "unipile", accountId: "acc_linkedin_fixture" };
        },
      },
      clock,
    ).process(leasedCompositionJob!);
    const [activatedCampaign] = await database.db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, firstCampaign.id)));
    expect(activatedCampaign).toMatchObject({ status: "active", automationStage: "scheduled" });
    expect(activatedCampaign!.sequenceVersionId).not.toBeNull();
    const enrollments = await database.db
      .select()
      .from(sequenceEnrollments)
      .where(eq(sequenceEnrollments.campaignId, firstCampaign.id));
    expect(enrollments).toHaveLength(1);
    const actions = await database.db
      .select()
      .from(outreachActions)
      .where(eq(outreachActions.campaignId, firstCampaign.id));
    expect(actions).toHaveLength(2);
    expect(actions.every((action) => action.status === "scheduled")).toBe(true);
    expect(actions.map((action) => action.stepKind)).toEqual(["linkedin_invite", "linkedin_message"]);
    expect(actions[0]?.contentSnapshot).toMatchObject({
      recipient: { providerUserId: "linkedin-marie" },
      generation: { promptVersion: "fixture-personalization-v1" },
      schedule: { activeDays: [1, 2, 3, 4, 5], timezone: "Europe/Paris", policyVersion: 1 },
    });
    const lockedPolicyUpdate = await campaignHandler(
      new Request(`http://localhost/api/v1/campaigns/${firstCampaign.id}/autopilot-policy`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schedule: { windowStart: "10:00" } }),
      }),
    );
    expect(lockedPolicyUpdate.status).toBe(409);
    const [dispatchJob] = await database.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.type, "outreach.dispatch")));
    expect(dispatchJob).toBeDefined();
    const [leasedDispatchJob] = await queue.lease({
      workerId: "outreach-dispatch-worker",
      types: ["outreach.dispatch"],
      limit: 1,
      leaseMs: 30_000,
      now: clock.now(),
    });
    expect(leasedDispatchJob).toBeDefined();
    await new OutreachDispatchJobProcessor(
      database.db,
      queue,
      {
        async send() {
          return { providerRequestId: "provider-send-fixture", conversationId: "chat-fixture" };
        },
      },
      clock,
    ).process(leasedDispatchJob!);
    const dispatchedActions = await database.db
      .select()
      .from(outreachActions)
      .where(eq(outreachActions.campaignId, firstCampaign.id));
    expect(dispatchedActions.filter((action) => action.status === "sent")).toHaveLength(1);
    expect(dispatchedActions.filter((action) => action.status === "scheduled")).toHaveLength(1);
    const sentAction = dispatchedActions.find((action) => action.status === "sent")!;
    const sentProspectView = await new PostgresProspectViewRepository(database.db).get({
      workspaceId,
      contactId: sentAction.contactId,
    });
    expect(sentProspectView?.activity).toContainEqual(expect.objectContaining({
      id: sentAction.id,
      source: "outreach_action",
      direction: "outbound",
      status: "sent",
    }));
    const sentProspectList = await new PostgresProspectViewRepository(database.db).list({
      workspaceId,
      limit: 100,
    });
    expect(sentProspectList.data.find((item) => item.id === sentAction.contactId)?.latestActivity)
      .toMatchObject({ source: "outreach_action", direction: "outbound" });
    const attempts = await database.db
      .select()
      .from(outreachAttempts)
      .where(eq(outreachAttempts.workspaceId, workspaceId));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ status: "sent", providerRequestId: "provider-send-fixture" });
    const followUpAction = dispatchedActions.find((action) => action.status === "scheduled");
    expect(followUpAction).toBeDefined();
    const followUpSnapshot = followUpAction!.contentSnapshot as Record<string, unknown>;
    await database.db
      .update(outreachActions)
      .set({
        dueAt: clock.now(),
        contentSnapshot: {
          ...followUpSnapshot,
          schedule: {
            activeDays: [1, 2, 3, 4, 5, 6, 7],
            windowStart: "00:00",
            windowEnd: "23:59",
            timezone: "UTC",
            policyVersion: 1,
          },
        },
      })
      .where(and(eq(outreachActions.workspaceId, workspaceId), eq(outreachActions.id, followUpAction!.id)));
    const dispatchJobs = await database.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.type, "outreach.dispatch")));
    const followUpJobRow = dispatchJobs.find((item) =>
      (item.payload as { actionId?: string }).actionId === followUpAction!.id
    );
    expect(followUpJobRow).toBeDefined();
    await database.db
      .update(jobs)
      .set({ availableAt: clock.now() })
      .where(eq(jobs.id, followUpJobRow!.id));
    const [followUpDispatchJob] = await queue.lease({
      workerId: "outreach-follow-up-worker",
      types: ["outreach.dispatch"],
      limit: 1,
      leaseMs: 30_000,
      now: clock.now(),
    });
    expect(followUpDispatchJob).toBeDefined();
    let generatedFollowUpBody = "";
    await new OutreachDispatchJobProcessor(
      database.db,
      queue,
      {
        async send(request) {
          generatedFollowUpBody = request.body;
          throw new OutboundDeliveryError("FIXTURE_NOT_SENT", "Fixture retry", "not_sent", true);
        },
      },
      clock,
      { linkedin: 20, email: 50, whatsapp: 30 },
      new FixtureCampaignContentGenerator(),
    ).process(followUpDispatchJob!);
    expect(generatedFollowUpBody).toContain("message personnalisé 2");
    const [preparedFollowUp] = await database.db
      .select()
      .from(outreachActions)
      .where(and(eq(outreachActions.workspaceId, workspaceId), eq(outreachActions.id, followUpAction!.id)));
    expect(preparedFollowUp).toMatchObject({ status: "scheduled" });
    expect(preparedFollowUp?.contentSnapshot).toMatchObject({
      generationPending: false,
      generation: { promptVersion: "fixture-personalization-v1" },
    });
    currentTime = new Date(currentTime.getTime() + 1_000);
    const webhookPayload = JSON.stringify({
      event: "message_received",
      account_id: "acc_linkedin_fixture",
      account_type: "LINKEDIN",
      chat_id: "chat-fixture",
      id: "inbound-message-fixture",
      text: "Oui, je veux bien réserver un rendez-vous.",
      sender: { attendee_provider_id: "linkedin-marie" },
      account_info: { user_id: "linkedin-owner" },
      timestamp: clock.now().toISOString(),
    });
    const webhookSecret = "fixture-unipile-webhook-secret";
    const webhookHandler = createUnipileWebhookHttpHandler({
      ingestor: new UnipileWebhookIngestor(database.db, () => clock.now()),
      secret: webhookSecret,
    });
    const unauthorizedWebhook = await webhookHandler(new Request(
      "http://localhost/api/v1/webhooks/unipile",
      { method: "POST", body: webhookPayload },
    ));
    expect(unauthorizedWebhook.status).toBe(401);
    const webhookResponse = await webhookHandler(new Request(
      "http://localhost/api/v1/webhooks/unipile",
      {
        method: "POST",
        headers: { "content-type": "application/json", "unipile-auth": webhookSecret },
        body: webhookPayload,
      },
    ));
    expect(webhookResponse.status).toBe(202);
    const ingested = (await webhookResponse.json()) as { duplicate: boolean; eventId: string };
    expect(ingested.duplicate).toBe(false);
    const duplicateWebhook = await webhookHandler(new Request(
      "http://localhost/api/v1/webhooks/unipile",
      {
        method: "POST",
        headers: { "content-type": "application/json", "unipile-auth": webhookSecret },
        body: webhookPayload,
      },
    ));
    expect(duplicateWebhook.status).toBe(200);
    expect(await duplicateWebhook.json()).toMatchObject({ duplicate: true, eventId: ingested.eventId });
    const [inboundJob] = await queue.lease({
      workerId: "inbound-reply-worker",
      types: ["inbound.reply.process"],
      limit: 1,
      leaseMs: 30_000,
      now: clock.now(),
    });
    expect(inboundJob).toBeDefined();
    await new InboundReplyJobProcessor(
      database.db,
      queue,
      {
        async decide() {
          return {
            intent: "meeting_request",
            confidence: 0.98,
            action: "booking",
            replyBody: "Avec plaisir. Voici mon lien pour choisir un créneau : https://cal.example.com/ignition",
            rationale: "Le prospect demande explicitement un rendez-vous.",
            metadata: { provider: "fixture", model: "k3", promptVersion: "fixture-reply-v1" },
          };
        },
      },
      clock,
      "https://cal.example.com/ignition",
    ).process(inboundJob!);
    const [processedEvent] = await database.db
      .select()
      .from(integrationEvents)
      .where(eq(integrationEvents.id, ingested.eventId));
    expect(processedEvent).toMatchObject({ status: "processed" });
    const persistedConversations = await database.db
      .select()
      .from(conversations)
      .where(eq(conversations.workspaceId, workspaceId));
    expect(persistedConversations).toHaveLength(1);
    const classifications = await database.db
      .select()
      .from(replyClassifications)
      .where(eq(replyClassifications.workspaceId, workspaceId));
    expect(classifications).toHaveLength(1);
    expect(classifications[0]).toMatchObject({ intent: "meeting_request", action: "booking" });
    const scheduledReplies = await database.db
      .select()
      .from(automatedReplies)
      .where(eq(automatedReplies.workspaceId, workspaceId));
    expect(scheduledReplies).toHaveLength(1);
    const pipelineOpportunities = await database.db
      .select()
      .from(opportunities)
      .where(eq(opportunities.workspaceId, workspaceId));
    expect(pipelineOpportunities).toHaveLength(1);
    expect(pipelineOpportunities[0]).toMatchObject({ stage: "meeting_requested" });
    const postReplyActions = await database.db
      .select()
      .from(outreachActions)
      .where(eq(outreachActions.campaignId, firstCampaign.id));
    expect(postReplyActions.filter((action) => action.status === "cancelled")).toHaveLength(1);
    currentTime = new Date(currentTime.getTime() + 1_000);
    const [replySendJob] = await queue.lease({
      workerId: "automated-reply-send-worker",
      types: ["inbound.reply.send"],
      limit: 1,
      leaseMs: 30_000,
      now: clock.now(),
    });
    expect(replySendJob).toBeDefined();
    await new AutomatedReplySendJobProcessor(
      database.db,
      queue,
      {
        async send(request) {
          expect(request.conversationId).toBe("chat-fixture");
          expect(request.replyToProviderMessageId).toBe("inbound-message-fixture");
          return { providerRequestId: "automated-reply-fixture", conversationId: "chat-fixture" };
        },
      },
      clock,
    ).process(replySendJob!);
    const [sentReply] = await database.db
      .select()
      .from(automatedReplies)
      .where(eq(automatedReplies.workspaceId, workspaceId));
    expect(sentReply).toMatchObject({ status: "sent", providerRequestId: "automated-reply-fixture" });
    const conversationMessages = await database.db
      .select()
      .from(messages)
      .where(eq(messages.workspaceId, workspaceId));
    expect(conversationMessages.map((message) => message.direction).sort()).toEqual(["inbound", "outbound"]);
    const engagementResponse = await campaignHandler(
      new Request(`http://localhost/api/v1/campaigns/${firstCampaign.id}/conversations`),
    );
    expect(engagementResponse.status).toBe(200);
    const engagement = (await engagementResponse.json()) as {
      metrics: { targeted: number; contacted: number; replies: number; hot: number; meetings: number };
      prospects: Array<{
        contactId: string;
        conversationId: string;
        state: string;
        lastMessage: { direction: string; body: string };
        decision: { intent: string; confidence: number; action: string; model: string };
        automatedReply: { status: string; body: string };
        relaunchesCancelled: boolean;
        cancelledFollowUps: number;
      }>;
    };
    expect(engagement.metrics).toEqual({
      targeted: 1,
      contacted: 1,
      replies: 1,
      hot: 1,
      meetings: 1,
    });
    expect(engagement.prospects).toHaveLength(1);
    expect(engagement.prospects[0]).toMatchObject({
      state: "meeting",
      lastMessage: { direction: "outbound" },
      decision: {
        intent: "meeting_request",
        confidence: 0.98,
        action: "booking",
        model: "k3",
      },
      automatedReply: { status: "sent" },
      relaunchesCancelled: true,
      cancelledFollowUps: 1,
    });
    const conversationResponse = await campaignHandler(
      new Request(
        `http://localhost/api/v1/campaigns/${firstCampaign.id}/conversations/${engagement.prospects[0]!.conversationId}`,
      ),
    );
    expect(conversationResponse.status).toBe(200);
    const conversation = (await conversationResponse.json()) as {
      messages: Array<{ direction: string; source: string; decision: unknown; automatedReply: unknown }>;
      decision: { intent: string; model: string };
      automatedReply: { status: string };
      relaunchesCancelled: boolean;
      pendingFollowUps: number;
      cancelledFollowUps: number;
      opportunity: { stage: string };
    };
    expect(conversation.messages.map((message) => message.direction)).toEqual([
      "outbound",
      "inbound",
      "outbound",
    ]);
    expect(conversation.messages[0]?.source).toBe("outreach_action");
    expect(conversation.messages[1]?.decision).toMatchObject({ intent: "meeting_request" });
    expect(conversation.messages[1]?.automatedReply).toMatchObject({ status: "sent" });
    expect(conversation).toMatchObject({
      decision: { intent: "meeting_request", model: "k3" },
      automatedReply: { status: "sent" },
      relaunchesCancelled: true,
      pendingFollowUps: 0,
      cancelledFollowUps: 1,
      opportunity: { stage: "meeting_requested" },
    });
    const foreignConversationResponse = await campaignHandler(
      new Request(
        `http://localhost/api/v1/campaigns/${emailCampaignId}/conversations/${engagement.prospects[0]!.conversationId}`,
      ),
    );
    expect(foreignConversationResponse.status).toBe(404);

    currentTime = new Date(currentTime.getTime() + 1_000);
    const secondInboundPayload = JSON.stringify({
      event: "message_received",
      account_id: "acc_linkedin_fixture",
      account_type: "LINKEDIN",
      chat_id: "chat-fixture",
      id: "inbound-message-follow-up",
      text: "Merci, le 4 septembre à partir de 10h30 me convient.",
      sender: { attendee_provider_id: "linkedin-marie" },
      account_info: { user_id: "linkedin-owner" },
      timestamp: clock.now().toISOString(),
    });
    const secondInboundWebhook = await webhookHandler(new Request(
      "http://localhost/api/v1/webhooks/unipile",
      {
        method: "POST",
        headers: { "content-type": "application/json", "unipile-auth": webhookSecret },
        body: secondInboundPayload,
      },
    ));
    expect(secondInboundWebhook.status).toBe(202);
    const [secondInboundJob] = await queue.lease({
      workerId: "inbound-reply-worker-2",
      types: ["inbound.reply.process"],
      limit: 1,
      leaseMs: 30_000,
      now: clock.now(),
    });
    expect(secondInboundJob).toBeDefined();
    await new InboundReplyJobProcessor(
      database.db,
      queue,
      {
        async decide() {
          return {
            intent: "positive",
            confidence: 0.96,
            action: "reply",
            replyBody: "Parfait, je vous confirme le créneau dans quelques instants.",
            rationale: "Le prospect fournit la date et l’heure demandées.",
            metadata: { provider: "fixture", model: "k3", promptVersion: "fixture-reply-v1" },
          };
        },
      },
      clock,
      "https://cal.example.com/ignition",
    ).process(secondInboundJob!);
    const repliesBeforeHuman = await database.db
      .select()
      .from(automatedReplies)
      .where(eq(automatedReplies.workspaceId, workspaceId));
    expect(repliesBeforeHuman.filter((reply) => reply.status === "scheduled")).toHaveLength(1);

    currentTime = new Date(currentTime.getTime() + 1_000);
    const humanOutboundPayload = JSON.stringify({
      event: "message_sent",
      direction: "outbound",
      account_id: "acc_linkedin_fixture",
      account_type: "LINKEDIN",
      chat_id: "chat-fixture",
      id: "human-outbound-fixture",
      text: "Bonjour Marie, je reprends personnellement la conversation.",
      sender: { attendee_provider_id: "linkedin-owner" },
      account_info: { user_id: "linkedin-owner" },
      timestamp: clock.now().toISOString(),
    });
    const humanWebhook = await webhookHandler(new Request(
      "http://localhost/api/v1/webhooks/unipile",
      {
        method: "POST",
        headers: { "content-type": "application/json", "unipile-auth": webhookSecret },
        body: humanOutboundPayload,
      },
    ));
    expect(humanWebhook.status).toBe(202);
    const [humanActivityJob] = await queue.lease({
      workerId: "human-activity-worker",
      types: ["inbound.reply.process"],
      limit: 1,
      leaseMs: 30_000,
      now: clock.now(),
    });
    expect(humanActivityJob).toBeDefined();
    await new InboundReplyJobProcessor(
      database.db,
      queue,
      { async decide() { throw new Error("Human outbound activity must not call K3"); } },
      clock,
      null,
    ).process(humanActivityJob!);
    const repliesAfterHuman = await database.db
      .select()
      .from(automatedReplies)
      .where(eq(automatedReplies.workspaceId, workspaceId));
    expect(repliesAfterHuman.filter((reply) => reply.status === "cancelled")).toHaveLength(1);
    expect(repliesAfterHuman.find((reply) => reply.status === "cancelled")).toMatchObject({
      errorCode: "HUMAN_ACTIVITY_DETECTED",
    });
    const humanMessages = await database.db
      .select()
      .from(messages)
      .where(and(eq(messages.workspaceId, workspaceId), eq(messages.senderType, "human")));
    expect(humanMessages).toHaveLength(1);
    expect(humanMessages[0]).toMatchObject({
      providerMessageId: "human-outbound-fixture",
      direction: "outbound",
    });
    const [cancelledReplyJob] = await queue.lease({
      workerId: "automated-reply-send-worker-2",
      types: ["inbound.reply.send"],
      limit: 1,
      leaseMs: 30_000,
      now: clock.now(),
    });
    expect(cancelledReplyJob).toBeDefined();
    let unexpectedAutomatedSends = 0;
    await new AutomatedReplySendJobProcessor(
      database.db,
      queue,
      {
        async send() {
          unexpectedAutomatedSends += 1;
          return { providerRequestId: "unexpected", conversationId: "chat-fixture" };
        },
      },
      clock,
    ).process(cancelledReplyJob!);
    expect(unexpectedAutomatedSends).toBe(0);

    const suppressions = await database.db
      .select()
      .from(contactSuppressions)
      .where(eq(contactSuppressions.workspaceId, workspaceId));
    expect(suppressions).toHaveLength(0);
    const archivedEmail = await campaignHandler(
      new Request(`http://localhost/api/v1/campaigns/${emailCampaignId}/actions/archive`, {
        method: "POST",
      }),
    );
    expect(archivedEmail.status).toBe(200);
    const deterministicBackfillId = "61586072-f228-2405-5bf7-e2e90c59882a";
    const missingBackfillCampaign = await campaignHandler(
      new Request(`http://localhost/api/v1/campaigns/${deterministicBackfillId}`),
    );
    expect(missingBackfillCampaign.status).toBe(404);

    const report = await repository.getReport(workspaceId, run.snapshot.id);
    expect(report.versions).toHaveLength(5);
  }, 20_000);
});

class V3PublicationFixtureAgents implements ResearchAgentExecutor {
  async execute(stage: ResearchStage, input: AgentStageInput): Promise<AgentExecutionResult> {
    const output = structuredClone(validOutputFor(stage)) as Record<string, any>;
    if (stage === "market_investigation" && input.workItemKey !== "main") {
      output.investigations[0].hypothesisId = input.workItemKey.replace("hypothesis:", "");
    }
    if (stage === "objective_ranking") {
      const base = output.proposals[0];
      output.proposals = Array.from({ length: 5 }, (_, index) => ({
        ...structuredClone(base),
        candidateId: `ICP0${index + 1}`,
        rank: index + 1,
        name: `${base.name} ${index + 1}`,
      }));
      output.coverage.generated = 5;
      output.coverage.scanned = 5;
      output.coverage.investigated = 5;
      output.coverage.sourced = 5;
    }
    return {
      output: output as AgentExecutionResult["output"],
      metadata: {
        provider: "fixture",
        model: "v3-auto-publication",
        promptVersion: "v3-auto-publication",
        parameters: {},
        cost: 0,
        latencyMs: 1,
      },
    };
  }
}

class FixtureChannelStrategyPlanner implements ChannelStrategyPlanner {
  async plan(input: Parameters<ChannelStrategyPlanner["plan"]>[0]) {
    return {
      query: `${input.icpName} ${input.channel}`,
      sourceKinds: input.channel === "linkedin" ? ["linkedin" as const] : ["web" as const],
      rationale: "Fixture channel strategy",
      sampleSize: 10,
    };
  }
}

class FixtureChannelObservationSource implements ChannelObservationSource {
  async observe(input: Parameters<ChannelObservationSource["observe"]>[0]) {
    const metrics = input.channel === "linkedin"
      ? { sampleSize: 10, accountsFound: 5, peopleFound: 6, eligibleIdentities: 5, verifiedIdentities: 4 }
      : input.channel === "email"
        ? { sampleSize: 10, accountsFound: 5, peopleFound: 0, eligibleIdentities: 1, verifiedIdentities: 1 }
        : { sampleSize: 10, accountsFound: 2, peopleFound: 0, eligibleIdentities: 0, verifiedIdentities: 0 };
    return { metrics, evidence: [] };
  }
}

class FixtureCampaignContentGenerator implements CampaignContentGenerator {
  async generate(input: Parameters<CampaignContentGenerator["generate"]>[0]) {
    return {
      steps: input.templateSteps.map((step) => ({
        position: step.position,
        subject: step.subject,
        body: `Bonjour ${input.prospect.firstName}, message personnalisé ${step.position} pour ${input.prospect.companyName}.`,
      })),
      metadata: {
        provider: "fixture",
        model: "fixture-executor",
        promptVersion: "fixture-personalization-v1",
      },
    };
  }
}
