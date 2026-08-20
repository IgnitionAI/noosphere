import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { EditorialStrategySnapshot } from "@outbound/domain/content/editorial-strategy";
import type { ContentIdeaCandidate, ContentIdeaSourceType, ContentIdeaStatus } from "@outbound/domain/content/content-idea";
import { assertGroundedIdeaCandidate } from "@outbound/domain/content/content-idea";

export const CONTENT_IDEA_DISCOVERY_JOB_TYPE = "content.ideas.discover";

export interface ContentIdeaEvidence {
  readonly key: string;
  readonly type: ContentIdeaSourceType;
  readonly sourceRef: string;
  readonly canonicalUrl: string | null;
  readonly title: string;
  readonly excerpt: string;
  readonly contentHash: string;
  readonly collectedAt: Date;
}

export interface ContentIdeaView {
  readonly id: string;
  readonly workspaceId: string;
  readonly strategyVersionId: string;
  readonly status: ContentIdeaStatus;
  readonly angle: string;
  readonly rationale: string;
  readonly audience: string;
  readonly pillar: string;
  readonly priority: number;
  readonly freshnessUntil: Date;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly sources: readonly ContentIdeaEvidence[];
}

export interface ContentIdeaDiscoveryRunView {
  readonly id: string;
  readonly workspaceId: string;
  readonly strategyVersionId: string;
  readonly status: "queued" | "running" | "completed" | "partial" | "failed";
  readonly trigger: "manual" | "daily";
  readonly cursor: number;
  readonly queryCount: number;
  readonly sourceCount: number;
  readonly ideaCount: number;
  readonly queryLimit: number;
  readonly sourceLimit: number;
  readonly deadlineAt: Date;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

export interface ContentIdeaDiscoveryContext {
  readonly run: ContentIdeaDiscoveryRunView;
  readonly strategy: EditorialStrategySnapshot;
  readonly queries: readonly string[];
  readonly internalEvidence: readonly ContentIdeaEvidence[];
}

export interface ContentIdeaRepository {
  findRequest(input: { workspaceId: string; requestKey: string }): Promise<ContentIdeaDiscoveryRunView | null>;
  createDiscovery(input: { workspaceId: string; userId: string | null; requestKey: string; trigger: "manual" | "daily"; now: Date }): Promise<ContentIdeaDiscoveryRunView>;
  list(input: { workspaceId: string; status?: ContentIdeaStatus; cursor?: string; limit: number }): Promise<{ data: readonly ContentIdeaView[]; nextCursor: string | null }>;
  findRun(input: { workspaceId: string; runId: string }): Promise<ContentIdeaDiscoveryRunView | null>;
  loadDiscoveryContext(input: { workspaceId: string; runId: string }): Promise<ContentIdeaDiscoveryContext>;
  startRun(input: { workspaceId: string; runId: string; now: Date }): Promise<void>;
  saveStep(input: {
    workspaceId: string;
    runId: string;
    cursor: number;
    evidence: readonly ContentIdeaEvidence[];
    candidates: readonly ContentIdeaCandidate[];
    discoveredSourceCount: number;
    now: Date;
  }): Promise<void>;
  completeRun(input: { workspaceId: string; runId: string; partial: boolean; now: Date }): Promise<void>;
  failRun(input: { workspaceId: string; runId: string; code: string; message: string; now: Date }): Promise<void>;
}

export interface ContentIdeaSourceDiscovery {
  search(input: { query: string; limit: number; correlationId: string }): Promise<readonly ContentIdeaEvidence[]>;
}

export interface ContentIdeaCandidateGenerator {
  generate(input: {
    workspaceId: string;
    strategy: EditorialStrategySnapshot;
    query: string;
    evidence: readonly ContentIdeaEvidence[];
  }): Promise<readonly ContentIdeaCandidate[]>;
}

export class ContentIdeaApplication {
  constructor(private readonly repository: ContentIdeaRepository) {}

  list(input: Parameters<ContentIdeaRepository["list"]>[0]) { return this.repository.list(input); }
  findRun(input: Parameters<ContentIdeaRepository["findRun"]>[0]) { return this.repository.findRun(input); }

  async discover(input: { workspaceId: string; userId: string; requestKey: string; now?: Date }) {
    const replay = await this.repository.findRequest({ workspaceId: input.workspaceId, requestKey: input.requestKey });
    if (replay) return replay;
    return this.repository.createDiscovery({ ...input, trigger: "manual", now: input.now ?? new Date() });
  }
}

export class ContentIdeaDiscoveryJobProcessor {
  constructor(
    private readonly repository: ContentIdeaRepository,
    private readonly sourceDiscovery: ContentIdeaSourceDiscovery,
    private readonly generator: ContentIdeaCandidateGenerator,
    private readonly queue: JobQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(job: LeasedJob): Promise<void> {
    const payload = job.payload as { runId?: unknown };
    if (typeof payload.runId !== "string") throw new Error("CONTENT_IDEA_JOB_INVALID");
    try {
      const context = await this.repository.loadDiscoveryContext({ workspaceId: job.workspaceId, runId: payload.runId });
      await this.repository.startRun({ workspaceId: job.workspaceId, runId: payload.runId, now: this.now() });
      let partial = false;
      let sourceCount = context.run.sourceCount;
      for (let cursor = context.run.cursor; cursor < context.queries.length; cursor += 1) {
        const current = this.now();
        if (current >= context.run.deadlineAt || sourceCount >= context.run.sourceLimit) {
          partial = true;
          break;
        }
        const query = context.queries[cursor]!;
        const remaining = Math.max(0, context.run.sourceLimit - sourceCount);
        const publicEvidence = await this.sourceDiscovery.search({
          query,
          limit: Math.min(8, remaining),
          correlationId: `${job.correlationId}:query:${cursor}`,
        });
        const evidence = [...context.internalEvidence, ...publicEvidence];
        const candidates = await this.generator.generate({ workspaceId: job.workspaceId, strategy: context.strategy, query, evidence });
        for (const candidate of candidates) assertGroundedIdeaCandidate(candidate, evidence.map((item) => item.key));
        await this.repository.saveStep({
          workspaceId: job.workspaceId,
          runId: payload.runId,
          cursor: cursor + 1,
          evidence,
          candidates,
          discoveredSourceCount: publicEvidence.length,
          now: this.now(),
        });
        sourceCount += publicEvidence.length;
      }
      await this.repository.completeRun({ workspaceId: job.workspaceId, runId: payload.runId, partial, now: this.now() });
      await this.queue.acknowledge(job.id, job.lockedBy, this.now());
    } catch (error) {
      if (job.attempts >= job.maxAttempts) {
        await this.repository.failRun({ workspaceId: job.workspaceId, runId: payload.runId, code: "CONTENT_IDEA_DISCOVERY_FAILED", message: error instanceof Error ? error.message : String(error), now: this.now() });
      }
      throw error;
    }
  }
}
