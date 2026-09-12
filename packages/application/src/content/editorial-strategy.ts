import { requireWorkspaceAi, type WorkspaceAiAvailability } from "@outbound/application/ai/ai-availability";
import {
  assertStrategyClaimsAreAuthorized,
  type EditorialStrategySnapshot,
} from "@outbound/domain/content/editorial-strategy";
import { editorialStrategySnapshotSchema } from "@outbound/contracts/content";

export interface EditorialStrategyGrounding {
  readonly offer: {
    readonly id: string;
    readonly versionId: string;
    readonly name: string;
    readonly category: string;
    readonly valueProposition: string;
    readonly targetAudience: string;
    readonly pricing: unknown;
    readonly commercialRules: unknown;
    readonly constraints: unknown;
    readonly objections: unknown;
    readonly claims: readonly {
      readonly id: string;
      readonly claim: string;
      readonly validationStatus: "hypothesis" | "sourced" | "validated" | "invalidated";
      readonly evidenceUri: string | null;
    }[];
  };
  readonly icp: {
    readonly id: string;
    readonly versionId: string;
    readonly name: string;
    readonly criteria: unknown;
    readonly buyingCommittee: unknown;
    readonly problems: unknown;
    readonly signals: unknown;
    readonly exclusions: unknown;
  };
}

export interface EditorialStrategyView {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly offerId: string;
  readonly offerVersionId: string;
  readonly icpId: string;
  readonly icpVersionId: string;
  readonly currentVersion: number;
  readonly draft: EditorialStrategySnapshot;
  readonly derivation: {
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
    readonly aiRunId: string | null;
  };
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface EditorialStrategyVersionView {
  readonly id: string;
  readonly strategyId: string;
  readonly version: number;
  readonly snapshot: EditorialStrategySnapshot;
  readonly offerVersionId: string;
  readonly icpVersionId: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly aiRunId: string | null;
  readonly publishedAt: Date;
}

export interface EditorialPreparationState {
  readonly status: string;
  readonly attempts: number;
  readonly errorCode: string | null;
}

export interface EditorialStrategyRepository {
  preparation?(workspaceId: string): Promise<EditorialPreparationState | null>;
  grounding(workspaceId: string, sources?: { offerVersionId: string; icpVersionId: string }): Promise<EditorialStrategyGrounding>;
  find(workspaceId: string): Promise<EditorialStrategyView | null>;
  findForSources?(workspaceId: string, offerId: string, icpId: string): Promise<EditorialStrategyView | null>;
  findRequest(input: { workspaceId: string; operation: string; requestKey: string }): Promise<EditorialStrategyView | EditorialStrategyVersionView | null>;
  saveDerived(input: {
    workspaceId: string;
    userId: string | null;
    requestKey: string;
    grounding: EditorialStrategyGrounding;
    expectedUpdatedAt?: string | null;
    snapshot: EditorialStrategySnapshot;
    derivation: EditorialStrategyView["derivation"];
  }): Promise<EditorialStrategyView>;
  updateDraft(input: {
    expectedStrategyId?: string;
    expectedUpdatedAt?: string;
    workspaceId: string;
    userId: string;
    requestKey: string;
    snapshot: EditorialStrategySnapshot;
  }): Promise<EditorialStrategyView>;
  publish(input: { workspaceId: string; userId: string; requestKey: string }): Promise<EditorialStrategyVersionView>;
}

export interface EditorialStrategyGenerator {
  generate(input: { workspaceId: string; grounding: EditorialStrategyGrounding }): Promise<{
    snapshot: EditorialStrategySnapshot;
    metadata: EditorialStrategyView["derivation"];
  }>;
}

export class EditorialStrategyApplication {
  constructor(
    private readonly repository: EditorialStrategyRepository,
    private readonly generator: EditorialStrategyGenerator,
    private readonly aiAvailable?: WorkspaceAiAvailability,
  ) {}

  preparation(workspaceId: string): Promise<EditorialPreparationState | null> {
    return this.repository.preparation?.(workspaceId) ?? Promise.resolve(null);
  }

  find(workspaceId: string): Promise<EditorialStrategyView | null> {
    return this.repository.find(workspaceId);
  }

  async derive(input: { workspaceId: string; userId: string | null; requestKey: string; sources?: { offerVersionId: string; icpVersionId: string }; expectedUpdatedAt?: string | null }): Promise<EditorialStrategyView> {
    const replay = await this.repository.findRequest({ ...input, operation: "strategy.derive" });
    if (replay) return replay as EditorialStrategyView;
    await requireWorkspaceAi(this.aiAvailable, input.workspaceId, "content_strategy");
    const grounding = await this.repository.grounding(input.workspaceId, input.sources);
    const existing = this.repository.findForSources
      ? await this.repository.findForSources(input.workspaceId, grounding.offer.id, grounding.icp.id)
      : await this.repository.find(input.workspaceId);
    const expectedUpdatedAt = input.expectedUpdatedAt !== undefined ? input.expectedUpdatedAt : existing?.updatedAt.toISOString() ?? null;
    const generated = await this.generator.generate({ workspaceId: input.workspaceId, grounding });
    const snapshot = editorialStrategySnapshotSchema.parse(generated.snapshot);
    assertStrategyClaimsAreAuthorized(snapshot, grounding.offer.claims
      .filter((claim) => claim.validationStatus === "sourced" || claim.validationStatus === "validated")
      .map((claim) => claim.id));
    return this.repository.saveDerived({ ...input, expectedUpdatedAt, grounding, snapshot, derivation: generated.metadata });
  }

  async updateDraft(input: { workspaceId: string; userId: string; requestKey: string; snapshot: EditorialStrategySnapshot }): Promise<EditorialStrategyView> {
    const replay = await this.repository.findRequest({ ...input, operation: "strategy.update" });
    if (replay) return replay as EditorialStrategyView;
    const current = await this.repository.find(input.workspaceId);
    if (!current) throw new Error("EDITORIAL_STRATEGY_NOT_FOUND");
    const grounding = await this.repository.grounding(input.workspaceId, { offerVersionId: current.offerVersionId, icpVersionId: current.icpVersionId });
    const snapshot = editorialStrategySnapshotSchema.parse(input.snapshot);
    assertStrategyClaimsAreAuthorized(snapshot, grounding.offer.claims
      .filter((claim) => claim.validationStatus === "sourced" || claim.validationStatus === "validated")
      .map((claim) => claim.id));
    return this.repository.updateDraft({ ...input, snapshot, expectedStrategyId: current.id, expectedUpdatedAt: current.updatedAt.toISOString() });
  }

  async publish(input: { workspaceId: string; userId: string; requestKey: string }): Promise<EditorialStrategyVersionView> {
    const replay = await this.repository.findRequest({ ...input, operation: "strategy.publish" });
    if (replay) return replay as EditorialStrategyVersionView;
    return this.repository.publish(input);
  }
}

export interface ContentBusinessContext {
  readonly offer: Pick<EditorialStrategyGrounding["offer"], "versionId" | "name" | "category" | "valueProposition" | "targetAudience" | "constraints" | "objections">;
  readonly icp: Pick<EditorialStrategyGrounding["icp"], "versionId" | "name" | "problems" | "buyingCommittee" | "exclusions" | "criteria">;
}
