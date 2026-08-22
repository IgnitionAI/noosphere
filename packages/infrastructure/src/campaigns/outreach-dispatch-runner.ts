import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type {
  OutboundChannelGateway,
  OutboundSendRequest,
} from "@outbound/application/campaigns/outbound-channel-gateway";
import type { CampaignContentGenerator } from "@outbound/application/campaigns/campaign-content-generator";
import type { CampaignEditorialContextReader } from "@outbound/application/campaigns/campaign-content-generator";
import { OutboundDeliveryError } from "@outbound/application/campaigns/outbound-channel-gateway";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { Clock } from "@outbound/application/shared/ports";
import type { WhatsappReachabilityResolver } from "@outbound/application/crm/whatsapp-sourcing-ports";
import { deriveCampaignExecutionState } from "@outbound/domain/campaigns/campaign-automation-health";
import { nextAllowedCampaignSendAt, type CampaignSendSchedule } from "@outbound/domain/campaigns/campaign-autopilot-policy";
import { resolveCampaignAutopilotPolicy } from "@outbound/domain/campaigns/campaign-autopilot-policy";
import { fitSequenceStepContent, validateSequenceSteps, type SequenceStepInput } from "@outbound/domain/campaigns/sequence-validation";
import { requiresEditorialRegeneration } from "@outbound/domain/campaigns/campaign-editorial-context";
import { startOfWorkspaceDay } from "@outbound/domain/workspaces/workspace-data-policy";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  campaigns,
  campaignProspects,
  contacts,
  contactIdentities,
  contactSuppressions,
  icpVersions,
  outboxEvents,
  outreachActions,
  outreachAttempts,
  prospectDiscoveryCandidates,
  campaignEnrollments,
  connectedAccounts,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { suppressionFingerprint } from "@outbound/infrastructure/crm/suppression-fingerprint";
import { PostgresCampaignEditorialContextReader } from "./postgres-campaign-editorial-context";

export interface OutreachDispatchLimits {
  readonly linkedin: number;
  readonly email: number;
  readonly whatsapp: number;
}

export interface WorkspaceDispatchPolicyReader {
  readDispatchPolicy(workspaceId: string): Promise<{ limits: OutreachDispatchLimits; timezone: string }>;
}

export interface OutboundSenderReadiness {
  resolveHealthyAccount(workspaceId: string, channel: ClaimedAction["channel"]): Promise<{
    readonly accountId: string;
  }>;
}

export class OutreachDispatchJobProcessor {
  readonly #editorialContext: CampaignEditorialContextReader;

  constructor(
    private readonly database: Database,
    private readonly queue: JobQueue,
    private readonly gateway: OutboundChannelGateway,
    private readonly clock: Clock,
    private readonly limits: OutreachDispatchLimits = { linkedin: 20, email: 50, whatsapp: 30 },
    private readonly generator?: CampaignContentGenerator,
    private readonly reachabilityResolver?: (workspaceId: string) => WhatsappReachabilityResolver,
    private readonly workspacePolicy?: WorkspaceDispatchPolicyReader,
    private readonly senderReadiness?: OutboundSenderReadiness,
    editorialContext?: CampaignEditorialContextReader,
  ) {
    this.#editorialContext = editorialContext ?? new PostgresCampaignEditorialContextReader(database);
  }

