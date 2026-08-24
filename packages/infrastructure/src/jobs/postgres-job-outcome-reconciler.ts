import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Clock } from "@outbound/application/shared/ports";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  campaignEnrollments,
  campaigns,
  channelAssessments,
  contentGenerationRuns,
  jobs,
  outboxEvents,
  outreachActions,
  outreachAttempts,
  prospectDiscoveryRuns,
  researchDocuments,
} from "@outbound/infrastructure/database/schema";

type DeadJob = {
  readonly id: string;
  readonly workspaceId: string;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt: Date;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
};

/**
 * Reconciles a dead queue row with the durable aggregate it was meant to
 * advance. It never revives provider-facing delivery jobs. The only automatic
 * revivals are local jobs (document extraction, campaign composition and
 * content generation), each bounded to one repair and unable to contact a
 * prospect or a social provider directly.
 */
export class PostgresJobOutcomeReconciler {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async reconcile(limit = 100): Promise<number> {
    const rows = await this.database.select({
      id: jobs.id,
      workspaceId: jobs.workspaceId,
      type: jobs.type,
      payload: jobs.payload,
      createdAt: jobs.createdAt,
      lastErrorCode: jobs.lastErrorCode,
      lastErrorMessage: jobs.lastErrorMessage,
    }).from(jobs).where(and(
      eq(jobs.status, "dead_lettered"),
      inArray(jobs.type, [
        "campaign.messages.compose",
        "content.asset.generate",
        "prospect.discovery.execute",
        "prospecting.channel.assess",
        "research.document.process",
      ]),
    )).orderBy(asc(jobs.createdAt), asc(jobs.id)).limit(limit);

    let reconciled = 0;
    for (const row of rows) {
      const payload = normalizedPayload(row.payload);
      if (!payload) continue;
      if (await this.#reconcileOne(row, payload)) reconciled += 1;
    }
    return reconciled;
  }

  /**
   * Fails closed when an external delivery lost both its lease and its durable
   * queue continuation. The provider effect is unknown, so this method never
   * retries or recreates a delivery job.
   */
  async reconcileStaleOutreachActions(limit = 100): Promise<number> {
    const now = this.clock.now();
    const stale = await this.database
      .select({
        id: outreachActions.id,
        workspaceId: outreachActions.workspaceId,
        campaignId: outreachActions.campaignId,
        contactId: outreachActions.contactId,
      })
      .from(outreachActions)
      .where(and(
        eq(outreachActions.status, "executing"),
        or(isNull(outreachActions.lockedUntil), lt(outreachActions.lockedUntil, now)),
        sql`not exists (
          select 1 from ${jobs}
          where ${jobs.workspaceId} = ${outreachActions.workspaceId}
            and ${jobs.type} = 'outreach.dispatch'
            and ${jobs.payload} ->> 'actionId' = ${outreachActions.id}::text
            and ${jobs.status} in ('pending', 'running', 'retry')
        )`,
        sql`not exists (
          select 1 from ${campaignEnrollments} competing_enrollment
          where competing_enrollment.workspace_id = ${outreachActions.workspaceId}
            and competing_enrollment.contact_id = ${outreachActions.contactId}
            and competing_enrollment.id <> ${outreachActions.enrollmentId}
            and competing_enrollment.status = 'active'
        )`,
      ))
      .orderBy(asc(outreachActions.updatedAt), asc(outreachActions.id))
      .limit(limit);

    let reconciled = 0;
    for (const action of stale) {
      const changed = await this.database.transaction(async (tx) => {
        const [updated] = await tx.update(outreachActions).set({
          status: "failed",
          lastErrorCode: "ACTION_EXECUTION_STATE_UNKNOWN",
          lastErrorMessage: "L’exécution a perdu son lease sans résultat fournisseur réconciliable. Aucun renvoi automatique n’est autorisé.",
          lockedAt: null,
          lockedUntil: null,
          lockedBy: null,
          updatedAt: now,
        }).where(and(
          eq(outreachActions.workspaceId, action.workspaceId),
          eq(outreachActions.id, action.id),
          eq(outreachActions.status, "executing"),
          or(isNull(outreachActions.lockedUntil), lt(outreachActions.lockedUntil, now)),
          sql`not exists (
            select 1 from ${jobs}
            where ${jobs.workspaceId} = ${outreachActions.workspaceId}
              and ${jobs.type} = 'outreach.dispatch'
              and ${jobs.payload} ->> 'actionId' = ${outreachActions.id}::text
              and ${jobs.status} in ('pending', 'running', 'retry')
          )`,
        )).returning({ id: outreachActions.id });
        if (!updated) return false;
        await tx.insert(outboxEvents).values({
          id: crypto.randomUUID(),
          workspaceId: action.workspaceId,
          aggregateType: "OutreachAction",
          aggregateId: action.id,
          eventType: "OutreachActionExecutionStateUnknown",
          payload: {
            actionId: action.id,
            campaignId: action.campaignId,
            contactId: action.contactId,
            code: "ACTION_EXECUTION_STATE_UNKNOWN",
          },
          availableAt: now,
          createdAt: now,
        });
        return true;
      });
      if (changed) reconciled += 1;
    }
    return reconciled;
  }

