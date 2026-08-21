import type { EditorialStrategySnapshot } from "@outbound/domain/content/editorial-strategy";

export type EditorialLearningEvidenceKind = "response" | "booking";
export type EditorialLearningCertainty = "fact" | "inference";

export interface EditorialLearningEvidence {
  readonly kind: EditorialLearningEvidenceKind;
  readonly certainty: EditorialLearningCertainty;
  readonly pillar: string;
  readonly angle: string;
  readonly sourceRef: string;
  readonly sourceHref: string;
  readonly occurredAt: Date;
}

export interface EditorialLearningRecommendation {
  readonly action: "prioritize";
  readonly audience: string;
  readonly pillar: string;
  readonly angle: string;
  readonly score: number;
  readonly rationale: string;
  readonly evidenceRefs: readonly string[];
}

export interface EditorialLearningBounds {
  readonly icpVersionId: string;
  readonly allowedPillars: readonly string[];
  readonly allowedClaimIds: readonly string[];
  readonly formats: readonly string[];
  readonly postsPerWeek: number;
}

export interface EditorialLearningVersionView {
  readonly id: string;
  readonly workspaceId: string;
  readonly strategyId: string;
  readonly strategyVersionId: string;
  readonly version: number;
  readonly facts: readonly EditorialLearningEvidence[];
  readonly inferences: readonly EditorialLearningEvidence[];
  readonly recommendations: readonly EditorialLearningRecommendation[];
  readonly bounds: EditorialLearningBounds;
  readonly modelVersion: string;
  readonly windowStartedAt: Date;
  readonly windowEndedAt: Date;
  readonly createdAt: Date;
}

export interface EditorialLearningContext {
  readonly workspaceId: string;
  readonly strategyId: string;
  readonly strategyVersionId: string;
  readonly icpVersionId: string;
  readonly strategy: EditorialStrategySnapshot;
  readonly evidence: readonly EditorialLearningEvidence[];
  readonly windowStartedAt: Date;
  readonly windowEndedAt: Date;
}

export interface EditorialLearningRepository {
  listEnabledWorkspaces(limit: number): Promise<readonly string[]>;
  loadContext(workspaceId: string, now: Date): Promise<EditorialLearningContext | null>;
  latest(workspaceId: string): Promise<EditorialLearningVersionView | null>;
  save(input: {
    readonly context: EditorialLearningContext;
    readonly inputHash: string;
    readonly facts: readonly EditorialLearningEvidence[];
    readonly inferences: readonly EditorialLearningEvidence[];
    readonly recommendations: readonly EditorialLearningRecommendation[];
    readonly bounds: EditorialLearningBounds;
    readonly modelVersion: string;
    readonly now: Date;
  }): Promise<EditorialLearningVersionView>;
}

const MODEL_VERSION = "bounded-editorial-learning-v1";

export class EditorialLearningApplication {
  constructor(private readonly repository: EditorialLearningRepository) {}
  latest(workspaceId: string): Promise<EditorialLearningVersionView | null> { return this.repository.latest(workspaceId); }
}

export class EditorialLearningReconciler {
  constructor(
    private readonly repository: EditorialLearningRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcile(limit = 50): Promise<number> {
    const now = this.now();
    const workspaces = await this.repository.listEnabledWorkspaces(Math.min(500, Math.max(1, limit)));
    let progressed = 0;
    for (const workspaceId of workspaces) {
      const context = await this.repository.loadContext(workspaceId, now);
      if (!context || context.evidence.length === 0) continue;
      const result = deriveBoundedEditorialLearning(context);
      const inputHash = stableHash({
        strategyVersionId: context.strategyVersionId,
        evidence: context.evidence.map((item) => ({ ...item, occurredAt: item.occurredAt.toISOString() })),
      });
      const before = await this.repository.latest(workspaceId);
      const saved = await this.repository.save({ context, inputHash, ...result, modelVersion: MODEL_VERSION, now });
      if (!before || before.id !== saved.id) progressed += 1;
    }
    return progressed;
  }
}

export function deriveBoundedEditorialLearning(context: EditorialLearningContext): {
  readonly facts: readonly EditorialLearningEvidence[];
  readonly inferences: readonly EditorialLearningEvidence[];
  readonly recommendations: readonly EditorialLearningRecommendation[];
  readonly bounds: EditorialLearningBounds;
} {
  const allowedPillars = new Set(context.strategy.pillars.map((pillar) => pillar.name));
  const evidence = context.evidence.filter((item) => allowedPillars.has(item.pillar));
  const facts = evidence.filter((item) => item.certainty === "fact");
  const inferences = evidence.filter((item) => item.certainty === "inference");
  const groups = new Map<string, EditorialLearningEvidence[]>();
  for (const item of evidence) {
    const key = `${item.pillar}\u0000${item.angle}`;
    const current = groups.get(key) ?? [];
    current.push(item);
    groups.set(key, current);
  }
  const recommendations = [...groups.values()].map((items): EditorialLearningRecommendation => {
    const responses = items.filter((item) => item.kind === "response").length;
    const bookings = items.filter((item) => item.kind === "booking").length;
    return {
      action: "prioritize",
      audience: context.strategy.audience.name,
      pillar: items[0]!.pillar,
      angle: items[0]!.angle,
      score: Math.min(100, responses * 10 + bookings * 30),
      rationale: `${responses} réponse${responses === 1 ? "" : "s"} prouvée${responses === 1 ? "" : "s"}, ${bookings} appel${bookings === 1 ? "" : "s"} attribué${bookings === 1 ? "" : "s"}.`,
      evidenceRefs: [...new Set(items.map((item) => item.sourceRef))],
    };
  }).sort((left, right) => right.score - left.score || left.pillar.localeCompare(right.pillar)).slice(0, 6);
  return {
    facts,
    inferences,
    recommendations,
    bounds: {
      icpVersionId: context.icpVersionId,
      allowedPillars: [...allowedPillars],
      allowedClaimIds: [...context.strategy.allowedClaimIds],
      formats: [...context.strategy.formats],
      postsPerWeek: context.strategy.cadence.postsPerWeek,
    },
  };
}

function stableHash(value: unknown): string {
  return new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex");
}
