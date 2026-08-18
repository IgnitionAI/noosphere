import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type {
  ProspectDecisionAgent,
  ProspectDecisionState,
} from "@outbound/application/campaigns/prospect-decision";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { Clock } from "@outbound/application/shared/ports";
import { resolveCampaignAutopilotPolicy } from "@outbound/domain/campaigns/campaign-autopilot-policy";
import { evaluateProspectDecisionPolicy } from "@outbound/domain/campaigns/prospect-decision-policy";
import { assertProspectDecisionProposal } from "@outbound/domain/campaigns/prospect-decision";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  approvalItems,
  campaignEnrollments,
  campaigns,
  contactSuppressions,
  contacts,
  conversations,
  enrichmentJobs,
  jobs,
  messages,
  outboxEvents,
  outreachActions,
  prospectDecisions,
} from "@outbound/infrastructure/database/schema";
import { PostgresProspectDecisionScheduler } from "./postgres-prospect-decision-scheduler";

export class ProspectDecisionJobProcessor {
  readonly #scheduler: PostgresProspectDecisionScheduler;

  constructor(
    private readonly database: Database,
    private readonly queue: JobQueue,
    private readonly agent: ProspectDecisionAgent,
    private readonly clock: Clock,
  ) {
    this.#scheduler = new PostgresProspectDecisionScheduler(database, clock);
  }

  async process(job: LeasedJob): Promise<void> {
    const payload = decisionPayload(job.payload);
    const decision = await this.#claim(payload, job);
    if (!decision) {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }

    try {
      const state = await this.#loadState(decision);
      const proposal = assertProspectDecisionProposal(await this.agent.decide(state), this.clock.now());
      const policy = evaluateProspectDecisionPolicy({
        contactStatus: state.contact.status,
        suppressed: state.suppressed,
        campaign: state.campaign
          ? { status: state.campaign.status, executionMode: state.campaign.executionMode }
          : null,
        outreachAction: state.outreachAction
          ? { status: state.outreachAction.status, dueAt: state.outreachAction.dueAt }
          : null,
        now: this.clock.now(),
      }, proposal);

      if (isSimulationOnly(decision.payload)) {
        await this.#finish(decision, proposal, policy, "completed");
        await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
        return;
      }

      if (!policy.allowed && policy.retryAt) {
        await this.database
          .update(prospectDecisions)
          .set({
            status: "pending",
            dueAt: policy.retryAt,
            observation: { summary: proposal.observation },
            proposedAction: proposal.action,
            result: { proposal },
            policyDecision: policy,
            updatedAt: this.clock.now(),
          })
          .where(and(
            eq(prospectDecisions.workspaceId, decision.workspaceId),
            eq(prospectDecisions.id, decision.id),
          ));
        await this.queue.retry({
          jobId: job.id,
          workerId: job.lockedBy,
          availableAt: policy.retryAt,
          errorCode: policy.code,
          errorMessage: policy.reason,
        });
        return;
      }

      await this.#apply({ decision, state, proposal, policy });
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome = await this.queue.retry({
        jobId: job.id,
        workerId: job.lockedBy,
        availableAt: new Date(this.clock.now().getTime() + 30_000 * job.attempts),
        errorCode: "PROSPECT_DECISION_FAILED",
        errorMessage: message,
      });
      await this.database
        .update(prospectDecisions)
        .set({
          status: outcome === "dead_lettered" ? "failed" : "pending",
          attempts: job.attempts,
          lastErrorCode: "PROSPECT_DECISION_FAILED",
          lastErrorMessage: message.slice(0, 4_000),
          completedAt: outcome === "dead_lettered" ? this.clock.now() : null,
          updatedAt: this.clock.now(),
        })
        .where(and(
          eq(prospectDecisions.workspaceId, decision.workspaceId),
          eq(prospectDecisions.id, decision.id),
        ));
    }
  }