  /**
   * Revives only legacy queue waits that failed before an external provider
   * call. The absence of every durable attempt marker is part of the proof;
   * any action with an attempt remains fail-closed.
   */
  async reconcileExhaustedPreSendWaits(limit = 100): Promise<number> {
    const now = this.clock.now();
    const candidates = await this.database
      .select({
        id: outreachActions.id,
        workspaceId: outreachActions.workspaceId,
        campaignId: outreachActions.campaignId,
        enrollmentId: outreachActions.enrollmentId,
        contactId: outreachActions.contactId,
        lastErrorCode: outreachActions.lastErrorCode,
      })
      .from(outreachActions)
      .innerJoin(campaigns, and(
        eq(campaigns.workspaceId, outreachActions.workspaceId),
        eq(campaigns.id, outreachActions.campaignId),
        eq(campaigns.status, "active"),
      ))
      .where(and(
        eq(outreachActions.status, "failed"),
        inArray(outreachActions.lastErrorCode, [
          "OUTSIDE_SENDING_WINDOW_EXHAUSTED",
          "ACTION_EXECUTION_STATE_UNKNOWN",
        ]),
        sql`not exists (
          select 1 from ${outreachAttempts}
          where ${outreachAttempts.workspaceId} = ${outreachActions.workspaceId}
            and (
              ${outreachAttempts.actionId} = ${outreachActions.id}
              or ${outreachAttempts.outreachActionId} = ${outreachActions.id}
            )
        )`,
        sql`not exists (
          select 1 from ${jobs}
          where ${jobs.workspaceId} = ${outreachActions.workspaceId}
            and ${jobs.type} = 'outreach.dispatch'
            and ${jobs.payload} ->> 'actionId' = ${outreachActions.id}::text
            and ${jobs.status} in ('pending', 'running', 'retry')
        )`,
        sql`not exists (
          select 1 from ${campaignEnrollments} competing_enrollment
          where competing_enrollment.workspace_id = ${outreachActions.workspaceId}
            and competing_enrollment.contact_id = ${outreachActions.contactId}
            and competing_enrollment.id <> ${outreachActions.enrollmentId}
            and competing_enrollment.status = 'active'
        )`,
      ))
      .orderBy(asc(outreachActions.updatedAt), asc(outreachActions.id))
      .limit(limit);

    let reconciled = 0;
    for (const candidate of candidates) {
      const previousErrorCode = candidate.lastErrorCode;
      if (!previousErrorCode) continue;
      const recoveredUnknown = previousErrorCode === "ACTION_EXECUTION_STATE_UNKNOWN";
      const recoveryCode = recoveredUnknown ? "PROVEN_NOT_SENT_RECOVERED" : "OUTSIDE_SENDING_WINDOW";
      const recoveryMessage = recoveredUnknown
        ? "L’absence de tentative fournisseur durable prouve qu’aucun envoi n’a commencé. L’action est reprise automatiquement."
        : "Attente de créneau récupérée avant tout appel fournisseur. Le prochain créneau autorisé sera recalculé.";
      const changed = await this.database.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${candidate.workspaceId}:${candidate.contactId}:pre-send-wait-recovery`}, 0))`);
        const [updated] = await tx.update(outreachActions).set({
          status: "scheduled",
          dueAt: now,
          lockedAt: null,
          lockedUntil: null,
          lockedBy: null,
          lastErrorCode: recoveryCode,
          lastErrorMessage: recoveryMessage,
          updatedAt: now,
        }).where(and(
          eq(outreachActions.workspaceId, candidate.workspaceId),
          eq(outreachActions.id, candidate.id),
          eq(outreachActions.status, "failed"),
          eq(outreachActions.lastErrorCode, previousErrorCode),
          sql`not exists (
            select 1 from ${outreachAttempts}
            where ${outreachAttempts.workspaceId} = ${outreachActions.workspaceId}
              and (
                ${outreachAttempts.actionId} = ${outreachActions.id}
                or ${outreachAttempts.outreachActionId} = ${outreachActions.id}
              )
          )`,
          sql`not exists (
            select 1 from ${jobs}
            where ${jobs.workspaceId} = ${outreachActions.workspaceId}
              and ${jobs.type} = 'outreach.dispatch'
              and ${jobs.payload} ->> 'actionId' = ${outreachActions.id}::text
              and ${jobs.status} in ('pending', 'running', 'retry')
          )`,
          sql`not exists (
            select 1 from ${campaignEnrollments} competing_enrollment
            where competing_enrollment.workspace_id = ${outreachActions.workspaceId}
              and competing_enrollment.contact_id = ${outreachActions.contactId}
              and competing_enrollment.id <> ${outreachActions.enrollmentId}
              and competing_enrollment.status = 'active'
          )`,
        )).returning({ id: outreachActions.id });
        if (!updated) return false;
        await tx.update(campaignEnrollments).set({
          status: "active",
          completedAt: null,
        }).where(and(
          eq(campaignEnrollments.workspaceId, candidate.workspaceId),
          eq(campaignEnrollments.id, candidate.enrollmentId),
        ));
        await tx.update(jobs).set({
          status: "completed",
          completedAt: now,
          lockedAt: null,
          lockedUntil: null,
          lockedBy: null,
          lastErrorCode: "JOB_OUTCOME_RECONCILED",
          lastErrorMessage: "L’attente de créneau a été récupérée avant tout appel fournisseur.",
          updatedAt: now,
        }).where(and(
          eq(jobs.workspaceId, candidate.workspaceId),
          eq(jobs.type, "outreach.dispatch"),
          eq(jobs.status, "dead_lettered"),
          sql`${jobs.payload} ->> 'actionId' = ${candidate.id}::text`,
        ));
        await tx.insert(jobs).values({
          id: crypto.randomUUID(),
          workspaceId: candidate.workspaceId,
          type: "outreach.dispatch",
          payload: { workspaceId: candidate.workspaceId, actionId: candidate.id },
          idempotencyKey: `${candidate.id}:dispatch:pre-send-wait-recovery:v1`,
          correlationId: candidate.id,
          status: "pending",
          maxAttempts: 5,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        }).onConflictDoNothing();
        await tx.insert(outboxEvents).values({
          id: crypto.randomUUID(),
          workspaceId: candidate.workspaceId,
          aggregateType: "OutreachAction",
          aggregateId: candidate.id,
          eventType: recoveredUnknown
            ? "OutreachActionProvenNotSentRecovered"
            : "OutreachActionPreSendWaitRecovered",
          payload: {
            actionId: candidate.id,
            campaignId: candidate.campaignId,
            contactId: candidate.contactId,
            code: recoveryCode,
            availableAt: now.toISOString(),
          },
          availableAt: now,
          createdAt: now,
        });
        return true;
      });
      if (changed) reconciled += 1;
    }
    return reconciled + await this.#completeRecoveredPreSendWaitJobs(limit);
  }

  async #completeRecoveredPreSendWaitJobs(limit: number): Promise<number> {
    const obsolete = await this.database.select({ id: jobs.id }).from(jobs).where(and(
      eq(jobs.type, "outreach.dispatch"),
      eq(jobs.status, "dead_lettered"),
      eq(jobs.lastErrorCode, "OUTSIDE_SENDING_WINDOW"),
      sql`exists (
        select 1 from ${jobs} recovered_job
        where recovered_job.workspace_id = ${jobs.workspaceId}
          and recovered_job.type = 'outreach.dispatch'
          and recovered_job.idempotency_key = (${jobs.payload} ->> 'actionId') || ':dispatch:pre-send-wait-recovery:v1'
      )`,
    )).orderBy(asc(jobs.createdAt), asc(jobs.id)).limit(limit);
    if (obsolete.length === 0) return 0;
    const now = this.clock.now();
    const updated = await this.database.update(jobs).set({
      status: "completed",
      completedAt: now,
      lockedAt: null,
      lockedUntil: null,
      lockedBy: null,
      lastErrorCode: "JOB_OUTCOME_RECONCILED",
      lastErrorMessage: "L’attente de créneau avait déjà été récupérée par un job durable.",
      updatedAt: now,
    }).where(and(
      eq(jobs.status, "dead_lettered"),
      inArray(jobs.id, obsolete.map((job) => job.id)),
    )).returning({ id: jobs.id });
    return updated.length;
  }

  /**
   * Recovers only provider refusals whose payload proves that no delivery was
   * accepted. Unknown effects and attempts without a durable provider result
   * remain failed closed.
   */
  async reconcileRecoverableOutreachActions(limit = 100): Promise<number> {
    const now = this.clock.now();
    const candidates = await this.database
      .select({
        id: outreachActions.id,
        workspaceId: outreachActions.workspaceId,
        campaignId: outreachActions.campaignId,
        enrollmentId: outreachActions.enrollmentId,
        contactId: outreachActions.contactId,
        attemptId: outreachAttempts.id,
        attemptErrorCode: outreachAttempts.errorCode,
        attemptErrorMessage: outreachAttempts.errorMessage,
      })
      .from(outreachActions)
      .innerJoin(campaigns, and(
        eq(campaigns.workspaceId, outreachActions.workspaceId),
        eq(campaigns.id, outreachActions.campaignId),
        eq(campaigns.status, "active"),
      ))
      .innerJoin(outreachAttempts, and(
        eq(outreachAttempts.workspaceId, outreachActions.workspaceId),
        or(
          eq(outreachAttempts.actionId, outreachActions.id),
          eq(outreachAttempts.outreachActionId, outreachActions.id),
        ),
        sql`${outreachAttempts.id} = (
          select latest_attempt.id
          from ${outreachAttempts} latest_attempt
          where latest_attempt.workspace_id = ${outreachActions.workspaceId}
            and (
              latest_attempt.action_id = ${outreachActions.id}
              or latest_attempt.outreach_action_id = ${outreachActions.id}
            )
          order by latest_attempt.attempted_at desc, latest_attempt.id desc
          limit 1
        )`,
      ))
      .where(and(
        eq(outreachActions.status, "failed"),
        inArray(outreachActions.lastErrorCode, ["ACTION_EXECUTION_STATE_UNKNOWN", "UNIPILE_422"]),
        sql`not exists (
          select 1 from ${jobs}
          where ${jobs.workspaceId} = ${outreachActions.workspaceId}
            and ${jobs.type} = 'outreach.dispatch'
            and ${jobs.payload} ->> 'actionId' = ${outreachActions.id}::text
            and ${jobs.status} in ('pending', 'running', 'retry')
        )`,
      ))
      .orderBy(asc(outreachActions.updatedAt), asc(outreachActions.id))
      .limit(Math.max(limit, 1) * 4);

    let reconciled = 0;
    for (const candidate of candidates) {
      if (reconciled >= limit) break;
      const recovery = recoverableProviderRefusal(candidate.attemptErrorCode, candidate.attemptErrorMessage);
      if (!recovery) continue;
      const availableAt = new Date(now.getTime() + recovery.delayMs);
      const changed = await this.database.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${candidate.workspaceId}:${candidate.contactId}:outbound-recovery`}, 0))`);
        const [updated] = await tx.update(outreachActions).set({
          status: "scheduled",
          dueAt: availableAt,
          lockedAt: null,
          lockedUntil: null,
          lockedBy: null,
          lastErrorCode: recovery.code,
          lastErrorMessage: recovery.message,
          updatedAt: now,
        }).where(and(
          eq(outreachActions.workspaceId, candidate.workspaceId),
          eq(outreachActions.id, candidate.id),
          eq(outreachActions.status, "failed"),
          inArray(outreachActions.lastErrorCode, ["ACTION_EXECUTION_STATE_UNKNOWN", "UNIPILE_422"]),
          sql`not exists (
            select 1 from ${jobs}
            where ${jobs.workspaceId} = ${outreachActions.workspaceId}
              and ${jobs.type} = 'outreach.dispatch'
              and ${jobs.payload} ->> 'actionId' = ${outreachActions.id}::text
              and ${jobs.status} in ('pending', 'running', 'retry')
          )`,
          sql`not exists (
            select 1 from ${campaignEnrollments} competing_enrollment
            where competing_enrollment.workspace_id = ${outreachActions.workspaceId}
              and competing_enrollment.contact_id = ${outreachActions.contactId}
              and competing_enrollment.id <> ${outreachActions.enrollmentId}
              and competing_enrollment.status = 'active'
          )`,
        )).returning({ id: outreachActions.id });
        if (!updated) return false;
        await tx.update(outreachAttempts).set({
          status: "retry",
          errorCode: recovery.code,
          errorMessage: recovery.message,
        }).where(and(
          eq(outreachAttempts.workspaceId, candidate.workspaceId),
          eq(outreachAttempts.id, candidate.attemptId),
        ));
        await tx.update(campaignEnrollments).set({
          status: "active",
          completedAt: null,
        }).where(and(
          eq(campaignEnrollments.workspaceId, candidate.workspaceId),
          eq(campaignEnrollments.id, candidate.enrollmentId),
        ));
        await tx.insert(jobs).values({
          id: crypto.randomUUID(),
          workspaceId: candidate.workspaceId,
          type: "outreach.dispatch",
          payload: { workspaceId: candidate.workspaceId, actionId: candidate.id },
          idempotencyKey: `${candidate.id}:dispatch:proven-not-sent:${candidate.attemptId}:v1`,
          correlationId: candidate.id,
          status: "pending",
          maxAttempts: 5,
          availableAt,
          createdAt: now,
          updatedAt: now,
        }).onConflictDoNothing();
        await tx.insert(outboxEvents).values({
          id: crypto.randomUUID(),
          workspaceId: candidate.workspaceId,
          aggregateType: "OutreachAction",
          aggregateId: candidate.id,
          eventType: "OutreachActionProviderRefusalRecovered",
          payload: {
            actionId: candidate.id,
            campaignId: candidate.campaignId,
            contactId: candidate.contactId,
            attemptId: candidate.attemptId,
            code: recovery.code,
            availableAt: availableAt.toISOString(),
          },
          availableAt: now,
          createdAt: now,
        });
        return true;
      });
      if (changed) reconciled += 1;
    }
    return reconciled;
  }

  async #reconcileOne(job: DeadJob, payload: Record<string, unknown>): Promise<boolean> {
    switch (job.type) {
      case "prospecting.channel.assess":
        return this.#reconcileChannelAssessment(job, stringField(payload, "assessmentId"));
      case "prospect.discovery.execute":
        return this.#reconcileDiscovery(job, stringField(payload, "runId"));
      case "campaign.messages.compose":
        return this.#reconcileCampaignComposition(job, payload, stringField(payload, "campaignId"));
      case "content.asset.generate":
        return this.#reconcileContentGeneration(job, payload, stringField(payload, "runId"));
      case "research.document.process":
        return this.#reconcileDocument(job, payload, stringField(payload, "documentId"));
      default:
        return false;
    }
  }

  async #reconcileChannelAssessment(job: DeadJob, assessmentId: string | null): Promise<boolean> {
    if (!assessmentId) return false;
    const [assessment] = await this.database.select({ status: channelAssessments.status })
      .from(channelAssessments)
      .where(and(eq(channelAssessments.workspaceId, job.workspaceId), eq(channelAssessments.id, assessmentId)))
      .limit(1);
    if (assessment?.status !== "completed") return false;
    return this.#complete(job, "JOB_SUPERSEDED", "L’évaluation de canal est déjà terminée.");
  }

  async #reconcileDiscovery(job: DeadJob, runId: string | null): Promise<boolean> {
    if (!runId) return false;
    const [run] = await this.database.select({
      status: prospectDiscoveryRuns.status,
      icpVersionId: prospectDiscoveryRuns.icpVersionId,
      channel: prospectDiscoveryRuns.channel,
      createdAt: prospectDiscoveryRuns.createdAt,
    }).from(prospectDiscoveryRuns).where(and(
      eq(prospectDiscoveryRuns.workspaceId, job.workspaceId),
      eq(prospectDiscoveryRuns.id, runId),
    )).limit(1);
    if (!run) return false;
    if (run.status === "completed") {
      return this.#complete(job, "JOB_SUPERSEDED", "La recherche de prospects est déjà terminée.");
    }
    if (run.status !== "failed") return false;
    const [later] = await this.database.select({ id: prospectDiscoveryRuns.id })
      .from(prospectDiscoveryRuns)
      .where(and(
        eq(prospectDiscoveryRuns.workspaceId, job.workspaceId),
        eq(prospectDiscoveryRuns.icpVersionId, run.icpVersionId),
        eq(prospectDiscoveryRuns.channel, run.channel),
        eq(prospectDiscoveryRuns.status, "completed"),
        gt(prospectDiscoveryRuns.createdAt, run.createdAt),
      )).limit(1);
    if (!later) return false;
    return this.#complete(job, "JOB_SUPERSEDED", "Une recherche plus récente a terminé ce même canal ICP.");
  }

  async #reconcileCampaignComposition(job: DeadJob, payload: Record<string, unknown>, campaignId: string | null): Promise<boolean> {
    if (!campaignId) return false;
    const [campaign] = await this.database.select({ status: campaigns.status })
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, job.workspaceId), eq(campaigns.id, campaignId)))
      .limit(1);
    if (!campaign) return this.#complete(job, "JOB_ORPHANED", "La campagne n’existe plus.");
    if (["completed", "archived"].includes(campaign.status)) {
      return this.#complete(job, "JOB_SUPERSEDED", "La campagne est déjà terminée.");
    }
    const [later] = await this.database.select({ id: jobs.id }).from(jobs).where(and(
      eq(jobs.workspaceId, job.workspaceId),
      eq(jobs.type, job.type),
      gt(jobs.createdAt, job.createdAt),
      sql`${jobs.payload} ->> 'campaignId' = ${campaignId}`,
    )).limit(1);
    if (later) return this.#complete(job, "JOB_SUPERSEDED", "Une composition plus récente porte cette campagne.");
    const repairAttempts = nonNegativeInteger(payload._reconciliationAttempts);
    if (campaign.status !== "active" || repairAttempts >= 1) return false;
    const now = this.clock.now();
    const normalized = {
      ...payload,
      workspaceId: job.workspaceId,
      campaignId,
      _reconciliationAttempts: repairAttempts + 1,
    };
    const updated = await this.database.update(jobs).set({
      payload: normalized,
      status: "pending",
      attempts: 0,
      availableAt: now,
      lockedAt: null,
      lockedUntil: null,
      lockedBy: null,
      completedAt: null,
      lastErrorCode: "JOB_RECONCILED",
      lastErrorMessage: "La composition locale sera rejouée une fois après l’échec du moteur éditorial.",
      updatedAt: now,
    }).where(and(eq(jobs.id, job.id), eq(jobs.status, "dead_lettered"))).returning({ id: jobs.id });
    return updated.length === 1;
  }

  async #reconcileContentGeneration(job: DeadJob, payload: Record<string, unknown>, runId: string | null): Promise<boolean> {
    if (!runId) return false;
    const [run] = await this.database.select({ status: contentGenerationRuns.status })
      .from(contentGenerationRuns)
      .where(and(eq(contentGenerationRuns.workspaceId, job.workspaceId), eq(contentGenerationRuns.id, runId)))
      .limit(1);
    if (!run) return this.#complete(job, "JOB_ORPHANED", "Le run de contenu n’existe plus.");
    if (["ready", "blocked", "failed"].includes(run.status)) {
      return this.#complete(job, "JOB_OUTCOME_RECONCILED", "Le run de contenu porte déjà un état terminal.");
    }
    const repairAttempts = nonNegativeInteger(payload._reconciliationAttempts);
    if (repairAttempts < 1) {
      const now = this.clock.now();
      const normalized = {
        ...payload,
        workspaceId: job.workspaceId,
        runId,
        _reconciliationAttempts: repairAttempts + 1,
      };
      const updated = await this.database.update(jobs).set({
        payload: normalized,
        status: "pending",
        attempts: 0,
        availableAt: now,
        lockedAt: null,
        lockedUntil: null,
        lockedBy: null,
        completedAt: null,
        lastErrorCode: "JOB_RECONCILED",
        lastErrorMessage: "La génération locale reprend une fois depuis son dernier checkpoint durable.",
        updatedAt: now,
      }).where(and(eq(jobs.id, job.id), eq(jobs.status, "dead_lettered"))).returning({ id: jobs.id });
      return updated.length === 1;
    }
    const now = this.clock.now();
    await this.database.transaction(async (tx) => {
      await tx.update(contentGenerationRuns).set({
        status: "failed",
        lastErrorCode: job.lastErrorCode ?? "JOB_LEASE_EXHAUSTED",
        lastErrorMessage: job.lastErrorMessage ?? "La génération a perdu son worker avant de produire un résultat terminal.",
        completedAt: now,
        updatedAt: now,
      }).where(and(
        eq(contentGenerationRuns.workspaceId, job.workspaceId),
        eq(contentGenerationRuns.id, runId),
        inArray(contentGenerationRuns.status, ["queued", "running"]),
      ));
      await completeJob(tx, job.id, now, "JOB_OUTCOME_RECONCILED", "Le run de contenu interrompu a été marqué en échec récupérable.");
    });
    return true;
  }

  async #reconcileDocument(job: DeadJob, payload: Record<string, unknown>, documentId: string | null): Promise<boolean> {
    if (!documentId) return false;
    const [document] = await this.database.select({ status: researchDocuments.status })
      .from(researchDocuments)
      .where(and(eq(researchDocuments.workspaceId, job.workspaceId), eq(researchDocuments.id, documentId)))
      .limit(1);
    if (!document) return this.#complete(job, "JOB_ORPHANED", "Le document n’existe plus.");
    if (["ready", "partial", "ocr_required", "failed"].includes(document.status)) {
      return this.#complete(job, "JOB_OUTCOME_RECONCILED", "Le document porte déjà un état terminal.");
    }
    const repairAttempts = nonNegativeInteger(payload._reconciliationAttempts);
    if (document.status !== "uploaded" || repairAttempts >= 1) return false;
    const now = this.clock.now();
    const normalized = { ...payload, workspaceId: job.workspaceId, documentId, _reconciliationAttempts: repairAttempts + 1 };
    const updated = await this.database.update(jobs).set({
      payload: normalized,
      status: "pending",
      attempts: 0,
      availableAt: now,
      lockedAt: null,
      lockedUntil: null,
      lockedBy: null,
      completedAt: null,
      lastErrorCode: "JOB_RECONCILED",
      lastErrorMessage: "Le payload historique a été normalisé et l’extraction locale sera rejouée une fois.",
      updatedAt: now,
    }).where(and(eq(jobs.id, job.id), eq(jobs.status, "dead_lettered"))).returning({ id: jobs.id });
    return updated.length === 1;
  }

  async #complete(job: DeadJob, code: string, message: string): Promise<boolean> {
    const now = this.clock.now();
    const updated = await this.database.update(jobs).set({
      status: "completed",
      completedAt: now,
      lockedAt: null,
      lockedUntil: null,
      lockedBy: null,
      lastErrorCode: code,
      lastErrorMessage: message,
      updatedAt: now,
    }).where(and(eq(jobs.id, job.id), eq(jobs.status, "dead_lettered"))).returning({ id: jobs.id });
    return updated.length === 1;
  }
}