  async process(job: LeasedJob): Promise<void> {
    const payload = actionPayload(job.payload);
    const claimed = await this.#claim(payload, job.lockedBy);
    if (!claimed) {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    if (claimed.recoveredUnknownExecution) {
      await this.#failUnknown(claimed, "ACTION_EXECUTION_STATE_UNKNOWN", "Une exécution précédente a perdu son lease après le début de l’envoi.");
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    let preparedSnapshot: unknown;
    try {
      preparedSnapshot = await this.#prepareContentIfNeeded(claimed);
    } catch (error) {
      await this.#retryPreparation(claimed, job, error);
      return;
    }
    const content = readContentSnapshot(preparedSnapshot);
    if (!content) {
      await this.#failUnknown(claimed, "INVALID_CONTENT_SNAPSHOT", "Le snapshot du message est invalide.");
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    if (claimed.enrollmentStatus !== "active") {
      await this.#skip(claimed, "ENROLLMENT_NOT_ACTIVE");
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    const schedule = readScheduleSnapshot(preparedSnapshot);
    if (schedule) {
      const nextWindow = nextAllowedCampaignSendAt({
        from: this.clock.now(),
        delayBusinessDays: 0,
        schedule: {
          activeDays: schedule.activeDays,
          windowStart: schedule.windowStart,
          windowEnd: schedule.windowEnd,
          timezoneMode: "recipient",
          fallbackTimezone: schedule.timezone,
        },
        recipientTimezone: schedule.timezone,
      });
      if (nextWindow.getTime() > this.clock.now().getTime() + 1_000) {
        await this.#defer(claimed, job, nextWindow, "OUTSIDE_SENDING_WINDOW", "Action reportée au prochain créneau du destinataire.");
        return;
      }
    }
    const previousStep = await this.#previousStepBlocker(claimed);
    if (previousStep?.terminal) {
      await this.#skip(claimed, "PREVIOUS_STEP_NOT_SENT");
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    if (previousStep) {
      const availableAt = new Date(Math.max(
        this.clock.now().getTime() + 5 * 60_000,
        previousStep.dueAt.getTime() + 60_000,
      ));
      await this.#defer(claimed, job, availableAt, "PREVIOUS_STEP_PENDING", "La séquence attend la livraison de l’étape précédente.");
      return;
    }
    if (await this.#isSuppressed(claimed, content.recipient.normalizedValue)) {
      await this.#skip(claimed, "CONTACT_SUPPRESSED");
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    let deliveryAction = claimed.channel === "whatsapp"
      ? await this.#revalidateWhatsapp(claimed, content.recipient.normalizedValue, job)
      : claimed;
    if (!deliveryAction) return;
    if (this.senderReadiness) {
      try {
        const sender = await this.senderReadiness.resolveHealthyAccount(deliveryAction.workspaceId, deliveryAction.channel);
        if (sender.accountId !== deliveryAction.providerAccountId) {
          deliveryAction = await this.#rebindSenderAccount(deliveryAction, sender.accountId);
        }
      } catch {
        await this.#defer(
          deliveryAction,
          job,
          new Date(this.clock.now().getTime() + 15 * 60_000),
          "SENDER_UNAVAILABLE",
          "Aucun compte d’envoi sain n’est disponible pour ce canal.",
        );
        return;
      }
    }
    if (await this.#dailyLimitReached(deliveryAction)) {
      const availableAt = schedule
        ? nextAllowedCampaignSendAt({
            from: this.clock.now(),
            delayBusinessDays: 1,
            schedule: {
              activeDays: schedule.activeDays,
              windowStart: schedule.windowStart,
              windowEnd: schedule.windowEnd,
              timezoneMode: "recipient",
              fallbackTimezone: schedule.timezone,
            },
            recipientTimezone: schedule.timezone,
          })
        : tomorrowMorning(this.clock.now());
      await this.database
        .update(outreachActions)
        .set({
          status: "scheduled",
          dueAt: availableAt,
          lockedAt: null,
          lockedUntil: null,
          lockedBy: null,
          lastErrorCode: "DAILY_CHANNEL_LIMIT",
          lastErrorMessage: "Action reportée automatiquement au prochain créneau.",
          updatedAt: this.clock.now(),
        })
        .where(and(eq(outreachActions.workspaceId, claimed.workspaceId), eq(outreachActions.id, claimed.id)));
      await this.queue.defer({
        jobId: job.id,
        workerId: job.lockedBy,
        availableAt,
        errorCode: "DAILY_CHANNEL_LIMIT",
        errorMessage: "Daily channel limit reached",
      });
      return;
    }
    const attemptId = crypto.randomUUID();
    const sendOutcome = await this.#sendWithFinalGate(
      deliveryAction,
      content.recipient.normalizedValue,
      attemptId,
      job.attempts,
      {
        accountId: deliveryAction.providerAccountId,
        channel: claimed.channel,
        stepKind: claimed.stepKind,
        recipient: content.recipient,
        subject: content.subject,
        body: content.body,
        idempotencyKey: claimed.idempotencyKey,
      },
    );
    if (sendOutcome.kind === "blocked") {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    if (sendOutcome.kind === "sent") {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    const error = sendOutcome.error;
    {
      if (
        error instanceof OutboundDeliveryError &&
        error.deliveryState === "not_sent" &&
        error.retryable
      ) {
        const waitMs = providerWaitDurationMs(error.code);
        const retryAt = new Date(this.clock.now().getTime() + (waitMs ?? 60_000 * job.attempts));
        await this.#resetForRetry(claimed, attemptId, error, retryAt);
        if (waitMs !== null) {
          await this.queue.defer({
            jobId: job.id,
            workerId: job.lockedBy,
            availableAt: retryAt,
            errorCode: error.code,
            errorMessage: error.message,
          });
          return;
        }
        await this.queue.retry({
          jobId: job.id,
          workerId: job.lockedBy,
          availableAt: retryAt,
          errorCode: error.code,
          errorMessage: error.message,
        });
        return;
      }
      const deliveryError = error instanceof OutboundDeliveryError
        ? error
        : new OutboundDeliveryError(
            "OUTBOUND_DELIVERY_UNKNOWN",
            error instanceof Error ? error.message : String(error),
            "unknown",
            false,
          );
      await this.#failUnknown(claimed, deliveryError.code, deliveryError.message, attemptId);
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
    }
  }

  async #revalidateWhatsapp(
    action: ClaimedAction,
    e164: string,
    job: LeasedJob,
  ): Promise<ClaimedAction | null> {
    if (!this.reachabilityResolver) {
      await this.#defer(
        action,
        job,
        new Date(this.clock.now().getTime() + 15 * 60_000),
        "WHATSAPP_REVALIDATION_UNAVAILABLE",
        "La vérification WhatsApp avant envoi est temporairement indisponible.",
      );
      return null;
    }
    const result = await this.reachabilityResolver(action.workspaceId).resolve({
      workspaceId: action.workspaceId,
      phone: e164,
      e164,
      sourcingCycleId: null,
      now: this.clock.now(),
    });
    if (result.status === "not_registered") {
      await this.#skip(action, "WHATSAPP_NOT_REACHABLE");
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return null;
    }
    if (result.status !== "verified" || !result.providerAccountId) {
      const reconnect = result.errorCode === "WHATSAPP_ACCOUNT_DISCONNECTED";
      await this.#defer(
        action,
        job,
        new Date(this.clock.now().getTime() + (reconnect ? 60 : 15) * 60_000),
        reconnect ? "WHATSAPP_ACCOUNT_RECONNECT_REQUIRED" : "WHATSAPP_REVALIDATION_PENDING",
        reconnect
          ? "Le compte WhatsApp doit être reconnecté avant l’envoi."
          : "La vérification WhatsApp sera retentée automatiquement avant l’envoi.",
      );
      return null;
    }
    if (result.providerAccountId !== action.providerAccountId) {
      await this.database
        .update(outreachActions)
        .set({ providerAccountId: result.providerAccountId, updatedAt: this.clock.now() })
        .where(and(eq(outreachActions.workspaceId, action.workspaceId), eq(outreachActions.id, action.id)));
      return { ...action, providerAccountId: result.providerAccountId };
    }
    return action;
  }

  async #claim(input: { workspaceId: string; actionId: string }, workerId: string) {
    return this.database.transaction(async (tx) => {
      const [existing] = await tx
        .select({ status: outreachActions.status })
        .from(outreachActions)
        .where(and(eq(outreachActions.workspaceId, input.workspaceId), eq(outreachActions.id, input.actionId)))
        .limit(1);
      if (!existing || ["sent", "failed", "skipped", "cancelled"].includes(existing.status)) return null;
      if (existing.status === "executing") {
        const row = await loadClaimedAction(tx, input);
        return row ? { ...row, recoveredUnknownExecution: true as const } : null;
      }
      const now = this.clock.now();
      const [updated] = await tx
        .update(outreachActions)
        .set({
          status: "executing",
          lockedAt: now,
          lockedUntil: new Date(now.getTime() + 60_000),
          lockedBy: workerId,
          updatedAt: now,
        })
        .where(
          and(
            eq(outreachActions.workspaceId, input.workspaceId),
            eq(outreachActions.id, input.actionId),
            eq(outreachActions.status, "scheduled"),
          ),
        )
        .returning({ id: outreachActions.id });
      if (!updated) return null;
      const row = await loadClaimedAction(tx, input);
      return row ? { ...row, recoveredUnknownExecution: false as const } : null;
    });
  }

  async #isSuppressed(action: ClaimedAction, normalizedValue: string): Promise<boolean> {
    const identityFingerprint = suppressionFingerprint({
      workspaceId: action.workspaceId,
      identityType: action.channel === "whatsapp" ? "whatsapp" : action.channel,
      normalizedValue,
    });
    const [row] = await this.database
      .select({ id: contactSuppressions.id })
      .from(contactSuppressions)
      .where(
        and(
          eq(contactSuppressions.workspaceId, action.workspaceId),
          inArray(contactSuppressions.channel, ["global", action.channel]),
          or(
            eq(contactSuppressions.contactId, action.contactId),
            eq(contactSuppressions.normalizedValue, normalizedValue),
            eq(contactSuppressions.identityFingerprint, identityFingerprint),
          ),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async #dailyLimitReached(action: ClaimedAction): Promise<boolean> {
    const policy = this.workspacePolicy
      ? await this.workspacePolicy.readDispatchPolicy(action.workspaceId)
      : { limits: this.limits, timezone: "UTC" };
    const start = startOfWorkspaceDay(this.clock.now(), policy.timezone);
    const sent = await this.database
      .select({ id: outreachActions.id })
      .from(outreachActions)
      .where(
        and(
          eq(outreachActions.workspaceId, action.workspaceId),
          eq(outreachActions.providerAccountId, action.providerAccountId),
          eq(outreachActions.channel, action.channel),
          eq(outreachActions.status, "sent"),
          gte(outreachActions.sentAt, start),
        ),
      );
    return sent.length >= policy.limits[action.channel];
  }

  async #rebindSenderAccount(action: ClaimedAction, providerAccountId: string): Promise<ClaimedAction> {
    const [connectedAccount] = await this.database
      .select({ id: connectedAccounts.id })
      .from(connectedAccounts)
      .where(and(
        eq(connectedAccounts.workspaceId, action.workspaceId),
        eq(connectedAccounts.provider, "unipile"),
        eq(connectedAccounts.providerAccountId, providerAccountId),
        eq(connectedAccounts.status, "connected"),
      ))
      .limit(1);
    await this.database
      .update(outreachActions)
      .set({
        providerAccountId,
        connectedAccountId: connectedAccount?.id ?? null,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: this.clock.now(),
      })
      .where(and(
        eq(outreachActions.workspaceId, action.workspaceId),
        eq(outreachActions.id, action.id),
        eq(outreachActions.status, "executing"),
      ));
    return {
      ...action,
      providerAccountId,
      connectedAccountId: connectedAccount?.id ?? null,
    };
  }

  async #sendWithFinalGate(
    action: ClaimedAction,
    normalizedRecipient: string,
    attemptId: string,
    attemptNumber: number,
    request: OutboundSendRequest,
  ): Promise<
    | { readonly kind: "blocked" }
    | { readonly kind: "sent" }
    | { readonly kind: "error"; readonly error: unknown }
  > {
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${action.workspaceId}:${action.contactId}:outbound`}, 0))`);
      if (!await this.#finalSendGate(tx, action, normalizedRecipient)) return { kind: "blocked" as const };
      // Persist the provider-call marker on an independent connection. If the
      // worker dies during the external call, this row must survive the outer
      // transaction rollback so reconciliation can fail closed with evidence.
      await this.database.insert(outreachAttempts).values({
        id: attemptId,
        workspaceId: action.workspaceId,
        actionId: action.id,
        outreachActionId: action.id,
        attempt: attemptNumber,
        attemptNumber,
        status: "executing",
        startedAt: this.clock.now(),
        attemptedAt: this.clock.now(),
      }).onConflictDoNothing();
      try {
        const result = await this.gateway.send(request);
        await this.#markSent(tx, action, attemptId, result);
        return { kind: "sent" as const };
      } catch (error) {
        return { kind: "error" as const, error };
      }
    });
  }

  async #finalSendGate(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    action: ClaimedAction,
    normalizedRecipient: string,
  ): Promise<boolean> {
      const [current] = await tx
        .select({
          actionStatus: outreachActions.status,
          enrollmentStatus: campaignEnrollments.status,
          campaignStatus: campaigns.status,
          campaignChannel: campaigns.channel,
          campaignPolicy: campaigns.autopilotPolicy,
          contactStatus: contacts.status,
          workspaceStatus: workspaces.status,
        })
        .from(outreachActions)
        .innerJoin(
          campaignEnrollments,
          and(eq(campaignEnrollments.workspaceId, outreachActions.workspaceId), eq(campaignEnrollments.id, outreachActions.enrollmentId)),
        )
        .innerJoin(
          campaigns,
          and(eq(campaigns.workspaceId, outreachActions.workspaceId), eq(campaigns.id, outreachActions.campaignId)),
        )
        .innerJoin(
          contacts,
          and(eq(contacts.workspaceId, outreachActions.workspaceId), eq(contacts.id, outreachActions.contactId)),
        )
        .innerJoin(workspaces, eq(workspaces.id, outreachActions.workspaceId))
        .where(and(eq(outreachActions.workspaceId, action.workspaceId), eq(outreachActions.id, action.id)))
        .limit(1);
      const [suppression] = await tx
        .select({ id: contactSuppressions.id })
        .from(contactSuppressions)
        .where(and(
          eq(contactSuppressions.workspaceId, action.workspaceId),
          inArray(contactSuppressions.channel, ["global", action.channel]),
          isNull(contactSuppressions.liftedAt),
          or(
            eq(contactSuppressions.contactId, action.contactId),
            eq(contactSuppressions.normalizedValue, normalizedRecipient),
          ),
        ))
        .limit(1);
      const [invalidIdentity] = await tx
        .select({ id: contactIdentities.id })
        .from(contactIdentities)
        .where(and(
          eq(contactIdentities.workspaceId, action.workspaceId),
          eq(contactIdentities.contactId, action.contactId),
          eq(contactIdentities.normalizedValue, normalizedRecipient),
          eq(contactIdentities.verificationStatus, "invalid"),
        ))
        .limit(1);
      const campaignPolicy = current
        ? resolveCampaignAutopilotPolicy(current.campaignPolicy, current.campaignChannel ?? action.channel)
        : null;
      if (
        current?.actionStatus === "executing"
        && current.enrollmentStatus === "active"
        && current.campaignStatus === "active"
        && current.contactStatus === "active"
        && current.workspaceStatus === "active"
        && campaignPolicy?.enabled === true
        && campaignPolicy.executionMode === "live"
        && !suppression
        && !invalidIdentity
      ) return true;

      const blockCode = suppression
        ? "CONTACT_SUPPRESSED"
        : invalidIdentity
          ? "RECIPIENT_IDENTITY_INVALID"
          : campaignPolicy?.executionMode !== "live"
            ? "CAMPAIGN_DRY_RUN"
            : "FINAL_POLICY_GATE_BLOCKED";
      const [blocked] = await tx.update(outreachActions).set({
        status: current?.actionStatus === "cancelled" ? "cancelled" : "skipped",
        lastErrorCode: current?.actionStatus === "cancelled" ? "PROSPECT_REPLIED" : blockCode,
        lockedAt: null,
        lockedUntil: null,
        lockedBy: null,
        updatedAt: this.clock.now(),
      }).where(and(
        eq(outreachActions.workspaceId, action.workspaceId),
        eq(outreachActions.id, action.id),
        inArray(outreachActions.status, ["scheduled", "executing", "cancelled"]),
      )).returning({ id: outreachActions.id });
      if (blocked) {
        await tx.insert(outboxEvents).values({
          id: crypto.randomUUID(),
          workspaceId: action.workspaceId,
          aggregateType: "OutreachAction",
          aggregateId: action.id,
          eventType: "OutreachActionBlockedByFinalPolicyGate",
          payload: { actionId: action.id, campaignId: action.campaignId, contactId: action.contactId, code: blockCode },
          availableAt: this.clock.now(),
          createdAt: this.clock.now(),
        });
      }
      return false;
  }

  async #prepareContentIfNeeded(action: ClaimedAction): Promise<unknown> {
    const snapshot = recordValue(action.contentSnapshot);
    if (!snapshot) return action.contentSnapshot;
    const generation = recordValue(snapshot.generation);
    const needsGeneration = requiresEditorialRegeneration({
      generationPending: snapshot.generationPending === true,
      promptVersion: typeof generation?.promptVersion === "string" ? generation.promptVersion : null,
    });
    if (!needsGeneration) return action.contentSnapshot;
    if (!this.generator) throw new Error("CAMPAIGN_JIT_GENERATOR_UNAVAILABLE");
    const template = readTemplateSnapshot(snapshot.template);
    if (!template) throw new Error("CAMPAIGN_JIT_TEMPLATE_INVALID");
    const [context] = await this.database
      .select({
        autopilotPolicy: campaigns.autopilotPolicy,
        icpName: icpVersions.name,
        problems: icpVersions.problems,
        signals: icpVersions.signals,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        headline: prospectDiscoveryCandidates.headline,
        companyName: prospectDiscoveryCandidates.companyName,
        location: prospectDiscoveryCandidates.location,
        score: campaignProspects.score,
        scoreExplanation: campaignProspects.scoreExplanation,
        providerData: prospectDiscoveryCandidates.providerData,
      })
      .from(outreachActions)
      .innerJoin(campaigns, and(
        eq(campaigns.workspaceId, outreachActions.workspaceId),
        eq(campaigns.id, outreachActions.campaignId),
      ))
      .innerJoin(icpVersions, and(
        eq(icpVersions.workspaceId, campaigns.workspaceId),
        eq(icpVersions.id, campaigns.icpVersionId),
      ))
      .innerJoin(campaignProspects, and(
        eq(campaignProspects.workspaceId, outreachActions.workspaceId),
        eq(campaignProspects.campaignId, outreachActions.campaignId),
        eq(campaignProspects.candidateId, outreachActions.candidateId),
      ))
      .innerJoin(prospectDiscoveryCandidates, and(
        eq(prospectDiscoveryCandidates.workspaceId, campaignProspects.workspaceId),
        eq(prospectDiscoveryCandidates.id, campaignProspects.candidateId),
      ))
      .innerJoin(contacts, and(
        eq(contacts.workspaceId, campaignProspects.workspaceId),
        eq(contacts.id, campaignProspects.contactId),
      ))
      .where(and(eq(outreachActions.workspaceId, action.workspaceId), eq(outreachActions.id, action.id)))
      .limit(1);
    if (!context) throw new Error("CAMPAIGN_JIT_CONTEXT_MISSING");
    const policy = resolveCampaignAutopilotPolicy(context.autopilotPolicy, action.channel);
    const [actionCount] = await this.database
      .select({ value: sql<number>`count(*)::int` })
      .from(outreachActions)
      .where(and(
        eq(outreachActions.workspaceId, action.workspaceId),
        eq(outreachActions.enrollmentId, action.enrollmentId),
      ));
    const editorial = await this.#editorialContext.read({
      workspaceId: action.workspaceId,
      campaignId: action.campaignId,
      contactId: action.contactId,
      step: template,
      totalSteps: actionCount?.value ?? template.position,
      prospectEvidence: {
        publicData: context.providerData,
        scoreFactors: context.scoreExplanation,
      },
    });
    const generated = await this.generator.generate({
      workspaceId: action.workspaceId,
      channel: action.channel,
      campaignObjective: editorial.campaignObjective,
      icpName: context.icpName,
      problems: context.problems,
      signals: context.signals,
      offer: editorial.offer,
      previousMessages: editorial.previousMessages,
      stepObjective: editorial.stepObjective,
      policy: action.channel === "email"
        ? {
            language: policy.email.language,
            firstMessageInstructions: policy.email.firstMessageInstructions,
            followUpInstructions: policy.email.followUpInstructions,
          }
        : null,
      prospect: {
        firstName: context.firstName,
        lastName: context.lastName,
        headline: context.headline,
        companyName: context.companyName ?? "Entreprise",
        location: context.location,
        score: context.score ?? 0,
        scoreExplanation: context.scoreExplanation,
        evidence: editorial.prospectEvidence,
      },
      templateSteps: [template],
    });
    const generatedStep = generated.steps.find((step) => step.position === template.position);
    if (!generatedStep) throw new Error("CAMPAIGN_JIT_STEP_MISSING");
    const personalized = fitSequenceStepContent({
      ...template,
      subject: generatedStep.subject,
      body: generatedStep.body,
    });
    const validation = validateSequenceSteps([personalized]);
    if (validation.length) throw new Error(`CAMPAIGN_JIT_STEP_INVALID:${JSON.stringify(validation)}`);
    const updated = {
      ...snapshot,
      subject: personalized.subject,
      body: personalized.body,
      generation: generated.metadata,
      generationPending: false,
    };
    await this.database
      .update(outreachActions)
      .set({ contentSnapshot: updated, updatedAt: this.clock.now() })
      .where(and(eq(outreachActions.workspaceId, action.workspaceId), eq(outreachActions.id, action.id)));
    return updated;
  }

  async #retryPreparation(action: ClaimedAction, job: LeasedJob, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const availableAt = new Date(this.clock.now().getTime() + 60_000 * job.attempts);
    await this.database
      .update(outreachActions)
      .set({
        status: "scheduled",
        lockedAt: null,
        lockedUntil: null,
        lockedBy: null,
        lastErrorCode: "CAMPAIGN_JIT_GENERATION_FAILED",
        lastErrorMessage: message.slice(0, 4_000),
        updatedAt: this.clock.now(),
      })
      .where(and(eq(outreachActions.workspaceId, action.workspaceId), eq(outreachActions.id, action.id)));
    const outcome = await this.queue.retry({
      jobId: job.id,
      workerId: job.lockedBy,
      availableAt,
      errorCode: "CAMPAIGN_JIT_GENERATION_FAILED",
      errorMessage: message,
    });
    if (outcome === "dead_lettered") {
      await this.#failUnknown(action, "CAMPAIGN_JIT_GENERATION_FAILED", message);
    }
  }

  async #previousStepBlocker(action: ClaimedAction): Promise<{
    terminal: boolean;
    dueAt: Date;
  } | null> {
    const rows = await this.database
      .select({ status: outreachActions.status, dueAt: outreachActions.dueAt })
      .from(outreachActions)
      .where(and(
        eq(outreachActions.workspaceId, action.workspaceId),
        eq(outreachActions.enrollmentId, action.enrollmentId),
        lt(outreachActions.stepPosition, action.stepPosition),
      ))
      .orderBy(asc(outreachActions.stepPosition));
    const blocker = rows.find((row) => row.status !== "sent");
    if (!blocker) return null;
    return {
      terminal: ["failed", "skipped", "cancelled"].includes(blocker.status),
      dueAt: blocker.dueAt,
    };
  }

  async #defer(
    action: ClaimedAction,
    job: LeasedJob,
    availableAt: Date,
    code: string,
    message: string,
  ) {
    await this.database
      .update(outreachActions)
      .set({
        status: "scheduled",
        dueAt: availableAt,
        lockedAt: null,
        lockedUntil: null,
        lockedBy: null,
        lastErrorCode: code,
        lastErrorMessage: message,
        updatedAt: this.clock.now(),
      })
      .where(and(eq(outreachActions.workspaceId, action.workspaceId), eq(outreachActions.id, action.id)));
    await this.queue.defer({
      jobId: job.id,
      workerId: job.lockedBy,
      availableAt,
      errorCode: code,
      errorMessage: message,
    });
  }

  async #markSent(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    action: ClaimedAction,
    attemptId: string,
    result: { providerRequestId: string; conversationId: string | null },
  ) {
    const now = this.clock.now();
      await tx
        .update(outreachAttempts)
        .set({ status: "sent", providerRequestId: result.providerRequestId })
        .where(and(eq(outreachAttempts.workspaceId, action.workspaceId), eq(outreachAttempts.id, attemptId)));
      await tx
        .update(outreachActions)
        .set({
          status: "sent",
          providerRequestId: result.providerRequestId,
          sentAt: now,
          lockedAt: null,
          lockedUntil: null,
          lockedBy: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: now,
        })
        .where(and(eq(outreachActions.workspaceId, action.workspaceId), eq(outreachActions.id, action.id)));
      const remainingEnrollmentActions = await tx
        .select({ id: outreachActions.id })
        .from(outreachActions)
        .where(
          and(
            eq(outreachActions.workspaceId, action.workspaceId),
            eq(outreachActions.enrollmentId, action.enrollmentId),
            inArray(outreachActions.status, ["scheduled", "executing"]),
          ),
        );
      if (!remainingEnrollmentActions.length) {
        await tx
          .update(campaignEnrollments)
          .set({ status: "completed", completedAt: now })
          .where(and(eq(campaignEnrollments.workspaceId, action.workspaceId), eq(campaignEnrollments.id, action.enrollmentId)));
      }
      const remainingCampaignActions = await tx
        .select({ id: outreachActions.id })
        .from(outreachActions)
        .where(
          and(
            eq(outreachActions.workspaceId, action.workspaceId),
            eq(outreachActions.campaignId, action.campaignId),
            inArray(outreachActions.status, ["scheduled", "executing"]),
          ),
        );
      const [latestFailedAction] = await tx
        .select({
          code: outreachActions.lastErrorCode,
          message: outreachActions.lastErrorMessage,
        })
        .from(outreachActions)
        .where(and(
          eq(outreachActions.workspaceId, action.workspaceId),
          eq(outreachActions.campaignId, action.campaignId),
          eq(outreachActions.status, "failed"),
        ))
        .orderBy(desc(outreachActions.updatedAt))
        .limit(1);
      const campaignState = deriveCampaignExecutionState({
        pendingActionCount: remainingCampaignActions.length,
        latestFailedAction: latestFailedAction ?? null,
      });
      await tx
        .update(campaigns)
        .set({
          status: campaignState.campaignStatus,
          automationStage: campaignState.automationStage,
          automationErrorCode: campaignState.automationErrorCode,
          automationErrorMessage: campaignState.automationErrorMessage,
          updatedAt: now,
        })
        .where(and(eq(campaigns.workspaceId, action.workspaceId), eq(campaigns.id, action.campaignId)));
      await tx.insert(outboxEvents).values({
        workspaceId: action.workspaceId,
        aggregateType: "OutreachAction",
        aggregateId: action.id,
        eventType: "OutreachActionSent",
        payload: {
          actionId: action.id,
          campaignId: action.campaignId,
          providerRequestId: result.providerRequestId,
          conversationId: result.conversationId,
        },
      });
  }

  async #resetForRetry(
    action: ClaimedAction,
    attemptId: string,
    error: OutboundDeliveryError,
    dueAt: Date,
  ) {
    await this.database.transaction(async (tx) => {
      await tx
        .update(outreachAttempts)
        .set({ status: "retry", errorCode: error.code, errorMessage: error.message })
        .where(and(eq(outreachAttempts.workspaceId, action.workspaceId), eq(outreachAttempts.id, attemptId)));
      await tx
        .update(outreachActions)
        .set({
          status: "scheduled",
          dueAt,
          lockedAt: null,
          lockedUntil: null,
          lockedBy: null,
          lastErrorCode: error.code,
          lastErrorMessage: error.message,
          updatedAt: this.clock.now(),
        })
        .where(and(eq(outreachActions.workspaceId, action.workspaceId), eq(outreachActions.id, action.id)));
    });
  }

  async #skip(action: ClaimedAction, reason: string) {
    const now = this.clock.now();
    await this.database.transaction(async (tx) => {
      await tx
        .update(outreachActions)
        .set({ status: "skipped", lastErrorCode: reason, lockedAt: null, lockedUntil: null, lockedBy: null, updatedAt: now })
        .where(and(eq(outreachActions.workspaceId, action.workspaceId), eq(outreachActions.id, action.id)));
      await tx
        .update(campaignEnrollments)
        .set({ status: "cancelled", completedAt: now })
        .where(and(eq(campaignEnrollments.workspaceId, action.workspaceId), eq(campaignEnrollments.id, action.enrollmentId)));
    });
  }

  async #failUnknown(action: ClaimedAction, code: string, message: string, attemptId?: string) {
    const now = this.clock.now();
    await this.database.transaction(async (tx) => {
      if (attemptId) {
        await tx
          .update(outreachAttempts)
          .set({ status: "unknown", errorCode: code, errorMessage: message })
          .where(and(eq(outreachAttempts.workspaceId, action.workspaceId), eq(outreachAttempts.id, attemptId)));
      }
      await tx
        .update(outreachActions)
        .set({
          status: "failed",
          lastErrorCode: code,
          lastErrorMessage: message.slice(0, 4_000),
          lockedAt: null,
          lockedUntil: null,
          lockedBy: null,
          updatedAt: now,
        })
        .where(and(eq(outreachActions.workspaceId, action.workspaceId), eq(outreachActions.id, action.id)));
      await tx
        .update(campaignEnrollments)
        .set({ status: "cancelled", completedAt: now })
        .where(and(eq(campaignEnrollments.workspaceId, action.workspaceId), eq(campaignEnrollments.id, action.enrollmentId)));
      await tx
        .update(campaigns)
        .set({ automationStage: "attention", automationErrorCode: code, automationErrorMessage: message.slice(0, 4_000), updatedAt: now })
        .where(and(eq(campaigns.workspaceId, action.workspaceId), eq(campaigns.id, action.campaignId)));
    });
  }
}

