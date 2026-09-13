import { synchronizeAuditedClaimLedger } from "@outbound/domain/content/content-audit-ledger";
import { retainUnresolvedAuditClaims } from "@outbound/domain/content/content-audit-findings";
import { contentAuditEvidenceFingerprint } from "@outbound/application/content/content-audit-context";
import { AiTaskPauseError } from "@outbound/application/ai/ai-task-pause";
import { requireWorkspaceAi, type WorkspaceAiAvailability } from "@outbound/application/ai/ai-availability";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { EditorialStrategySnapshot } from "@outbound/domain/content/editorial-strategy";
import type { ContentBrandKitSnapshot, LinkedinContentFormat } from "@outbound/domain/content/content-brand-kit";
import type { ContentBusinessContext } from "@outbound/application/content/editorial-strategy";
import type { StoredContentMedia } from "@outbound/application/content/content-media";
import { ContentMediaProducer, ContentMediaTextOverflowsError, ContentMediaTextOverflowError } from "@outbound/application/content/content-media";
import type { ContentIdeaEvidence, ContentIdeaView } from "@outbound/application/content/content-ideas";
import type {
  ContentBriefSnapshot,
  ContentDraftSnapshot,
  ContentEditorialCritique,
  ContentEvidenceAudit,
  ContentGenerationStage,
  ContentGenerationStatus,
} from "@outbound/domain/content/content-asset";
import { MAX_CONTENT_FACTUAL_CLAIMS, unauditedContentClaims, contentAuditCoverageStatus, contentAuditStructureStatus, contentPublicText, ContentDraftUnsourcedNumberError, MAX_CONTENT_BODY_LENGTH, assertGroundedContentDraft, assertMediaPlanMatchesBrief, evaluateContentReadiness } from "@outbound/domain/content/content-asset";

export const CONTENT_GENERATION_JOB_TYPE = "content.asset.generate";
export const CONTENT_GENERATION_JOB_PRIORITY = 60;

