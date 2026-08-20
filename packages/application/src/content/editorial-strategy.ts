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

export interface EditorialStrategyRepository {
  grounding(workspaceId: string): Promise<EditorialStrategyGrounding>;
  find(workspaceId: string): Promise<EditorialStrategyView | null>;
  findRequest(input: { workspaceId: string; operation: string; requestKey: string }): Promise<EditorialStrategyView | EditorialStrategyVersionView | null>;
  saveDerived(input: {
    workspaceId: string;
    userId: string;
    requestKey: string;
    grounding: EditorialStrategyGrounding;
    snapshot: EditorialStrategySnapshot;
    derivation: EditorialStrategyView["derivation"];
  }): Promise<EditorialStrategyView>;
  updateDraft(input: {
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
  ) {}

  find(workspaceId: string): Promise<EditorialStrategyView | null> {
    return this.repository.find(workspaceId);
  }

  async derive(input: { workspaceId: string; userId: string; requestKey: string }): Promise<EditorialStrategyView> {
    const replay = await this.repository.findRequest({ ...input, operation: "strategy.derive" });
    if (replay) return replay as EditorialStrategyView;
    const grounding = await this.repository.grounding(input.workspaceId);
    const generated = await this.generator.generate({ workspaceId: input.workspaceId, grounding });
    const snapshot = editorialStrategySnapshotSchema.parse(generated.snapshot);
    assertStrategyClaimsAreAuthorized(snapshot, grounding.offer.claims
      .filter((claim) => claim.validationStatus === "sourced" || claim.validationStatus === "validated")
      .map((claim) => claim.id));
    return this.repository.saveDerived({ ...input, grounding, snapshot, derivation: generated.metadata });
  }

  async updateDraft(input: { workspaceId: string; userId: string; requestKey: string; snapshot: EditorialStrategySnapshot }): Promise<EditorialStrategyView> {
    const replay = await this.repository.findRequest({ ...input, operation: "strategy.update" });
    if (replay) return replay as EditorialStrategyView;
    const grounding = await this.repository.grounding(input.workspaceId);
    const snapshot = editorialStrategySnapshotSchema.parse(input.snapshot);
    assertStrategyClaimsAreAuthorized(snapshot, grounding.offer.claims
      .filter((claim) => claim.validationStatus === "sourced" || claim.validationStatus === "validated")
      .map((claim) => claim.id));
    return this.repository.updateDraft({ ...input, snapshot });
  }

  async publish(input: { workspaceId: string; userId: string; requestKey: string }): Promise<EditorialStrategyVersionView> {
    const replay = await this.repository.findRequest({ ...input, operation: "strategy.publish" });
    if (replay) return replay as EditorialStrategyVersionView;
    return this.repository.publish(input);
  }
}