function providerWaitDurationMs(code: string): number | null {
  if (code === "LINKEDIN_INVITE_RECENT") return 7 * 86_400_000;
  if (code === "LINKEDIN_RELATION_PENDING" || code === "UNIPILE_PROVIDER_LIMIT") return 8 * 60 * 60_000;
  return null;
}

type ClaimedAction = NonNullable<Awaited<ReturnType<typeof loadClaimedAction>>> & {
  recoveredUnknownExecution: boolean;
};

async function loadClaimedAction(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  input: { workspaceId: string; actionId: string },
) {
  const [row] = await tx
    .select({
      id: outreachActions.id,
      workspaceId: outreachActions.workspaceId,
      enrollmentId: outreachActions.enrollmentId,
      campaignId: outreachActions.campaignId,
      contactId: outreachActions.contactId,
      providerAccountId: outreachActions.providerAccountId,
      connectedAccountId: outreachActions.connectedAccountId,
      channel: outreachActions.channel,
      stepPosition: outreachActions.stepPosition,
      stepKind: outreachActions.stepKind,
      idempotencyKey: outreachActions.idempotencyKey,
      contentSnapshot: outreachActions.contentSnapshot,
      enrollmentStatus: campaignEnrollments.status,
    })
    .from(outreachActions)
    .innerJoin(
      campaignEnrollments,
      and(eq(campaignEnrollments.workspaceId, outreachActions.workspaceId), eq(campaignEnrollments.id, outreachActions.enrollmentId)),
    )
    .where(and(eq(outreachActions.workspaceId, input.workspaceId), eq(outreachActions.id, input.actionId)))
    .limit(1);
  return row ?? null;
}