function recoverableProviderRefusal(
  errorCode: string | null,
  errorMessage: string | null,
): { readonly code: string; readonly message: string; readonly delayMs: number } | null {
  if (errorCode !== "UNIPILE_422" || !errorMessage) return null;
  if (/already_invited_recently|invitation has already been sent recently/i.test(errorMessage)) {
    return {
      code: "LINKEDIN_INVITE_RECENT",
      message: "Une invitation LinkedIn existe déjà pour ce prospect. Nouvelle vérification automatique après le délai fournisseur.",
      delayMs: 7 * 86_400_000,
    };
  }
  if (/limit_exceeded|usage limit set by the provider|provider.*limit/i.test(errorMessage)) {
    return {
      code: "UNIPILE_PROVIDER_LIMIT",
      message: "La limite LinkedIn du fournisseur a refusé l’envoi. Nouvelle vérification automatique au prochain créneau.",
      delayMs: 8 * 60 * 60_000,
    };
  }
  if (/no_connection_with_recipient|first degree connection/i.test(errorMessage)) {
    return {
      code: "LINKEDIN_RELATION_PENDING",
      message: "La relation LinkedIn n’est pas encore au premier degré. Nouvelle vérification automatique sans envoi prématuré.",
      delayMs: 8 * 60 * 60_000,
    };
  }
  return null;
}

function normalizedPayload(value: unknown): Record<string, unknown> | null {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : null;
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function nonNegativeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

async function completeJob(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  jobId: string,
  now: Date,
  code: string,
  message: string,
): Promise<void> {
  await tx.update(jobs).set({
    status: "completed",
    completedAt: now,
    lockedAt: null,
    lockedUntil: null,
    lockedBy: null,
    lastErrorCode: code,
    lastErrorMessage: message,
    updatedAt: now,
  }).where(and(eq(jobs.id, jobId), eq(jobs.status, "dead_lettered")));
}
