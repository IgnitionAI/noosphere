import { buildV3StageSnapshot } from "@outbound/application/gtm/v3-stage-input-projector";
import { parseAgentInput, parseAgentOutput } from "@outbound/contracts/product-research";
import {
  v3ResearchStages,
  type ResearchCheckpoint,
} from "@outbound/domain/gtm/product-research";
import { V3SourcingValidator } from "@outbound/infrastructure/ai/v3-sourcing-validator";
import { createLangChainResearchAgentExecutorFromEnvironment } from "@outbound/infrastructure/ai/langchain-research-agent-executor";
import { UnipileProspectSource } from "@outbound/infrastructure/crm/unipile-prospect-source";

const productUrl = process.argv[2] ?? "https://ignition-rag.com";
const productName = process.argv[3] ?? "IgnitionRAG";
const startedAt = new Date();
const deadlineAt = new Date(startedAt.getTime() + 25 * 60_000);
const workspaceId = crypto.randomUUID();
const runId = crypto.randomUUID();
const checkpoints: ResearchCheckpoint[] = [];

const sourcing = new V3SourcingValidator(
  process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY
    ? new UnipileProspectSource({
        dsn: process.env.UNIPILE_DSN,
        apiKey: process.env.UNIPILE_API_KEY,
        ...(process.env.UNIPILE_LINKEDIN_ACCOUNT_ID
          ? { accountId: process.env.UNIPILE_LINKEDIN_ACCOUNT_ID }
          : {}),
      })
    : null,
);
const executor = createLangChainResearchAgentExecutorFromEnvironment(
  undefined,
  undefined,
  undefined,
  sourcing,
);
const brief = {
  productUrl,
  productName,
  description: "",
  geography: "France",
  languages: ["fr"],
  salesMotion: "saas" as const,
  knownCompetitors: [],
  internalDocumentIds: [],
  depth: "quick" as const,
  audienceGoal: "end_customers" as const,
  buyerConstraints: "Exclude organizations whose normal preference is to build the product internally.",
  researchObjective: "qualified_conversations" as const,
  researchVersion: 3 as const,
};

for (const stage of v3ResearchStages) {
  const stageRunId = crypto.randomUUID();
  const stageStartedAt = Date.now();
  let output: unknown;
  let provider: string;
  let model: string;
  if (stage === "market_investigation") {
    const snapshot = buildV3StageSnapshot(stage, checkpoints);
    const hypotheses = organizationHypotheses(snapshot).slice(0, 4);
    const executions = await Promise.allSettled(hypotheses.map(async (hypothesis) => {
      const input = parseAgentInput(stage, {
        stage,
        workspaceId,
        runId,
        researchStageRunId: crypto.randomUUID(),
        correlationId: `smoke:${runId}:${stage}:${hypothesis.hypothesisId}`,
        deadlineAt: deadlineAt.toISOString(),
        workItemKey: `hypothesis:${hypothesis.hypothesisId}`,
        externalDlpTerms: [],
        brief,
        previousOutputs: snapshotForHypothesis(snapshot, hypothesis.hypothesisId),
      });
      const execution = await executor.execute(stage, input);
      const investigations = (execution.output as { investigations?: unknown[] }).investigations;
      if (
        !Array.isArray(investigations) ||
        investigations.length !== 1 ||
        !investigations.some((item) =>
          item !== null && typeof item === "object" && "hypothesisId" in item &&
          (item as { hypothesisId?: unknown }).hypothesisId === hypothesis.hypothesisId)
      ) {
        throw new Error(`MARKET_WORK_ITEM_SCOPE_VIOLATION:${hypothesis.hypothesisId}`);
      }
      return { hypothesisId: hypothesis.hypothesisId, execution };
    }));
    const fulfilled = executions.flatMap((execution) =>
      execution.status === "fulfilled" ? [execution.value] : []);
    const investigations = fulfilled.flatMap(({ execution }) => {
      const value = execution.output as { investigations?: unknown[] };
      return value.investigations ?? [];
    });
    const investigatedIds = new Set(investigations.flatMap((item) =>
      item && typeof item === "object" && "hypothesisId" in item && typeof item.hypothesisId === "string"
        ? [item.hypothesisId]
        : []));
    const evidence = [...new Map(fulfilled.flatMap(({ execution }) => {
      const value = execution.output as { evidence?: Array<{ evidenceId?: string }> };
      return (value.evidence ?? []).flatMap((item) =>
        item.evidenceId ? [[item.evidenceId, item] as const] : []);
    })).values()];
    output = parseAgentOutput(stage, {
      investigations,
      notInvestigatedHypothesisIds: organizationHypotheses(snapshot)
        .map((hypothesis) => hypothesis.hypothesisId)
        .filter((hypothesisId) => !investigatedIds.has(hypothesisId)),
      evidence,
    });
    provider = "parallel-smoke";
    model = [...new Set(fulfilled.map(({ execution }) => execution.metadata.model))].join(",") || "none";
    console.info(JSON.stringify({
      event: "icp_v3_live_fanout_joined",
      requested: hypotheses.length,
      completed: fulfilled.length,
      failed: executions.length - fulfilled.length,
    }));
  } else {
    const input = parseAgentInput(stage, {
      stage,
      workspaceId,
      runId,
      researchStageRunId: stageRunId,
      correlationId: `smoke:${runId}:${stage}`,
      deadlineAt: deadlineAt.toISOString(),
      externalDlpTerms: [],
      brief,
      previousOutputs: buildV3StageSnapshot(stage, checkpoints),
    });
    const result = await executor.execute(stage, input);
    output = result.output;
    provider = result.metadata.provider;
    model = result.metadata.model;
  }
  checkpoints.push({
    id: stageRunId,
    workspaceId,
    runId,
    stage,
    attempt: 1,
    status: "completed",
    review: "machine",
    inputHash: "live-smoke",
    outputHash: "live-smoke",
    output,
    errorCode: null,
    startedAt: new Date(stageStartedAt),
    completedAt: new Date(),
  });
  const count = stageCount(stage, output);
  console.info(JSON.stringify({
    event: "icp_v3_live_stage_completed",
    stage,
    provider,
    model,
    count,
    latencyMs: Date.now() - stageStartedAt,
  }));
  if (process.env.SMOKE_STOP_AFTER === stage) break;
}