function readContentSnapshot(value: unknown): Omit<OutboundSendRequest, "accountId" | "channel" | "stepKind" | "idempotencyKey"> | null {
  if (!value || typeof value !== "object") return null;
  const content = value as Record<string, unknown>;
  const recipient = content.recipient as Record<string, unknown> | undefined;
  if (
    typeof content.body !== "string" ||
    !recipient ||
    typeof recipient.value !== "string" ||
    typeof recipient.normalizedValue !== "string"
  ) return null;
  return {
    subject: typeof content.subject === "string" ? content.subject : null,
    body: content.body,
    recipient: {
      value: recipient.value,
      normalizedValue: recipient.normalizedValue,
      providerUserId: typeof recipient.providerUserId === "string" ? recipient.providerUserId : null,
    },
  };
}

function readScheduleSnapshot(value: unknown): (Pick<CampaignSendSchedule, "activeDays" | "windowStart" | "windowEnd"> & { timezone: string }) | null {
  if (!value || typeof value !== "object") return null;
  const schedule = (value as Record<string, unknown>).schedule;
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) return null;
  const data = schedule as Record<string, unknown>;
  if (
    !Array.isArray(data.activeDays)
    || data.activeDays.some((day) => !Number.isInteger(day) || Number(day) < 1 || Number(day) > 7)
    || typeof data.windowStart !== "string"
    || typeof data.windowEnd !== "string"
    || typeof data.timezone !== "string"
  ) return null;
  return {
    activeDays: data.activeDays as CampaignSendSchedule["activeDays"],
    windowStart: data.windowStart,
    windowEnd: data.windowEnd,
    timezone: data.timezone,
  };
}

