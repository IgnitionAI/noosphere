import type { ResearchCheckpoint, ResearchStage } from "@outbound/domain/gtm/product-research";

type OutputMap = Readonly<Record<string, unknown>>;

/**
 * Builds the smallest checkpoint snapshot an agent is allowed to see.
 * Public-research stages never receive internal evidence capsules or the raw
 * brief. This is an application invariant, not a prompt convention.
 */
export function buildV3StageSnapshot(
  stage: ResearchStage,
  checkpoints: readonly Pick<ResearchCheckpoint, "stage" | "output">[],
): OutputMap {
  const outputs = Object.fromEntries(checkpoints.map((item) => [item.stage, item.output]));
  const productTruth = sanitizedProductTruth(outputs.product_truth);
  const problemMapping = outputs.problem_mapping;
  const discovery = outputs.organization_discovery;
  const investigation = outputs.market_investigation;
  const buyingContext = outputs.buying_context;
  const sourcing = outputs.sourcing_validation;
  const composition = outputs.icp_composition;
  const review = outputs.adversarial_review;
  const publicEvidence = collectPublicEvidence(outputs);

  switch (stage) {
    case "product_truth":
      return {};
    case "problem_mapping":
      return compact({ product_truth: productTruth });
    case "organization_discovery":
      return compact({ product_truth: productTruth, problem_mapping: problemMapping });
    case "market_investigation":
      return compact({
        product_truth: productTruth,
        problem_mapping: problemMapping,
        organization_discovery: withoutEvidence(discovery),
        public_evidence: publicEvidence,
      });
    case "buying_context":
      return compact({
        organization_discovery: withoutEvidence(discovery),
        market_investigation: withoutEvidence(investigation),
        public_evidence: publicEvidence,
      });
    case "sourcing_validation":
      return compact({
        organization_discovery: withoutEvidence(discovery),
        buying_context: buyingContext,
      });
    case "icp_composition":
      return compact({
        product_truth: productTruth,
        problem_mapping: problemMapping,
        organization_discovery: withoutEvidence(discovery),
        market_investigation: withoutEvidence(investigation),
        buying_context: buyingContext,
        sourcing_validation: sourcing,
        public_evidence: publicEvidence,
      });
    case "adversarial_review":
      return compact({
        icp_composition: composition,
        market_investigation: withoutEvidence(investigation),
        sourcing_validation: sourcing,
        public_evidence: publicEvidence,
      });
    case "objective_ranking":
      return compact({
        icp_composition: composition,
        adversarial_review: review,
        public_evidence: publicEvidence,
      });
    default:
      return outputs;
  }
}

function sanitizedProductTruth(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const facts = Array.isArray(record.facts)
    ? record.facts.flatMap((fact) => {
        if (!fact || typeof fact !== "object") return [];
        const item = fact as Record<string, unknown>;
        return [{
          factId: item.factId,
          statement: item.statement,
          category: item.category,
          status: item.status,
          authority: item.authority,
        }];
      })
    : [];
  return { facts };
}

function collectPublicEvidence(outputs: OutputMap): readonly Record<string, unknown>[] {
  const evidence: Record<string, unknown>[] = [];
  walk(outputs, (candidate) => {
    if (
      candidate.sourceType === "public_web" &&
      typeof candidate.evidenceId === "string"
    ) {
      evidence.push(candidate);
    }
  });
  return [...new Map(evidence.map((item) => [String(item.evidenceId), item])).values()];
}

function withoutEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutEvidence);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "evidence")
      .map(([key, child]) => [key, withoutEvidence(child)]),
  );
}

function compact(values: OutputMap): OutputMap {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== null),
  );
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