  async #claim(input: { workspaceId: string; decisionId: string }, job: LeasedJob) {
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:${input.decisionId}`}, 0))`);
      const [current] = await tx
        .select()
        .from(prospectDecisions)
        .where(and(
          eq(prospectDecisions.workspaceId, input.workspaceId),
          eq(prospectDecisions.id, input.decisionId),
          eq(prospectDecisions.jobId, job.id),
        ))
        .limit(1);
      if (!current || !["pending", "running"].includes(current.status)) return null;
      const [claimed] = await tx
        .update(prospectDecisions)
        .set({
          status: "running",
          attempts: job.attempts,
          startedAt: current.startedAt ?? this.clock.now(),
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: this.clock.now(),
        })
        .where(and(
          eq(prospectDecisions.workspaceId, input.workspaceId),
          eq(prospectDecisions.id, input.decisionId),
        ))
        .returning();
      return claimed ?? null;
    });
  }

  async #loadState(decision: typeof prospectDecisions.$inferSelect): Promise<ProspectDecisionState> {
    const [contact] = await this.database
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, status: contacts.status })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, decision.workspaceId), eq(contacts.id, decision.contactId)))
      .limit(1);
    if (!contact) throw new Error("PROSPECT_DECISION_CONTACT_NOT_FOUND");

    const [campaign] = decision.campaignId
      ? await this.database
          .select({ id: campaigns.id, status: campaigns.status, channel: campaigns.channel, autopilotPolicy: campaigns.autopilotPolicy })
          .from(campaigns)
          .where(and(eq(campaigns.workspaceId, decision.workspaceId), eq(campaigns.id, decision.campaignId)))
          .limit(1)
      : [];
    const [action] = decision.outreachActionId
      ? await this.database
          .select({
            id: outreachActions.id,
            status: outreachActions.status,
            stepPosition: outreachActions.stepPosition,
            stepKind: outreachActions.stepKind,
            channel: outreachActions.channel,
            dueAt: outreachActions.dueAt,
          })
          .from(outreachActions)
          .where(and(
            eq(outreachActions.workspaceId, decision.workspaceId),
            eq(outreachActions.id, decision.outreachActionId),
          ))
          .limit(1)
      : [];
    const latestMessages = await this.database
      .select({ direction: messages.direction, body: messages.body, occurredAt: messages.createdAt })
      .from(messages)
      .innerJoin(
        conversations,
        and(eq(conversations.workspaceId, messages.workspaceId), eq(conversations.id, messages.conversationId)),
      )
      .where(and(
        eq(messages.workspaceId, decision.workspaceId),
        eq(conversations.contactId, decision.contactId),
      ))
      .orderBy(desc(messages.createdAt))
      .limit(20);
    const [sent] = await this.database
      .select({ value: count() })
      .from(outreachActions)
      .where(and(
        eq(outreachActions.workspaceId, decision.workspaceId),
        eq(outreachActions.contactId, decision.contactId),
        eq(outreachActions.status, "sent"),
      ));
    const [suppression] = await this.database
      .select({ id: contactSuppressions.id })
      .from(contactSuppressions)
      .where(and(
        eq(contactSuppressions.workspaceId, decision.workspaceId),
        eq(contactSuppressions.contactId, decision.contactId),
        isNull(contactSuppressions.liftedAt),
      ))
      .limit(1);

    return {
      workspaceId: decision.workspaceId,
      decisionId: decision.id,
      kind: decision.kind,
      reason: decision.reason,
      dueAt: decision.dueAt,
      contact: {
        id: contact.id,
        name: `${contact.firstName} ${contact.lastName}`.trim(),
        status: contact.status,
      },
      campaign: campaign
        ? {
            id: campaign.id,
            status: campaign.status,
            channel: campaign.channel,
            executionMode: resolveCampaignAutopilotPolicy(campaign.autopilotPolicy, campaign.channel ?? "email").executionMode,
          }
        : null,
      outreachAction: action ?? null,
      latestMessages: latestMessages.reverse(),
      sentTouches: sent?.value ?? 0,
      suppressed: Boolean(suppression),
    };
  }

  async #apply(input: {
    decision: typeof prospectDecisions.$inferSelect;
    state: ProspectDecisionState;
    proposal: ReturnType<typeof assertProspectDecisionProposal>;
    policy: ReturnType<typeof evaluateProspectDecisionPolicy>;
  }): Promise<void> {
    const { decision, state, proposal, policy } = input;
    const now = this.clock.now();
    if (!policy.allowed) {
      await this.#finish(decision, proposal, policy, "cancelled");
      return;
    }

    if (proposal.action === "send") {
      if (!decision.outreachActionId || !state.outreachAction) throw new Error("PROSPECT_DECISION_ACTION_MISSING");
      if (policy.requiresApproval) {
        await this.database.transaction(async (tx) => {
          await tx.insert(approvalItems).values({
            id: decision.id,
            workspaceId: decision.workspaceId,
            campaignId: decision.campaignId,
            contactId: decision.contactId,
            itemType: "prospect_decision_send",
            channel: state.outreachAction!.channel,
            stepPosition: state.outreachAction!.stepPosition,
            contentOriginal: { actionId: decision.outreachActionId },
            context: { decisionId: decision.id, actionId: decision.outreachActionId, correlationId: decision.correlationId },
            sourceUpdatedAt: now,
            createdAt: now,
            updatedAt: now,
          }).onConflictDoNothing();
          await tx.update(outreachActions).set({ status: "awaiting_approval", approvalItemId: decision.id, updatedAt: now }).where(and(
            eq(outreachActions.workspaceId, decision.workspaceId),
            eq(outreachActions.id, decision.outreachActionId!),
            eq(outreachActions.status, "scheduled"),
          ));
          await tx.update(prospectDecisions).set({
            status: "awaiting_approval",
            observation: { summary: proposal.observation },
            proposedAction: proposal.action,
            result: { proposal },
            policyDecision: policy,
            completedAt: null,
            updatedAt: now,
          }).where(and(eq(prospectDecisions.workspaceId, decision.workspaceId), eq(prospectDecisions.id, decision.id)));
          await tx.insert(outboxEvents).values({
            id: crypto.randomUUID(),
            workspaceId: decision.workspaceId,
            aggregateType: "ProspectDecision",
            aggregateId: decision.id,
            eventType: "ProspectDecisionAwaitingApproval",
            payload: { decisionId: decision.id, actionId: decision.outreachActionId, correlationId: decision.correlationId },
            availableAt: now,
            createdAt: now,
          });
        });
        return;
      }
      await this.database.transaction(async (tx) => {
        await tx.insert(jobs).values({
          id: crypto.randomUUID(),
          workspaceId: decision.workspaceId,
          type: "outreach.dispatch",
          payload: { workspaceId: decision.workspaceId, actionId: decision.outreachActionId },
          idempotencyKey: `${decision.outreachActionId}:dispatch:v2`,
          correlationId: decision.correlationId,
          maxAttempts: state.outreachAction?.channel === "linkedin"
            && state.outreachAction.stepKind === "linkedin_message"
            ? 90
            : 5,
          priority: decision.priority,
          availableAt: policy.executeAt,
          createdAt: now,
          updatedAt: now,
        }).onConflictDoNothing();
        await this.#finishInTransaction(tx, decision, proposal, policy, "completed", now);
      });
      return;
    }

    if (proposal.action === "wait" || proposal.action === "research") {
      const dueAt = proposal.nextDueAt
        ? new Date(proposal.nextDueAt)
        : new Date(now.getTime() + 60 * 60_000);
      if (proposal.action === "research") {
        const enrichmentJobId = crypto.randomUUID();
        const requestKey = `${decision.id}:research:v1`;
        await this.database.transaction(async (tx) => {
          const [enrichment] = await tx.insert(enrichmentJobs).values({
            id: enrichmentJobId,
            workspaceId: decision.workspaceId,
            entityType: "contact",
            entityId: decision.contactId,
            requestKey,
            correlationId: decision.correlationId,
            provider: "crawler",
            createdAt: now,
            updatedAt: now,
          }).onConflictDoNothing().returning({ id: enrichmentJobs.id, maxAttempts: enrichmentJobs.maxAttempts });
          if (enrichment) {
            await tx.insert(jobs).values({
              id: crypto.randomUUID(),
              workspaceId: decision.workspaceId,
              type: "crm.enrichment.execute",
              payload: { workspaceId: decision.workspaceId, jobId: enrichment.id, contactId: decision.contactId },
              idempotencyKey: requestKey,
              correlationId: decision.correlationId,
              maxAttempts: enrichment.maxAttempts,
              priority: decision.priority,
              availableAt: now,
              createdAt: now,
              updatedAt: now,
            }).onConflictDoNothing();
            await tx.insert(outboxEvents).values({
              id: crypto.randomUUID(),
              workspaceId: decision.workspaceId,
              aggregateType: "EnrichmentJob",
              aggregateId: enrichment.id,
              eventType: "EnrichmentJobRequestedByProspectDecision",
              payload: { jobId: enrichment.id, contactId: decision.contactId, decisionId: decision.id },
              availableAt: now,
              createdAt: now,
            });
          }
        });
      }
      await this.#scheduler.schedule({
        id: crypto.randomUUID(),
        workspaceId: decision.workspaceId,
        contactId: decision.contactId,
        campaignId: decision.campaignId,
        outreachActionId: decision.outreachActionId,
        kind: proposal.action === "research" ? "research_recheck" : "recheck",
        reason: proposal.nextReason?.trim() || proposal.reason,
        dueAt,
        priority: decision.priority,
        maxAttempts: decision.maxAttempts,
        idempotencyKey: `${decision.id}:next:${proposal.action}`,
        correlationId: decision.correlationId,
        payload: { previousDecisionId: decision.id },
      });
      await this.#finish(decision, proposal, policy, "completed");
      return;
    }

    if (proposal.action === "pause" || proposal.action === "stop") {
      await this.database.transaction(async (tx) => {
        await tx.update(outreachActions).set({
          status: "cancelled",
          lastErrorCode: proposal.action === "stop" ? "AGENT_STOPPED" : "AGENT_PAUSED",
          cancelledAt: now,
          updatedAt: now,
        }).where(and(
          eq(outreachActions.workspaceId, decision.workspaceId),
          eq(outreachActions.contactId, decision.contactId),
          inArray(outreachActions.status, ["scheduled", "awaiting_approval", "executing"]),
        ));
        await tx.update(campaignEnrollments).set({ status: "cancelled", completedAt: now }).where(and(
          eq(campaignEnrollments.workspaceId, decision.workspaceId),
          eq(campaignEnrollments.contactId, decision.contactId),
          eq(campaignEnrollments.status, "active"),
        ));
        await this.#finishInTransaction(tx, decision, proposal, policy, "completed", now);
      });
      return;
    }

    if (state.campaign?.executionMode === "live") {
      // A live autopilot has no human approval queue. When the agent cannot
      // safely continue, stop this contact and close the decision instead of
      // leaving the campaign blocked on an operator.
      await this.database.transaction(async (tx) => {
        await tx.update(outreachActions).set({
          status: "cancelled",
          lastErrorCode: "AGENT_HANDOFF_AUTOMATED",
          lastErrorMessage: proposal.reason,
          cancelledAt: now,
          updatedAt: now,
        }).where(and(
          eq(outreachActions.workspaceId, decision.workspaceId),
          eq(outreachActions.contactId, decision.contactId),
          inArray(outreachActions.status, ["scheduled", "awaiting_approval", "executing"]),
        ));
        await tx.update(campaignEnrollments).set({ status: "cancelled", completedAt: now }).where(and(
          eq(campaignEnrollments.workspaceId, decision.workspaceId),
          eq(campaignEnrollments.contactId, decision.contactId),
          eq(campaignEnrollments.status, "active"),
        ));
        await tx.insert(outboxEvents).values({
          id: crypto.randomUUID(),
          workspaceId: decision.workspaceId,
          aggregateType: "ProspectDecision",
          aggregateId: decision.id,
          eventType: "ProspectDecisionAutonomouslyStopped",
          payload: { decisionId: decision.id, contactId: decision.contactId, reason: proposal.reason },
          availableAt: now,
          createdAt: now,
        });
        await this.#finishInTransaction(tx, decision, proposal, policy, "completed", now);
      });
      return;
    }

    await this.database.transaction(async (tx) => {
      await tx.insert(approvalItems).values({
        id: decision.id,
        workspaceId: decision.workspaceId,
        campaignId: decision.campaignId,
        contactId: decision.contactId,
        itemType: "prospect_decision_handoff",
        channel: state.campaign?.channel ?? "internal",
        contentOriginal: { observation: proposal.observation, reason: proposal.reason },
        context: { decisionId: decision.id, correlationId: decision.correlationId },
        sourceUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing();
      await this.#finishInTransaction(tx, decision, proposal, policy, "awaiting_approval", now);
    });
  }

  async #finish(
    decision: typeof prospectDecisions.$inferSelect,
    proposal: ReturnType<typeof assertProspectDecisionProposal>,
    policy: ReturnType<typeof evaluateProspectDecisionPolicy>,
    status: "completed" | "cancelled" | "awaiting_approval",
  ): Promise<void> {
    await this.database.transaction((tx) => this.#finishInTransaction(tx, decision, proposal, policy, status, this.clock.now()));
  }

  async #finishInTransaction(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    decision: typeof prospectDecisions.$inferSelect,
    proposal: ReturnType<typeof assertProspectDecisionProposal>,
    policy: ReturnType<typeof evaluateProspectDecisionPolicy>,
    status: "completed" | "cancelled" | "awaiting_approval",
    now: Date,
  ): Promise<void> {
    await tx.update(prospectDecisions).set({
      status,
      observation: { summary: proposal.observation },
      proposedAction: proposal.action,
      result: { proposal },
      policyDecision: policy,
      completedAt: status === "awaiting_approval" ? null : now,
      invalidatedAt: status === "cancelled" ? now : null,
      updatedAt: now,
    }).where(and(eq(prospectDecisions.workspaceId, decision.workspaceId), eq(prospectDecisions.id, decision.id)));
    await tx.insert(outboxEvents).values({
      id: crypto.randomUUID(),
      workspaceId: decision.workspaceId,
      aggregateType: "ProspectDecision",
      aggregateId: decision.id,
      eventType: status === "cancelled"
        ? "ProspectDecisionBlocked"
        : status === "awaiting_approval"
          ? "ProspectDecisionAwaitingApproval"
          : "ProspectDecisionCompleted",
      payload: {
        decisionId: decision.id,
        contactId: decision.contactId,
        action: proposal.action,
        status,
        correlationId: decision.correlationId,
      },
      availableAt: now,
      createdAt: now,
    });
  }
}

function decisionPayload(value: unknown): { workspaceId: string; decisionId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_PROSPECT_DECISION_JOB");
  const payload = value as Record<string, unknown>;
  if (typeof payload.workspaceId !== "string" || typeof payload.decisionId !== "string") {
    throw new Error("INVALID_PROSPECT_DECISION_JOB");
  }
  return { workspaceId: payload.workspaceId, decisionId: payload.decisionId };
}

function isSimulationOnly(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).simulationOnly === true);
}
