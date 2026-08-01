import {
  buyerLandscapeOutputSchema,
  evidenceReviewOutputSchema,
  icpSynthesisOutputSchema,
  segmentSynthesisOutputSchema,
  type BuyerLandscapeOutput,
  type EvidenceReviewOutput,
  type IcpSynthesisOutput,
  type SegmentSynthesisOutput,
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

export function synthesizeIcpFromSegments(input: {
  readonly brief: ProductResearchBrief;
  readonly previousOutputs: Readonly<Record<string, unknown>>;
}): IcpSynthesisOutput {
  const segments = segmentSynthesisOutputSchema.parse(
    input.previousOutputs.segment_synthesis,
  ).segments.filter((segment) => {
    if (segment.buyerType === "internal_builder") return false;
    const audience = input.brief.audienceGoal ?? "end_customers";
    return audience === "both" ||
      (audience === "end_customers" && segment.buyerType === "end_customer") ||
      (audience === "channel_partners" && segment.buyerType === "channel_partner");
  });
  if (segments.length === 0) throw new Error("ICP_AUDIENCE_MISMATCH");

  const evidence = collectEvidence(input.previousOutputs);
  const candidates = segments.flatMap((segment) => {
    const marketEvidenceIds = externalMarketEvidenceIds(
      input.brief,
      segment.marketEvidenceIds,
      evidence,
    );
    return hasTwoIndependentOrigins(marketEvidenceIds, evidence)
      ? [proposalFromSegment(segment, marketEvidenceIds)]
      : [];
  });
  if (candidates.length === 0) {
    throw new Error("INSUFFICIENT_INDEPENDENT_MARKET_EVIDENCE");
  }
  candidates.sort(
    (left, right) =>
      right.scorecard.total - left.scorecard.total ||
      right.confidence - left.confidence ||
      left.name.localeCompare(right.name),
  );
  const selected = selectDiverseCandidates(candidates, input.brief).slice(0, 5);
  return finalizeIcpSynthesis({
    ...input,
    output: {
      proposals: selected.map((proposal, index) => ({
        ...proposal,
        rank: index + 1,
      })),
    },
  });
}

export function auditIcpStructurally(input: {
  readonly previousOutputs: Readonly<Record<string, unknown>>;
}): EvidenceReviewOutput {
  const synthesis = icpSynthesisOutputSchema.parse(
    input.previousOutputs.icp_synthesis,
  );
  const reviewedFindings = synthesis.proposals.map((proposal, index) => ({
    findingPath: `proposals.${index}`,
    decision: "hypothesis" as const,
    rationale:
      "Les références marché et les critères de prospection sont structurellement valides. La correspondance sémantique détaillée entre chaque affirmation et sa source reste à confirmer humainement, le quota du fournisseur IA ayant empêché la relecture finale.",
    replacement: null,
    evidenceIds: proposal.marketEvidenceIds,
  }));
  const names = synthesis.proposals.map((proposal) => proposal.name);
  return evidenceReviewOutputSchema.parse({
    reviewedFindings,
    unresolvedContradictions: [],
    commercialReadiness: {
      decision: "needs_more_research",
      rationale:
        "Le portefeuille ICP est prospectable et ses preuves sont résolubles, mais la revue sémantique finale des sources n’a pas été exécutée à cause du quota du fournisseur IA. Une validation humaine est obligatoire avant publication.",
      blockedProposalRanks: synthesis.proposals.map((proposal) => proposal.rank),
      missingEvidence: [
        "Relecture sémantique claim-versus-source à effectuer après renouvellement du quota IA ou pendant la revue humaine.",
      ],
    },
    executiveSummary:
      names.length > 0
        ? `Le portefeuille prospectable priorise ${names.join(", ")}. Les segments proviennent de la recherche marché déjà validée et doivent maintenant être confirmés par une revue humaine des preuves.`
        : "Aucun ICP prospectable n’a été produit.",
  });
}

function proposalFromSegment(
  segment: SegmentSynthesisOutput["segments"][number],
  marketEvidenceIds: readonly string[],
): IcpSynthesisOutput["proposals"][number] {
  const problemConfidence = averageConfidence(segment.problems);
  const signalConfidence = averageConfidence(segment.buyingSignals);
  const evidenceIds = unique([
    ...marketEvidenceIds,
    ...segment.buildVsBuy.evidenceIds,
    ...segment.problems.flatMap((claim) => claim.evidenceIds),
    ...segment.buyingSignals.flatMap((claim) => claim.evidenceIds),
  ]);
  const scorecard = {
    productFit: percent(segment.confidence),
    painIntensity: percent(problemConfidence || segment.confidence),
    recurringNeed: Math.min(95, 65 + segment.recurringWorkflows.length * 5),
    budgetFit: segment.buildVsBuy.willingnessToBuy,
    urgency: percent(signalConfidence || segment.confidence),
    reachability: Math.min(
      95,
      55 + segment.prospecting.jobTitles.length * 3 + segment.prospecting.searchKeywords.length * 2,
    ),
    buildAbility: segment.buildVsBuy.buildAbility,
    willingnessToBuy: segment.buildVsBuy.willingnessToBuy,
    evidenceStrength: Math.min(95, 60 + marketEvidenceIds.length * 7),
    total: 0,
  };
  scorecard.total = prospectabilityScore(scorecard);
  return {
    name: segment.name,
    buyerType: segment.buyerType,
    rank: 1,
    confidence: segment.confidence,
    scorecard,
    companyCriteria: {
      naceCodes: segment.prospecting.naceCodes,
      industries: segment.prospecting.industries,
      companySizes: segment.prospecting.companySizes,
      geographies: segment.prospecting.geographies,
    },
    prospecting: segment.prospecting,
    buyingCommittee: segment.prospecting.jobTitles,
    problems: segment.problems.map((claim) => claim.statement),
    signals: unique([
      ...segment.buyingSignals.map((claim) => claim.statement),
      ...segment.prospecting.triggerSignals,
    ]),
    exclusions: segment.prospecting.exclusions,
    unknowns: [
      "Budget, sponsor et calendrier d’achat à confirmer pendant la qualification humaine.",
    ],
    evidenceIds,
    marketEvidenceIds: [...marketEvidenceIds],
  };
}

function externalMarketEvidenceIds(
  brief: ProductResearchBrief,
  evidenceIds: readonly string[],
  evidence: ReadonlyMap<string, { url: string | null; sourceType: string }>,
): string[] {
  const ownOrigin = origin(brief.productUrl);
  return unique(
    evidenceIds.filter((evidenceId) => {
      const source = evidence.get(evidenceId);
      if (!source || source.sourceType !== "public_web") return false;
      const sourceOrigin = origin(source.url);
      return Boolean(sourceOrigin && (!ownOrigin || sourceOrigin !== ownOrigin));
    }),
  );
}

function hasTwoIndependentOrigins(
  evidenceIds: readonly string[],
  evidence: ReadonlyMap<string, { url: string | null; sourceType: string }>,
): boolean {
  return new Set(
    evidenceIds
      .map((evidenceId) => origin(evidence.get(evidenceId)?.url))
      .filter((value): value is string => Boolean(value)),
  ).size >= 2;
}

function selectDiverseCandidates(
  candidates: readonly IcpSynthesisOutput["proposals"][number][],
  brief: ProductResearchBrief,
): IcpSynthesisOutput["proposals"][number][] {
  const productContext = `${brief.productName} ${brief.description} ${candidates
    .map((candidate) => candidate.name)
    .join(" ")}`.toLowerCase();
  if (!/legal|jurid|avocat|compliance|conformit/.test(productContext)) {
    return [...candidates].slice(0, 5);
  }
  const patterns = [
    /cabinet.*avocat|law firm|legal practice/,
    /direction.*juridique|in-house legal|corporate legal department|legal team/,
    /notair|notari/,
    /éditeur.*juridique|édition.*juridique|legal publisher/,
    /cabinet.*conseil|consulting firm|management.*consulting|strategy consulting/,
    /pme.*conformité|conformité.*pme|sme.*compliance|compliance.*sme/,
  ];
  const selected: IcpSynthesisOutput["proposals"][number][] = [];
  for (const pattern of patterns) {
    const match = candidates.find(
      (candidate) =>
        pattern.test(candidate.name.toLowerCase()) && !selected.includes(candidate),
    );
    if (match) selected.push(match);
    if (selected.length === 4) break;
  }
  for (const candidate of candidates) {
    if (!selected.includes(candidate)) selected.push(candidate);
    if (selected.length === 5) break;
  }
  return selected;
}

function averageConfidence(
  claims: readonly { confidence: number }[],
): number {
  if (claims.length === 0) return 0;
  return claims.reduce((total, claim) => total + claim.confidence, 0) / claims.length;
}

function percent(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1_000) / 10;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
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