export interface ContentGenerationRunView {
  readonly id: string;
  readonly workspaceId: string;
  readonly ideaId: string;
  readonly assetId: string;
  readonly assetVersionId: string | null;
  readonly status: ContentGenerationStatus;
  readonly stage: ContentGenerationStage;
  readonly instruction: string | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

export interface ContentAssetVersionView {
  readonly id: string;
  readonly assetId: string;
  readonly briefId: string;
  readonly version: number;
  readonly body: string;
  readonly draft: ContentDraftSnapshot;
  readonly audit: ContentEvidenceAudit;
  readonly critique: ContentEditorialCritique;
  readonly readiness: { readonly policyVersion?: string; readonly ready: boolean; readonly blockers: readonly string[] };
  readonly media: StoredContentMedia | null;
  readonly createdAt: Date;
}

export interface ContentAssetView {
  readonly id: string;
  /** Monotonic CAS revision persisted for internal MCP writes. */
  readonly revision?: number;
  readonly workspaceId: string;
  readonly ideaId: string;
  readonly type: LinkedinContentFormat;
  readonly status: "draft" | "ready" | "blocked";
  readonly latestVersion: number;
  readonly latest: ContentAssetVersionView | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ContentGenerationContext {
  /** Source versions pinned by the editorial strategy, never the latest mutable offer. */
  readonly businessContext?: ContentBusinessContext;
  readonly run: ContentGenerationRunView;
  readonly idea: ContentIdeaView;
  readonly strategy: EditorialStrategySnapshot;
  readonly brandKit: ContentBrandKitSnapshot;
  readonly evidence: readonly ContentIdeaEvidence[];
  readonly recentBodies: readonly string[];
  readonly recentFormats: readonly LinkedinContentFormat[];
  readonly brief: ContentBriefSnapshot | null;
  readonly draft: ContentDraftSnapshot | null;
  readonly audit: ContentEvidenceAudit | null;
  readonly critique: ContentEditorialCritique | null;
}

export interface ContentGenerationRepository {
  findRequest(input: { workspaceId: string; operation: "asset.generate" | "asset.improve"; requestKey: string }): Promise<ContentGenerationRunView | null>;
  createGeneration(input: { workspaceId: string; userId: string | null; ideaId?: string; assetId?: string; operation: "asset.generate" | "asset.improve"; requestKey: string; instruction?: string; expectedRevision?: number; correlationId?: string; now: Date }): Promise<ContentGenerationRunView>;
  findRun(input: { workspaceId: string; runId: string }): Promise<ContentGenerationRunView | null>;
  findIdea(input: { workspaceId: string; ideaId: string }): Promise<ContentIdeaView | null>;
  findAssetByIdea(input: { workspaceId: string; ideaId: string }): Promise<ContentAssetView | null>;
  loadContext(input: { workspaceId: string; runId: string }): Promise<ContentGenerationContext>;
  startRun(input: { workspaceId: string; runId: string; now: Date }): Promise<void>;
  saveBrief(input: { workspaceId: string; runId: string; brief: ContentBriefSnapshot; now: Date }): Promise<void>;
  saveDraft(input: { workspaceId: string; runId: string; draft: ContentDraftSnapshot; now: Date }): Promise<void>;
  reviseDraftAfterAudit(input: { workspaceId: string; runId: string; draft: ContentDraftSnapshot; now: Date }): Promise<void>;
  reviseDraftAfterCritique(input: { workspaceId: string; runId: string; draft: ContentDraftSnapshot; now: Date }): Promise<void>;
  checkpointAudit(input: { workspaceId: string; runId: string; audit: ContentEvidenceAudit; draft?: ContentDraftSnapshot; now: Date }): Promise<void>;
  reopenAudit(input: { workspaceId: string; runId: string; now: Date }): Promise<void>;
  saveAudit(input: { workspaceId: string; runId: string; audit: ContentEvidenceAudit; now: Date }): Promise<void>;
  completeRun(input: { workspaceId: string; runId: string; critique: ContentEditorialCritique; readiness: { ready: boolean; blockers: readonly string[] }; media?: StoredContentMedia | null; now: Date }): Promise<void>;
  failRun(input: { workspaceId: string; runId: string; code: string; message: string; now: Date }): Promise<void>;
}

export interface ContentPipelineAgent {
  buildBrief(input: Pick<ContentGenerationContext, "businessContext" | "run" | "idea" | "strategy" | "brandKit" | "evidence" | "recentFormats">): Promise<ContentBriefSnapshot>;
  write(input: Pick<ContentGenerationContext, "businessContext" | "run" | "idea" | "strategy" | "brandKit" | "evidence" | "recentBodies"> & {
    readonly brief: ContentBriefSnapshot;
    readonly draft?: ContentDraftSnapshot | null;
    readonly validationFeedback?: readonly string[];
    readonly repairMode?: "claim_ledger" | undefined;
    readonly audit?: ContentEvidenceAudit | null;
  }): Promise<ContentDraftSnapshot>;
  audit(input: Pick<ContentGenerationContext, "businessContext" | "run" | "strategy" | "evidence"> & { readonly brief: ContentBriefSnapshot; readonly draft: ContentDraftSnapshot; readonly validationFeedback?: readonly string[] }): Promise<ContentEvidenceAudit>;
  critique(input: Pick<ContentGenerationContext, "businessContext" | "run" | "idea" | "strategy" | "brandKit" | "evidence" | "recentBodies"> & { readonly brief: ContentBriefSnapshot; readonly draft: ContentDraftSnapshot; readonly audit: ContentEvidenceAudit }): Promise<ContentEditorialCritique>;
}

export class ContentGenerationApplication {
  constructor(private readonly repository: ContentGenerationRepository, private readonly aiAvailable?: WorkspaceAiAvailability) {}

  findRun(input: Parameters<ContentGenerationRepository["findRun"]>[0]) { return this.repository.findRun(input); }
  findIdea(input: Parameters<ContentGenerationRepository["findIdea"]>[0]) { return this.repository.findIdea(input); }
  findAssetByIdea(input: Parameters<ContentGenerationRepository["findAssetByIdea"]>[0]) { return this.repository.findAssetByIdea(input); }