function organizationHypotheses(snapshot: Readonly<Record<string, unknown>>): Array<{
  hypothesisId: string;
  [key: string]: unknown;
}> {
  const discovery = snapshot.organization_discovery;
  if (!discovery || typeof discovery !== "object" || !("hypotheses" in discovery)) return [];
  const hypotheses = discovery.hypotheses;
  return Array.isArray(hypotheses)
    ? hypotheses.filter((item): item is { hypothesisId: string; [key: string]: unknown } =>
        Boolean(item) && typeof item === "object" && "hypothesisId" in item &&
        typeof item.hypothesisId === "string")
    : [];
}

function snapshotForHypothesis(
  snapshot: Readonly<Record<string, unknown>>,
  hypothesisId: string,
): Readonly<Record<string, unknown>> {
  const discovery = snapshot.organization_discovery as Record<string, unknown>;
  return {
    ...snapshot,
    organization_discovery: {
      ...discovery,
      hypotheses: organizationHypotheses(snapshot).filter(
        (hypothesis) => hypothesis.hypothesisId === hypothesisId,
      ),
    },
    assignedHypothesisId: hypothesisId,
  };
}

const ranking = checkpoints.at(-1)?.output as {
  status?: string;
  proposals?: unknown[];
  missingStages?: unknown[];
};
if (checkpoints.at(-1)?.stage === "objective_ranking") {
  console.info(JSON.stringify({
    event: "icp_v3_live_smoke_completed",
    status: ranking?.status ?? "unknown",
    proposalCount: ranking?.proposals?.length ?? 0,
    missingStageCount: ranking?.missingStages?.length ?? 0,
    durationMs: Date.now() - startedAt.getTime(),
  }));
}

function stageCount(stage: string, output: unknown): number {
  if (!output || typeof output !== "object") return 0;
  const record = output as Record<string, unknown>;
  const key = {
    product_truth: "facts",
    problem_mapping: "problems",
    organization_discovery: "hypotheses",
    market_investigation: "investigations",
    buying_context: "contexts",
    sourcing_validation: "tests",
    icp_composition: "candidates",
    adversarial_review: "reviews",
    objective_ranking: "proposals",
  }[stage];
  return key && Array.isArray(record[key]) ? record[key].length : 0;
}
