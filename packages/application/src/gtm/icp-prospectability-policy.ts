import {
  buyerLandscapeOutputSchema,
  icpSynthesisOutputSchema,
  type BuyerLandscapeOutput,
  type IcpSynthesisOutput,
} from "@outbound/contracts/product-research";
import type { ProductResearchBrief } from "@outbound/domain/gtm/product-research";

export interface FinalizeIcpSynthesisInput {
  readonly brief: ProductResearchBrief;
  readonly previousOutputs: Readonly<Record<string, unknown>>;
  readonly output: unknown;
}

export function validateBuyerLandscape(input: {
  readonly brief: ProductResearchBrief;
  readonly previousOutputs: Readonly<Record<string, unknown>>;
  readonly output: unknown;
}): BuyerLandscapeOutput {
  const parsed = buyerLandscapeOutputSchema.parse(input.output);
  const evidence = collectEvidence({
    ...input.previousOutputs,
    buyer_landscape_discovery: parsed,
  });
  for (const segment of parsed.buyerSegments) {
    assertExternalMarketEvidence(
      input.brief,
      segment.marketEvidenceIds,
      evidence,
    );
  }
  return parsed;
}

export function finalizeIcpSynthesis(
  input: FinalizeIcpSynthesisInput,
): IcpSynthesisOutput {
  const parsed = icpSynthesisOutputSchema.parse(input.output);
  const evidence = collectEvidence(input.previousOutputs);
  const requestedAudience = input.brief.audienceGoal ?? "end_customers";
  const allowed = parsed.proposals.filter((proposal) => {
    if (proposal.buyerType === "internal_builder") return false;
    if (requestedAudience === "both") return true;
    return requestedAudience === "end_customers"
      ? proposal.buyerType === "end_customer"
      : proposal.buyerType === "channel_partner";
  });
  if (allowed.length === 0) {
    throw new Error("ICP_AUDIENCE_MISMATCH");
  }

  const finalized = allowed.map((proposal) => {
    assertExternalMarketEvidence(input.brief, proposal.marketEvidenceIds, evidence);
    return {
      ...proposal,
      scorecard: {
        ...proposal.scorecard,
        total: prospectabilityScore(proposal.scorecard),
      },
    };
  });

  finalized.sort(
    (left, right) =>
      right.scorecard.total - left.scorecard.total ||
      right.confidence - left.confidence ||
      left.name.localeCompare(right.name),
  );
  return icpSynthesisOutputSchema.parse({
    proposals: finalized.slice(0, 5).map((proposal, index) => ({
      ...proposal,
      rank: index + 1,
    })),
  });
}

function assertExternalMarketEvidence(
  brief: ProductResearchBrief,
  evidenceIds: readonly string[],
  evidence: ReadonlyMap<string, { url: string | null; sourceType: string }>,
): void {
  const ownOrigin = origin(brief.productUrl);
  const externalOrigins = new Set<string>();
  for (const evidenceId of evidenceIds) {
    const source = evidence.get(evidenceId);
    if (!source) throw new Error(`UNRESOLVED_MARKET_EVIDENCE:${evidenceId}`);
    if (source.sourceType !== "public_web") {
      throw new Error(`INTERNAL_DOCUMENT_AS_MARKET_EVIDENCE:${evidenceId}`);
    }
    const sourceOrigin = origin(source.url);
    if (ownOrigin && sourceOrigin === ownOrigin) {
      throw new Error(`OWN_PRODUCT_SOURCE_AS_MARKET_EVIDENCE:${evidenceId}`);
    }
    if (sourceOrigin) externalOrigins.add(sourceOrigin);
  }
  if (externalOrigins.size < 2) {
    throw new Error("INSUFFICIENT_INDEPENDENT_MARKET_EVIDENCE");
  }
}

function prospectabilityScore(
  score: IcpSynthesisOutput["proposals"][number]["scorecard"],
): number {
  const buildVsBuyFit =
    (100 - score.buildAbility) * 0.6 + score.willingnessToBuy * 0.4;
  const total =
    score.productFit * 0.18 +
    score.painIntensity * 0.15 +
    score.recurringNeed * 0.12 +
    score.budgetFit * 0.1 +
    score.urgency * 0.1 +
    score.reachability * 0.15 +
    score.evidenceStrength * 0.1 +
    buildVsBuyFit * 0.1;
  return Math.round(total * 10) / 10;
}

function collectEvidence(
  previousOutputs: Readonly<Record<string, unknown>>,
): Map<string, { url: string | null; sourceType: string }> {
  const evidence = new Map<string, { url: string | null; sourceType: string }>();
  walk(previousOutputs, (candidate) => {
    if (
      candidate &&
      typeof candidate === "object" &&
      "evidenceId" in candidate &&
      typeof candidate.evidenceId === "string"
    ) {
      evidence.set(candidate.evidenceId, {
        url: "url" in candidate && typeof candidate.url === "string" ? candidate.url : null,
        sourceType:
          "sourceType" in candidate && typeof candidate.sourceType === "string"
            ? candidate.sourceType
            : "unknown",
      });
    }
  });
  return evidence;
}

function walk(value: unknown, visitor: (value: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  visitor(record);
  for (const child of Object.values(record)) walk(child, visitor);
}

function origin(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return null;
  }
}