  async generate(input: { workspaceId: string; userId: string; ideaId: string; requestKey: string; instruction?: string; expectedRevision?: number; correlationId?: string; now?: Date }) {
    const replay = await this.repository.findRequest({ workspaceId: input.workspaceId, operation: "asset.generate", requestKey: input.requestKey });
    if (replay) return replay;
    for (const capability of ["content_brief", "content_writer", "content_audit", "content_critic"] as const) {
      await requireWorkspaceAi(this.aiAvailable, input.workspaceId, capability);
    }
    return this.repository.createGeneration({ ...input, operation: "asset.generate", now: input.now ?? new Date() });
  }

  async improve(input: { workspaceId: string; userId: string; assetId: string; requestKey: string; instruction?: string; correlationId?: string; now?: Date }) {
    const replay = await this.repository.findRequest({ workspaceId: input.workspaceId, operation: "asset.improve", requestKey: input.requestKey });
    if (replay) return replay;
    for (const capability of ["content_brief", "content_writer", "content_audit", "content_critic"] as const) {
      await requireWorkspaceAi(this.aiAvailable, input.workspaceId, capability);
    }
    return this.repository.createGeneration({ ...input, operation: "asset.improve", now: input.now ?? new Date() });
  }
}

export class ContentGenerationJobProcessor {
  constructor(
    private readonly repository: ContentGenerationRepository,
    private readonly agent: ContentPipelineAgent,
    private readonly queue: JobQueue,
    private readonly now: () => Date = () => new Date(),
    private readonly mediaProducer?: ContentMediaProducer,
  ) {}