function readTemplateSnapshot(value: unknown): SequenceStepInput | null {
  const template = recordValue(value);
  if (!template) return null;
  if (
    !Number.isInteger(template.position)
    || typeof template.kind !== "string"
    || !Number.isInteger(template.delayDays)
    || typeof template.body !== "string"
  ) return null;
  return {
    position: Number(template.position),
    kind: template.kind as SequenceStepInput["kind"],
    delayDays: Number(template.delayDays),
    windowStart: typeof template.windowStart === "string" ? template.windowStart : null,
    windowEnd: typeof template.windowEnd === "string" ? template.windowEnd : null,
    subject: typeof template.subject === "string" ? template.subject : null,
    body: template.body,
    fallbackKind: typeof template.fallbackKind === "string"
      ? template.fallbackKind as SequenceStepInput["fallbackKind"]
      : null,
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function tomorrowMorning(now: Date): Date {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return next;
}

function actionPayload(value: unknown): { workspaceId: string; actionId: string } {
  if (!value || typeof value !== "object") throw new Error("INVALID_OUTREACH_DISPATCH_JOB");
  const payload = value as Record<string, unknown>;
  if (typeof payload.workspaceId !== "string" || typeof payload.actionId !== "string") {
    throw new Error("INVALID_OUTREACH_DISPATCH_JOB");
  }
  return { workspaceId: payload.workspaceId, actionId: payload.actionId };
}
