import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { EditorialStrategySnapshot } from "@outbound/domain/content/editorial-strategy";
import type { ContentIdeaEvidence, ContentIdeaView } from "@outbound/application/content/content-ideas";
import type {
  ContentBriefSnapshot,
  ContentDraftSnapshot,
  ContentEditorialCritique,
  ContentEvidenceAudit,
  ContentGenerationStage,
  ContentGenerationStatus,
} from "@outbound/domain/content/content-asset";
import { assertGroundedContentDraft, evaluateContentReadiness } from "@outbound/domain/content/content-asset";

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
  readonly readiness: { readonly ready: boolean; readonly blockers: readonly string[] };
  readonly createdAt: Date;
}

export interface ContentAssetView {
  readonly id: string;
  readonly workspaceId: string;
  readonly ideaId: string;
  readonly type: "linkedin_text";
  readonly status: "draft" | "ready" | "blocked";
  readonly latestVersion: number;
  readonly latest: ContentAssetVersionView | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ContentGenerationContext {
  readonly run: ContentGenerationRunView;
  readonly idea: ContentIdeaView;
  readonly strategy: EditorialStrategySnapshot;
  readonly evidence: readonly ContentIdeaEvidence[];
  readonly recentBodies: readonly string[];
  readonly brief: ContentBriefSnapshot | null;
  readonly draft: ContentDraftSnapshot | null;
  readonly audit: ContentEvidenceAudit | null;
  readonly critique: ContentEditorialCritique | null;
}

export interface ContentGenerationRepository {
  findRequest(input: { workspaceId: string; operation: "asset.generate" | "asset.improve"; requestKey: string }): Promise<ContentGenerationRunView | null>;
  createGeneration(input: { workspaceId: string; userId: string | null; ideaId?: string; assetId?: string; operation: "asset.generate" | "asset.improve"; requestKey: string; instruction?: string; now: Date }): Promise<ContentGenerationRunView>;
  findRun(input: { workspaceId: string; runId: string }): Promise<ContentGenerationRunView | null>;
  findIdea(input: { workspaceId: string; ideaId: string }): Promise<ContentIdeaView | null>;
  findAssetByIdea(input: { workspaceId: string; ideaId: string }): Promise<ContentAssetView | null>;
  loadContext(input: { workspaceId: string; runId: string }): Promise<ContentGenerationContext>;
  startRun(input: { workspaceId: string; runId: string; now: Date }): Promise<void>;
  saveBrief(input: { workspaceId: string; runId: string; brief: ContentBriefSnapshot; now: Date }): Promise<void>;
  saveDraft(input: { workspaceId: string; runId: string; draft: ContentDraftSnapshot; now: Date }): Promise<void>;
  reviseDraftAfterAudit(input: { workspaceId: string; runId: string; draft: ContentDraftSnapshot; now: Date }): Promise<void>;
  saveAudit(input: { workspaceId: string; runId: string; audit: ContentEvidenceAudit; now: Date }): Promise<void>;
  completeRun(input: { workspaceId: string; runId: string; critique: ContentEditorialCritique; readiness: { ready: boolean; blockers: readonly string[] }; now: Date }): Promise<void>;
  failRun(input: { workspaceId: string; runId: string; code: string; message: string; now: Date }): Promise<void>;
}

export interface ContentPipelineAgent {
  buildBrief(input: Pick<ContentGenerationContext, "run" | "idea" | "strategy" | "evidence">): Promise<ContentBriefSnapshot>;
  write(input: Pick<ContentGenerationContext, "run" | "idea" | "strategy" | "evidence" | "recentBodies"> & {
    readonly brief: ContentBriefSnapshot;
    readonly validationFeedback?: readonly string[];
  }): Promise<ContentDraftSnapshot>;
  audit(input: Pick<ContentGenerationContext, "run" | "strategy" | "evidence"> & { readonly brief: ContentBriefSnapshot; readonly draft: ContentDraftSnapshot }): Promise<ContentEvidenceAudit>;
  critique(input: Pick<ContentGenerationContext, "run" | "idea" | "strategy" | "recentBodies"> & { readonly brief: ContentBriefSnapshot; readonly draft: ContentDraftSnapshot; readonly audit: ContentEvidenceAudit }): Promise<ContentEditorialCritique>;
}

export class ContentGenerationApplication {
  constructor(private readonly repository: ContentGenerationRepository) {}

  findRun(input: Parameters<ContentGenerationRepository["findRun"]>[0]) { return this.repository.findRun(input); }
  findIdea(input: Parameters<ContentGenerationRepository["findIdea"]>[0]) { return this.repository.findIdea(input); }
  findAssetByIdea(input: Parameters<ContentGenerationRepository["findAssetByIdea"]>[0]) { return this.repository.findAssetByIdea(input); }

  async generate(input: { workspaceId: string; userId: string; ideaId: string; requestKey: string; instruction?: string; now?: Date }) {
    const replay = await this.repository.findRequest({ workspaceId: input.workspaceId, operation: "asset.generate", requestKey: input.requestKey });
    if (replay) return replay;
    return this.repository.createGeneration({ ...input, operation: "asset.generate", now: input.now ?? new Date() });
  }