  async process(job: LeasedJob): Promise<void> {
    const payload = job.payload as { runId?: unknown };
    if (typeof payload.runId !== "string") throw new Error("CONTENT_GENERATION_JOB_INVALID");
    try {
      let context = await this.repository.loadContext({ workspaceId: job.workspaceId, runId: payload.runId });
      await this.repository.startRun({ workspaceId: job.workspaceId, runId: payload.runId, now: this.now() });

      if (stageAtOrBefore(context.run.stage, "brief")) {
        const brief = await this.agent.buildBrief(context);
        assertBriefGrounded(brief, context);
        await this.repository.saveBrief({ workspaceId: job.workspaceId, runId: payload.runId, brief, now: this.now() });
        context = { ...context, brief, run: { ...context.run, stage: "writer" } };
      }
      if (stageAtOrBefore(context.run.stage, "writer")) {
        if (!context.brief) throw new Error("CONTENT_BRIEF_CHECKPOINT_MISSING");
        const draft = await this.#writeGroundedDraft({ ...context, brief: context.brief });
        await this.repository.saveDraft({ workspaceId: job.workspaceId, runId: payload.runId, draft, now: this.now() });
        context = { ...context, draft, run: { ...context.run, stage: "audit" } };
      }
      if (context.run.stage === "critic" && context.draft
        && (!context.audit || contentAuditCoverageStatus(context.draft, context.audit, contentAuditEvidenceFingerprint(context.evidence)) !== "current"
          || unauditedContentClaims(context.draft, context.audit).length > 0)) {
        await this.repository.reopenAudit({ workspaceId: job.workspaceId, runId: payload.runId, now: this.now() });
        context = { ...context, critique: null, run: { ...context.run, stage: "audit" } };
      }
      if (stageAtOrBefore(context.run.stage, "audit")) {
        if (!context.brief || !context.draft) throw new Error("CONTENT_DRAFT_CHECKPOINT_MISSING");
        let { draft, audit } = await this.#auditDraft({ ...context, brief: context.brief, draft: context.draft }, context.audit);
        for (let repairAttempt = 1; repairAttempt <= 2; repairAttempt += 1) {
          const auditFeedback = repairableAuditFeedback(audit);
          if (auditFeedback.length === 0) break;
          draft = await this.#writeGroundedDraft({ ...context, brief: context.brief, draft, audit, repairMode: repairAttempt === 1 && canRepairClaimLedger(draft, audit, context.evidence) ? "claim_ledger" : undefined }, auditFeedback);
          await this.repository.reviseDraftAfterAudit({ workspaceId: job.workspaceId, runId: payload.runId, draft, now: this.now() });
          ({ draft, audit } = await this.#auditDraft({ ...context, brief: context.brief, draft }, audit));
        }
        await this.repository.saveAudit({ workspaceId: job.workspaceId, runId: payload.runId, audit, now: this.now() });
        context = { ...context, draft, audit, run: { ...context.run, stage: "critic" } };
      }
      if (stageAtOrBefore(context.run.stage, "critic")) {
        if (!context.brief || !context.draft || !context.audit) throw new Error("CONTENT_AUDIT_CHECKPOINT_MISSING");
        const synchronized = synchronizeAuditedClaimLedger(context.draft, context.audit, context.evidence.map(item => item.key), contentAuditEvidenceFingerprint(context.evidence));
        if (synchronized.draft !== context.draft) {
          await this.repository.reopenAudit({ workspaceId: job.workspaceId, runId: payload.runId, now: this.now() });
          await this.repository.checkpointAudit({ workspaceId: job.workspaceId, runId: payload.runId, ...synchronized, now: this.now() });
          await this.repository.saveAudit({ workspaceId: job.workspaceId, runId: payload.runId, audit: synchronized.audit, now: this.now() });
        }
        let draft = synchronized.draft;
        let audit = synchronized.audit;
        let critique = await this.agent.critique({ ...context, brief: context.brief, draft, audit });
        assertMediaPlanMatchesBrief(context.brief, draft);
        let readiness = evaluateContentReadiness({
          draft,
          audit,
          critique,
          availableEvidenceKeys: context.evidence.map((item) => item.key),
          evidenceFingerprint: contentAuditEvidenceFingerprint(context.evidence),
          recentBodies: context.recentBodies,
        });
        let media: StoredContentMedia | null;
        ({ readiness, media } = await this.#renderReadyDraft({ ...context, draft, brief: context.brief }, readiness));
        let critiqueFeedbackHistory: readonly string[] = [];
        for (let repairAttempt = 1; repairAttempt <= 2 && !readiness.ready; repairAttempt += 1) {
          const critiqueFeedback = repairableCritiqueFeedback(critique, readiness);
          if (critiqueFeedback.length === 0) break;
          critiqueFeedbackHistory = [...new Set([...critiqueFeedback, ...critiqueFeedbackHistory])];
          draft = await this.#writeGroundedDraft({ ...context, brief: context.brief, draft, audit }, critiqueFeedbackHistory);
          await this.repository.reviseDraftAfterCritique({ workspaceId: job.workspaceId, runId: payload.runId, draft, now: this.now() });
          ({ draft, audit } = await this.#auditDraft({ ...context, brief: context.brief, draft }, audit));
          for (let auditRepairAttempt = 1; auditRepairAttempt <= 2; auditRepairAttempt += 1) {
            const auditFeedback = repairableAuditFeedback(audit);
            if (auditFeedback.length === 0) break;
            draft = await this.#writeGroundedDraft({ ...context, brief: context.brief, draft, audit, repairMode: auditRepairAttempt === 1 && canRepairClaimLedger(draft, audit, context.evidence) ? "claim_ledger" : undefined }, auditFeedback);
            await this.repository.reviseDraftAfterAudit({ workspaceId: job.workspaceId, runId: payload.runId, draft, now: this.now() });
            ({ draft, audit } = await this.#auditDraft({ ...context, brief: context.brief, draft }, audit));
          }
          await this.repository.saveAudit({ workspaceId: job.workspaceId, runId: payload.runId, audit, now: this.now() });
          critique = await this.agent.critique({ ...context, brief: context.brief, draft, audit });
          assertMediaPlanMatchesBrief(context.brief, draft);
          readiness = evaluateContentReadiness({
            draft,
            audit,
            critique,
            availableEvidenceKeys: context.evidence.map((item) => item.key),
            evidenceFingerprint: contentAuditEvidenceFingerprint(context.evidence),
            recentBodies: context.recentBodies,
          });
          ({ readiness, media } = await this.#renderReadyDraft({ ...context, draft, brief: context.brief }, readiness));
        }
        await this.repository.completeRun({ workspaceId: job.workspaceId, runId: payload.runId, critique, readiness, media, now: this.now() });
      }
      await this.queue.acknowledge(job.id, job.lockedBy, this.now());
    } catch (error) {
      if (error instanceof AiTaskPauseError) throw error;
      if (job.attempts >= job.maxAttempts) {
        await this.repository.failRun({ workspaceId: job.workspaceId, runId: payload.runId, code: "CONTENT_GENERATION_FAILED", message: error instanceof Error ? error.message : String(error), now: this.now() });
      }
      throw error;
    }
  }

  async #writeGroundedDraft(input: Parameters<ContentPipelineAgent["write"]>[0], feedback: readonly string[] = []) {
    return writeGroundedDraft(this.agent, input, feedback, async draft => {
      if (input.brief.format !== "linkedin_document") return;
      if (!this.mediaProducer) throw new Error("CONTENT_MEDIA_RENDERER_UNAVAILABLE");
      await this.mediaProducer.checkDraftLayout({workspaceId: input.run.workspaceId, runId: input.run.id,
        format: input.brief.format, draft, brandKit: input.brandKit});
    });
  }

  async #renderReadyDraft(
    context: ContentGenerationContext & { readonly brief: ContentBriefSnapshot; readonly draft: ContentDraftSnapshot },
    readiness: ReturnType<typeof evaluateContentReadiness>,
  ): Promise<{ readiness: ReturnType<typeof evaluateContentReadiness>; media: StoredContentMedia | null }> {
    if (!readiness.ready || context.brief.format === "linkedin_text") return { readiness, media: null };
    try {
      return { readiness, media: await this.#produceMedia(context) };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "CONTENT_MEDIA_TEXT_OVERFLOW") throw error;
      return { readiness: { ready: false, blockers: ["media_text_overflow"] }, media: null };
    }
  }

  async #auditDraft(context: ContentGenerationContext & { readonly brief: ContentBriefSnapshot; readonly draft: ContentDraftSnapshot }, previous: ContentEvidenceAudit | null): Promise<{ draft: ContentDraftSnapshot; audit: ContentEvidenceAudit }> {
    let draft = context.draft;
    let audit = previous;
    let validationFeedback: readonly string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await this.agent.audit({ ...context, draft, validationFeedback });
      audit = retainUnresolvedAuditClaims(draft, current, audit);
      ({ draft, audit } = synchronizeAuditedClaimLedger(draft, audit, context.evidence.map(item => item.key), contentAuditEvidenceFingerprint(context.evidence)));
      await this.repository.checkpointAudit({ workspaceId: context.run.workspaceId, runId: context.run.id, draft, audit, now: this.now() });
      const missing = unauditedContentClaims(draft, audit);
      if (!missing.length || contentAuditStructureStatus(draft, audit, contentAuditEvidenceFingerprint(context.evidence)) !== "current") break;
      validationFeedback = missing.map(claim => `CONTENT_AUDIT_UNREVIEWED_DECLARATION: ${claim.statement} — Review this complete current declaration and its supplied source keys (${claim.sourceKeys.join(", ")}). Return a supported or unsupported verdict based on evidence, not on its declaration. Review every current public field. Do not rewrite public copy.`);
    }
    return { draft, audit: audit! };
  }

  async #produceMedia(context: ContentGenerationContext & { readonly brief: ContentBriefSnapshot; readonly draft: ContentDraftSnapshot }): Promise<StoredContentMedia> {
    if (!this.mediaProducer) throw new Error("CONTENT_MEDIA_RENDERER_UNAVAILABLE");
    const media = await this.mediaProducer.produce({
      workspaceId: context.run.workspaceId,
      runId: context.run.id,
      format: context.brief.format,
      draft: context.draft,
      brandKit: context.brandKit,
    });
    if (!media) throw new Error("CONTENT_MEDIA_RENDER_MISSING");
    return media;
  }
}

async function writeGroundedDraft(
  agent: ContentPipelineAgent,
  input: Parameters<ContentPipelineAgent["write"]>[0],
  initialValidationFeedback: readonly string[] = [],
  validateLayout?: (draft: ContentDraftSnapshot) => Promise<void>,
): Promise<ContentDraftSnapshot> {
  const evidenceKeys = input.evidence.map((item) => item.key);
  let validationFeedback = initialValidationFeedback;
  let candidate = input.draft;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const draft = await agent.write({ ...input, repairMode: attempt === 1 ? input.repairMode : undefined, ...(candidate ? { draft: candidate } : {}), ...(validationFeedback.length ? { validationFeedback } : {}) });
    const errors: Error[] = [];
    const collect = (error: unknown) => {
      if (!isRepairableDraftError(error)) throw error;
      errors.push(...(error instanceof ContentMediaTextOverflowsError ? error.errors : [error]));
    };
    if (draft.body.trim().length > MAX_CONTENT_BODY_LENGTH) collect(new Error("CONTENT_DRAFT_TOO_LONG"));
    try { assertGroundedContentDraft(draft, evidenceKeys); } catch (error) { collect(error); }
    // Layout requires a compatible media plan, but is independent of copy grounding and length.
    let compatiblePlan = true;
    try { assertMediaPlanMatchesBrief(input.brief, draft); } catch (error) { compatiblePlan = false; collect(error); }
    if (compatiblePlan) {
      try { await validateLayout?.(draft); } catch (error) { collect(error); }
    }
    if (!errors.length) return draft;
    if (attempt === 2) throw errors[0];
    candidate = draft;
    validationFeedback = [...initialValidationFeedback, ...errors.map(error => draftValidationFeedback(error, draft))];
  }
  throw new Error("CONTENT_DRAFT_REPAIR_EXHAUSTED");
}

function draftValidationFeedback(error: Error, draft: ContentDraftSnapshot): string {
  if (error instanceof ContentDraftUnsourcedNumberError && error.locations.length) {
    return `${error.message}: ${error.locations.map(item => `${item.field}: ${item.numbers.join(", ")}`).join("; ")}. Array indexes are zero-based. Correct these public occurrences, including media. A scenario declared in the caption does not cover a different slide passage. Remove the unsupported numeric reference from that field or cite evidence that proves it. For an already fictional example only, the visible passage must begin with Exemple fictif : and the same complete passage must be added verbatim to illustrativeScenarios. Merely adding detail or changing the title to Test fictif does not declare the passage. Do not reclassify real results as fictional; retain independent factual audit and never invent a source.`;
  }
  if (error.message === "CONTENT_DRAFT_TOO_LONG") {
    return `${error.message}: body has ${draft.body.trim().length} characters; maximum ${MAX_CONTENT_BODY_LENGTH}. Rewrite concisely while retaining the explanation and source attribution. Do not truncate. Resynchronize the claim ledger with the rewritten public copy.`;
  }
  if (error instanceof ContentMediaTextOverflowError) {
    return `CONTENT_READINESS_BLOCKER: media_text_overflow on slide ${error.slideNumber} (${error.layout}). ${error.textConstraint ? `Field ${error.textConstraint.field} currently has ${error.textConstraint.actualCharacters} characters and must fit within ${error.textConstraint.maxLines} line(s) of at most ${error.textConstraint.maxCharactersPerLine} characters each. Rewrite that field without truncation; preserve the other fields unless they also need correction.` : "Shorten or redistribute that page while preserving its complete reasoning and the other pages."}`;
  }
  return error.message === "CONTENT_MEDIA_TEXT_OVERFLOW" ? "CONTENT_READINESS_BLOCKER: media_text_overflow" : error.message;
}

function canRepairClaimLedger(draft: ContentDraftSnapshot, audit: ContentEvidenceAudit, evidence: readonly ContentIdeaEvidence[]): boolean {
  return draft.factualClaims.length + new Set(audit.ungroundedStatements).size <= MAX_CONTENT_FACTUAL_CLAIMS
    && evidence.length > 0 && audit.ungroundedStatements.length > 0 && audit.ungroundedStatements.length <= 8
    && !audit.unresolvedClaims?.length
    && audit.forbiddenTopicMatches.length === 0
    && audit.reviewedClaims.every(claim => claim.verdict === "supported")
    && (audit.reviewedScenarios ?? []).every(scenario => scenario.verdict !== "misleading")
    && audit.ungroundedStatements.every(statement => statement.length > 0 && statement.length <= 1_000
      && contentPublicText(draft).includes(statement)
      && !draft.factualClaims.some(claim => claim.statement === statement));
}

function repairableAuditFeedback(audit: ContentEvidenceAudit): readonly string[] {
  const feedback = [
    ...(audit.unresolvedClaims ?? []).map(claim => `CONTENT_AUDIT_UNRESOLVED_CLAIM: ${claim.statement} — ${claim.reason}`),
    ...(audit.reviewedScenarios ?? []).filter((item) => item.verdict === "misleading").map((item) => `CONTENT_AUDIT_MISLEADING_SCENARIO: ${item.statement} — ${item.reason}`),
    ...audit.forbiddenTopicMatches.map((topic) => `CONTENT_AUDIT_FORBIDDEN_TOPIC: ${topic}`),
    ...audit.ungroundedStatements.map((statement) => `CONTENT_AUDIT_UNGROUNDED_STATEMENT: ${statement}`),
    ...audit.reviewedClaims
      .filter((claim) => claim.verdict !== "supported")
      .map((claim) => `CONTENT_AUDIT_UNSUPPORTED_CLAIM: ${claim.statement} — ${claim.reason}`),
  ];
  return feedback.slice(0, 8).map((item) => item.slice(0, 1_000));
}

function repairableCritiqueFeedback(
  critique: ContentEditorialCritique,
  readiness: { readonly ready: boolean; readonly blockers: readonly string[] },
): readonly string[] {
  if (readiness.ready) return [];
  if (readiness.blockers.some(blocker => ["editorial_assessment_missing", "editorial_assessment_invalid", "audit_coverage_missing", "audit_coverage_invalid"].includes(blocker))) return [];
  const evidenceBlockers = new Set(["unaudited_claim", "unsupported_claim", "unresolved_audit_claim", "ungrounded_statement", "forbidden_topic"]);
  if (readiness.blockers.some((blocker) => evidenceBlockers.has(blocker))) return [];
  const feedback = [
    ...Object.entries(critique.qualityAssessment ?? {})
      .filter(([, review]) => review.verdict === "revise")
      .map(([criterion, review]) => `CONTENT_CRITIQUE_BLOCKER [${criterion}]: ${review.reason}`),
    ...critique.issues
      .filter((issue) => issue.severity === "blocker")
      .map((issue) => `CONTENT_CRITIQUE_BLOCKER [${issue.code}]: ${issue.message}`),
    ...readiness.blockers
      .filter((blocker) => blocker !== "editorial_blocker")
      .map((blocker) => `CONTENT_READINESS_BLOCKER: ${blocker}`),
  ];
  return [...new Set(feedback)].slice(0, 8).map((item) => item.slice(0, 1_000));
}

function isRepairableDraftError(error: unknown): error is Error {
  return error instanceof Error && [
    "CONTENT_DRAFT_TOO_LONG",
    "CONTENT_MEDIA_TEXT_OVERFLOW",
    "CONTENT_DRAFT_UNRESOLVED_CLAIM",
    "CONTENT_DRAFT_CLAIM_NOT_IN_BODY",
    "CONTENT_DRAFT_UNSOURCED_NUMBER",
    "CONTENT_DRAFT_SCENARIO_INVALID",
    "CONTENT_MEDIA_FORMAT_MISMATCH",
    "CONTENT_MEDIA_PLAN_INVALID",
  ].includes(error.message);
}

function assertBriefGrounded(brief: ContentBriefSnapshot, context: ContentGenerationContext): void {
  const evidence = new Set(context.evidence.map((item) => item.key));
  const claims = new Set(context.strategy.allowedClaimIds);
  const formats = new Set(context.brandKit.enabledFormats);
  if (brief.evidenceKeys.some((key) => !evidence.has(key))) throw new Error("CONTENT_BRIEF_UNRESOLVED_SOURCE");
  if (brief.allowedClaimIds.some((id) => !claims.has(id))) throw new Error("CONTENT_BRIEF_UNAUTHORIZED_CLAIM");
  if (!formats.has(brief.format)) throw new Error("CONTENT_BRIEF_FORMAT_DISABLED");
}

function stageAtOrBefore(current: ContentGenerationStage, expected: Exclude<ContentGenerationStage, "completed">): boolean {
  return ["brief", "writer", "audit", "critic", "completed"].indexOf(current) <= ["brief", "writer", "audit", "critic", "completed"].indexOf(expected);
}