  async improve(input: { workspaceId: string; userId: string; assetId: string; requestKey: string; instruction?: string; now?: Date }) {
    const replay = await this.repository.findRequest({ workspaceId: input.workspaceId, operation: "asset.improve", requestKey: input.requestKey });
    if (replay) return replay;
    return this.repository.createGeneration({ ...input, operation: "asset.improve", now: input.now ?? new Date() });
  }
}

export class ContentGenerationJobProcessor {
  constructor(
    private readonly repository: ContentGenerationRepository,
    private readonly agent: ContentPipelineAgent,
    private readonly queue: JobQueue,
    private readonly now: () => Date = () => new Date(),
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
        const draft = await writeGroundedDraft(this.agent, { ...context, brief: context.brief });
        await this.repository.saveDraft({ workspaceId: job.workspaceId, runId: payload.runId, draft, now: this.now() });
        context = { ...context, draft, run: { ...context.run, stage: "audit" } };
      }
      if (stageAtOrBefore(context.run.stage, "audit")) {
        if (!context.brief || !context.draft) throw new Error("CONTENT_DRAFT_CHECKPOINT_MISSING");
        let draft = context.draft;
        let audit = await this.agent.audit({ ...context, brief: context.brief, draft });
        const auditFeedback = repairableAuditFeedback(audit);
        if (auditFeedback.length > 0) {
          draft = await writeGroundedDraft(this.agent, { ...context, brief: context.brief }, auditFeedback);
          await this.repository.reviseDraftAfterAudit({ workspaceId: job.workspaceId, runId: payload.runId, draft, now: this.now() });
          audit = await this.agent.audit({ ...context, brief: context.brief, draft });
        }
        await this.repository.saveAudit({ workspaceId: job.workspaceId, runId: payload.runId, audit, now: this.now() });
        context = { ...context, draft, audit, run: { ...context.run, stage: "critic" } };
      }
      if (stageAtOrBefore(context.run.stage, "critic")) {
        if (!context.brief || !context.draft || !context.audit) throw new Error("CONTENT_AUDIT_CHECKPOINT_MISSING");
        const critique = await this.agent.critique({ ...context, brief: context.brief, draft: context.draft, audit: context.audit });
        const readiness = evaluateContentReadiness({ draft: context.draft, audit: context.audit, critique, availableEvidenceKeys: context.evidence.map((item) => item.key) });
        await this.repository.completeRun({ workspaceId: job.workspaceId, runId: payload.runId, critique, readiness, now: this.now() });
      }
      await this.queue.acknowledge(job.id, job.lockedBy, this.now());
    } catch (error) {
      if (job.attempts >= job.maxAttempts) {
        await this.repository.failRun({ workspaceId: job.workspaceId, runId: payload.runId, code: "CONTENT_GENERATION_FAILED", message: error instanceof Error ? error.message : String(error), now: this.now() });
      }
      throw error;
    }
  }
}

async function writeGroundedDraft(
  agent: ContentPipelineAgent,
  input: Parameters<ContentPipelineAgent["write"]>[0],
  initialValidationFeedback: readonly string[] = [],
): Promise<ContentDraftSnapshot> {
  const evidenceKeys = input.evidence.map((item) => item.key);
  let validationFeedback = initialValidationFeedback;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const draft = await agent.write({ ...input, ...(validationFeedback.length ? { validationFeedback } : {}) });
    try {
      assertGroundedContentDraft(draft, evidenceKeys);
      return draft;
    } catch (error) {
      if (!isRepairableDraftError(error) || attempt === 2) throw error;
      validationFeedback = [error.message];
    }
  }
  throw new Error("CONTENT_DRAFT_REPAIR_EXHAUSTED");
}

function repairableAuditFeedback(audit: ContentEvidenceAudit): readonly string[] {
  if (audit.forbiddenTopicMatches.length > 0) return [];
  const feedback = [
    ...audit.ungroundedStatements.map((statement) => `CONTENT_AUDIT_UNGROUNDED_STATEMENT: ${statement}`),
    ...audit.reviewedClaims
      .filter((claim) => claim.verdict !== "supported")
      .map((claim) => `CONTENT_AUDIT_UNSUPPORTED_CLAIM: ${claim.statement} — ${claim.reason}`),
  ];
  return feedback.slice(0, 8).map((item) => item.slice(0, 1_000));
}

function isRepairableDraftError(error: unknown): error is Error {
  return error instanceof Error && [
    "CONTENT_DRAFT_UNRESOLVED_CLAIM",
    "CONTENT_DRAFT_CLAIM_NOT_IN_BODY",
    "CONTENT_DRAFT_UNSOURCED_NUMBER",
  ].includes(error.message);
}

function assertBriefGrounded(brief: ContentBriefSnapshot, context: ContentGenerationContext): void {
  const evidence = new Set(context.evidence.map((item) => item.key));
  const claims = new Set(context.strategy.allowedClaimIds);
  if (brief.evidenceKeys.some((key) => !evidence.has(key))) throw new Error("CONTENT_BRIEF_UNRESOLVED_SOURCE");
  if (brief.allowedClaimIds.some((id) => !claims.has(id))) throw new Error("CONTENT_BRIEF_UNAUTHORIZED_CLAIM");
}

function stageAtOrBefore(current: ContentGenerationStage, expected: Exclude<ContentGenerationStage, "completed">): boolean {
  return ["brief", "writer", "audit", "critic", "completed"].indexOf(current) <= ["brief", "writer", "audit", "critic", "completed"].indexOf(expected);
}
