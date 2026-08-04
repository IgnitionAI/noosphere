import { describe, expect, test } from "bun:test";
import {
  isBudgetExhaustion,
  ResearchOrchestrator,
} from "@outbound/application/gtm/research-orchestrator";
import {
  CreateProductResearchRun,
  PauseProductResearchRun,
  ResumeProductResearchRun,
  StartProductResearchRun,
} from "@outbound/application/gtm/product-research-use-cases";
import {
  RetryableAgentError,
  TerminalAgentError,
  type ResearchAgentExecutor,
} from "@outbound/application/gtm/product-research-ports";
import { CryptoIdGenerator, type Clock } from "@outbound/application/shared/ports";
import type { AgentExecutionResult, AgentStageInput } from "@outbound/contracts/product-research";
import { researchStages, v3ResearchStages, type ResearchStage } from "@outbound/domain/gtm/product-research";
import { Sha256ContentHasher } from "@outbound/infrastructure/shared/sha256-content-hasher";
import { InMemoryResearchBackend } from "@outbound/infrastructure/testing/in-memory-research-backend";
import { validOutputFor } from "../fixtures/research-agent-fixtures";

class MutableClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

class FakeAgents implements ResearchAgentExecutor {
  readonly calls = new Map<ResearchStage, number>();
  readonly inputs = new Map<ResearchStage, AgentStageInput>();
  retryOnce: ResearchStage | null = null;
  failOnce: ResearchStage | null = null;
  budgetOnce: ResearchStage | null = null;
  organizationHypothesisCount = 1;

  async execute(stage: ResearchStage, _input: AgentStageInput): Promise<AgentExecutionResult> {
    this.inputs.set(stage, structuredClone(_input));
    const calls = (this.calls.get(stage) ?? 0) + 1;
    this.calls.set(stage, calls);
    if (this.retryOnce === stage && calls === 1) {
      throw new RetryableAgentError("PROVIDER_RATE_LIMITED", "try later");
    }
    if (this.failOnce === stage && calls === 1) {
      throw new TerminalAgentError("MODEL_PROVIDER_QUOTA_EXHAUSTED", "quota exhausted");
    }
    if (this.budgetOnce === stage && calls === 1) {
      throw new TerminalAgentError("RESEARCH_BUDGET_EXHAUSTED", "stage budget exhausted");
    }
    let output = structuredClone(validOutputFor(stage)) as Record<string, any>;
    if (stage === "organization_discovery" && this.organizationHypothesisCount > 1) {
      const base = output.hypotheses[0];
      output.hypotheses = Array.from({ length: this.organizationHypothesisCount }, (_, index) => ({
        ...structuredClone(base),
        hypothesisId: `H${String(index + 1).padStart(2, "0")}`,
        organizationType: `Evidence-derived organization ${index + 1}`,
      }));
    }
    if (stage === "market_investigation" && _input.workItemKey !== "main") {
      output.investigations[0].hypothesisId = _input.workItemKey.replace("hypothesis:", "");
    }
    return {
      output: output as AgentExecutionResult["output"],
      metadata: {
        provider: "fixture",
        model: "deterministic-v1",
        promptVersion: "test-v1",
        parameters: { temperature: 0 },
        cost: 0,
        latencyMs: 1,
      },
    };
  }
}

class FailFirstCompletionBackend extends InMemoryResearchBackend {
  #failFirstCompletion = true;

  override async commitStageCompleted(
    input: Parameters<InMemoryResearchBackend["commitStageCompleted"]>[0],
  ): Promise<void> {
    if (this.#failFirstCompletion) {
      this.#failFirstCompletion = false;
      throw new Error("SIMULATED_COMMIT_FAILURE");
    }
    await super.commitStageCompleted(input);
  }
}

const brief = {
  productUrl: "https://example.com",
  productName: "Example",
  description: "",
  geography: "France",
  languages: ["fr"],
  salesMotion: "saas" as const,
  knownCompetitors: [],
  internalDocumentIds: [],
  depth: "standard" as const,
};

describe("ResearchOrchestrator", () => {
  test("recognizes both stage and global budget exhaustion as partial-report outcomes", () => {
    expect(isBudgetExhaustion("RESEARCH_BUDGET_EXHAUSTED")).toBe(true);
    expect(isBudgetExhaustion("RESEARCH_GLOBAL_DEADLINE_EXHAUSTED")).toBe(true);
    expect(isBudgetExhaustion("MODEL_PROVIDER_QUOTA_EXHAUSTED")).toBe(false);
  });

  test("fans out at most four durable investigations and joins them exactly once", async () => {
    const backend = new InMemoryResearchBackend();
    const ids = new CryptoIdGenerator();
    const clock = new MutableClock(new Date("2026-08-02T10:00:00.000Z"));
    const agents = new FakeAgents();
    agents.organizationHypothesisCount = 5;
    const workspaceId = crypto.randomUUID();
    const run = await new CreateProductResearchRun(backend, ids, clock).execute({
      workspaceId,
      brief: { ...brief, researchVersion: 3 as const },
    });
    await new StartProductResearchRun(backend, ids, clock).execute({
      workspaceId,
      runId: run.snapshot.id,
      correlationId: "corr-fanout",
    });
    const orchestrator = new ResearchOrchestrator(
      backend,
      backend,
      agents,
      ids,
      clock,
      new Sha256ContentHasher(),
    );

    for (let index = 0; index < 3; index += 1) {
      const [job] = await backend.lease({
        workerId: "fanout-planner",
        types: ["research.stage.execute"],
        limit: 1,
        leaseMs: 30_000,
        now: clock.now(),
      });
      await orchestrator.process(job!);
    }
    const workItems = await backend.lease({
      workerId: "fanout-workers",
      types: ["research.stage.execute"],
      limit: 10,
      leaseMs: 30_000,
      now: clock.now(),
    });
    expect(workItems).toHaveLength(4);
    expect(new Set(workItems.map((job) => String((job.payload as Record<string, unknown>).workItemKey))).size).toBe(4);
    await Promise.all(workItems.map((job) => orchestrator.process(job)));

    const finalizers = await backend.lease({
      workerId: "fanout-finalizer",
      types: ["research.stage.execute"],
      limit: 10,
      leaseMs: 30_000,
      now: clock.now(),
    });
    expect(finalizers).toHaveLength(1);
    expect(finalizers[0]?.payload).toMatchObject({ finalizeFanout: true });
    await orchestrator.process(finalizers[0]!);

    const market = await backend.findCompletedCheckpoint(
      workspaceId,
      run.snapshot.id,
      "market_investigation",
    );
    expect(market?.output).toMatchObject({
      investigations: expect.arrayContaining([
        expect.objectContaining({ hypothesisId: "H01" }),
        expect.objectContaining({ hypothesisId: "H02" }),
        expect.objectContaining({ hypothesisId: "H03" }),
        expect.objectContaining({ hypothesisId: "H04" }),
      ]),
      notInvestigatedHypothesisIds: ["H05"],
    });
  });

  test("runs the complete V3 workflow and exposes its automatic report", async () => {
    const backend = new InMemoryResearchBackend();
    const ids = new CryptoIdGenerator();
    const clock = new MutableClock(new Date("2026-08-02T10:00:00.000Z"));
    const agents = new FakeAgents();
    const workspaceId = crypto.randomUUID();
    const run = await new CreateProductResearchRun(backend, ids, clock).execute({
      workspaceId,
      brief: { ...brief, researchVersion: 3 as const },
    });
    await new StartProductResearchRun(backend, ids, clock).execute({
      workspaceId,
      runId: run.snapshot.id,
      correlationId: "corr-v3",
    });
    const orchestrator = new ResearchOrchestrator(
      backend,
      backend,
      agents,
      ids,
      clock,
      new Sha256ContentHasher(),
    );

    const expectedJobs = [
      "product_truth",
      "problem_mapping",
      "organization_discovery",
      "market_investigation",
      "market_investigation",
      "buying_context",
      "sourcing_validation",
      "icp_composition",
      "adversarial_review",
      "objective_ranking",
    ] as const;
    for (const expectedStage of expectedJobs) {
      const [job] = await backend.lease({
        workerId: "worker-v3",
        types: ["research.stage.execute"],
        limit: 1,
        leaseMs: 30_000,
        now: clock.now(),
      });
      expect(job?.payload).toMatchObject({ stage: expectedStage });
      expect((await orchestrator.process(job!)).outcome).toBe("completed");
    }

    const completed = await backend.findById(workspaceId, run.snapshot.id);
    const report = await backend.getReport(workspaceId, run.snapshot.id);
    expect(completed?.snapshot.status).toBe("completed");
    expect(report.proposals).toHaveLength(1);
    expect(report.proposals[0]).toMatchObject({
      name: "Distributed operations teams with controlled-document workflows",
      criteria: { origin: "external_signal", sourcingStatus: "verified" },
    });
    expect(backend.publishedVersions).toHaveLength(1);
    expect(backend.publishedVersions[0]).toMatchObject({
      workspaceId,
      runId: run.snapshot.id,
      userId: null,
    });
    expect([...agents.calls.keys()]).toEqual([...v3ResearchStages]);
    expect(backend.aiRuns).toHaveLength(10);
  });

  test("budget exhaustion returns a useful partial V3 report instead of interrupted", async () => {
    const backend = new InMemoryResearchBackend();
    const ids = new CryptoIdGenerator();
    const clock = new MutableClock(new Date("2026-08-02T10:00:00.000Z"));
    const agents = new FakeAgents();
    agents.budgetOnce = "buying_context";
    const workspaceId = crypto.randomUUID();
    const run = await new CreateProductResearchRun(backend, ids, clock).execute({
      workspaceId,
      brief: { ...brief, researchVersion: 3 as const },
    });
    await new StartProductResearchRun(backend, ids, clock).execute({
      workspaceId,
      runId: run.snapshot.id,
      correlationId: "corr-partial",
    });
    const orchestrator = new ResearchOrchestrator(
      backend,
      backend,
      agents,
      ids,
      clock,
      new Sha256ContentHasher(),
    );

    for (let index = 0; index < 6; index += 1) {
      const [job] = await backend.lease({
        workerId: "worker-partial",
        types: ["research.stage.execute"],
        limit: 1,
        leaseMs: 30_000,
        now: clock.now(),
      });
      expect(job).toBeDefined();
      await orchestrator.process(job!);
    }

    const partial = await backend.findById(workspaceId, run.snapshot.id);
    const report = await backend.getReport(workspaceId, run.snapshot.id);
    expect(partial?.snapshot.status).toBe("partial");
    expect(report.stageOutputs.objective_ranking).toMatchObject({
      status: "partial",
      missingStages: expect.arrayContaining(["buying_context", "objective_ranking"]),
    });
    expect(report.proposals).not.toHaveLength(0);
    expect(report.proposals[0]).toMatchObject({
      rank: 1,
      criteria: { state: "insufficient" },
    });
    expect(backend.publishedVersions).toHaveLength(0);
  });

  test("runs all stages, persists checkpoints and never re-executes a completed stage", async () => {
    const backend = new InMemoryResearchBackend();
    const ids = new CryptoIdGenerator();
    const clock = new MutableClock(new Date("2026-07-24T10:00:00.000Z"));
    const agents = new FakeAgents();
    const create = new CreateProductResearchRun(backend, ids, clock);
    const start = new StartProductResearchRun(backend, ids, clock);
    const orchestrator = new ResearchOrchestrator(
      backend,
      backend,
      agents,
      ids,
      clock,
      new Sha256ContentHasher(),
    );
    const workspaceId = crypto.randomUUID();
    const run = await create.execute({ workspaceId, brief });
    await start.execute({ workspaceId, runId: run.snapshot.id, correlationId: "corr-1" });

    for (let index = 0; index < researchStages.length; index += 1) {
      const leased = await backend.lease({
        workerId: "worker-a",
        types: ["research.stage.execute"],
        limit: 1,
        leaseMs: 30_000,
        now: clock.now(),
      });
      expect(leased).toHaveLength(1);
      await orchestrator.process(leased[0]!);
    }

    const completed = await backend.findById(workspaceId, run.snapshot.id);
    expect(completed?.snapshot.status).toBe("ready_for_review");
    expect(backend.inspectCheckpoints().filter((item) => item.status === "completed")).toHaveLength(
      researchStages.length,
    );
    expect(backend.aiRuns).toHaveLength(researchStages.length);
    expect([...agents.calls.values()]).toEqual(researchStages.map(() => 1));

    await backend.enqueue({
      id: ids.generate(),
      workspaceId,
      type: "research.stage.execute",
      payload: { workspaceId, runId: run.snapshot.id, stage: "product_analysis" },
      idempotencyKey: `${run.snapshot.id}:product_analysis:redelivery`,
      correlationId: "corr-1",
      maxAttempts: 5,
      availableAt: clock.now(),
    });
    const redelivery = await backend.lease({
      workerId: "worker-b",
      types: ["research.stage.execute"],
      limit: 1,
      leaseMs: 30_000,
      now: clock.now(),
    });
    expect(await orchestrator.process(redelivery[0]!)).toEqual({
      outcome: "already_completed",
      stage: "product_analysis",
    });
    expect(agents.calls.get("product_analysis")).toBe(1);
  });

  test("retries a transient agent failure with backoff and a new checkpoint attempt", async () => {
    const backend = new InMemoryResearchBackend();
    const ids = new CryptoIdGenerator();
    const clock = new MutableClock(new Date("2026-07-24T10:00:00.000Z"));
    const agents = new FakeAgents();
    agents.retryOnce = "product_analysis";
    const create = new CreateProductResearchRun(backend, ids, clock);
    const start = new StartProductResearchRun(backend, ids, clock);
    const orchestrator = new ResearchOrchestrator(
      backend,
      backend,
      agents,
      ids,
      clock,
      new Sha256ContentHasher(),
    );
    const workspaceId = crypto.randomUUID();
    const run = await create.execute({ workspaceId, brief });
    await start.execute({ workspaceId, runId: run.snapshot.id, correlationId: "corr-retry" });

    const firstLease = await backend.lease({
      workerId: "worker-a",
      types: ["research.stage.execute"],
      limit: 1,
      leaseMs: 30_000,
      now: clock.now(),
    });
    expect((await orchestrator.process(firstLease[0]!)).outcome).toBe("retry_scheduled");

    clock.advance(5_001);
    const secondLease = await backend.lease({
      workerId: "worker-a",
      types: ["research.stage.execute"],
      limit: 1,
      leaseMs: 30_000,
      now: clock.now(),
    });
    expect((await orchestrator.process(secondLease[0]!)).outcome).toBe("completed");
    expect(backend.inspectCheckpoints().map((item) => item.attempt)).toEqual([1, 2]);
  });

  test("resumes a terminally failed stage without recomputing completed work", async () => {
    const backend = new InMemoryResearchBackend();
    const ids = new CryptoIdGenerator();
    const clock = new MutableClock(new Date("2026-07-24T10:00:00.000Z"));
    const agents = new FakeAgents();
    agents.failOnce = "product_analysis";
    const workspaceId = crypto.randomUUID();
    const run = await new CreateProductResearchRun(backend, ids, clock).execute({
      workspaceId,
      brief,
    });
    await new StartProductResearchRun(backend, ids, clock).execute({
      workspaceId,
      runId: run.snapshot.id,
      correlationId: "corr-quota",
    });
    const orchestrator = new ResearchOrchestrator(
      backend,
      backend,
      agents,
      ids,
      clock,
      new Sha256ContentHasher(),
    );
    const [failedJob] = await backend.lease({
      workerId: "worker-a",
      types: ["research.stage.execute"],
      limit: 1,
      leaseMs: 30_000,
      now: clock.now(),
    });
    expect((await orchestrator.process(failedJob!)).outcome).toBe("failed");

    const resumed = await new ResumeProductResearchRun(backend, ids, clock).execute({
      workspaceId,
      runId: run.snapshot.id,
      correlationId: "corr-quota-resume",
    });
    expect(resumed.snapshot).toMatchObject({ status: "queued", activeStage: null });
    const [resumedJob] = await backend.lease({
      workerId: "worker-a",
      types: ["research.stage.execute"],
      limit: 1,
      leaseMs: 30_000,
      now: clock.now(),
    });
    expect((await orchestrator.process(resumedJob!)).outcome).toBe("completed");
    expect(agents.calls.get("product_analysis")).toBe(2);
    expect(backend.inspectCheckpoints().map(({ attempt, status }) => ({ attempt, status }))).toEqual([
      { attempt: 1, status: "failed" },
      { attempt: 2, status: "completed" },
    ]);
  });

  test("a retry supersedes a stale running checkpoint from an interrupted completion", async () => {
    const backend = new FailFirstCompletionBackend();
    const ids = new CryptoIdGenerator();
    const clock = new MutableClock(new Date("2026-07-24T10:00:00.000Z"));
    const agents = new FakeAgents();
    const orchestrator = new ResearchOrchestrator(
      backend,
      backend,
      agents,
      ids,
      clock,
      new Sha256ContentHasher(),
    );
    const workspaceId = crypto.randomUUID();
    const run = await new CreateProductResearchRun(backend, ids, clock).execute({ workspaceId, brief });
    await new StartProductResearchRun(backend, ids, clock).execute({
      workspaceId,
      runId: run.snapshot.id,
      correlationId: "corr-interrupted",
    });
    const [firstLease] = await backend.lease({
      workerId: "worker-a",
      types: ["research.stage.execute"],
      limit: 1,
      leaseMs: 30_000,
      now: clock.now(),
    });
    await expect(orchestrator.process(firstLease!)).rejects.toThrow(
      "Stage product_analysis is not active",
    );
    await backend.retry({
      jobId: firstLease!.id,
      workerId: firstLease!.lockedBy,
      availableAt: clock.now(),
      errorCode: "WORKER_UNHANDLED_ERROR",
      errorMessage: "SIMULATED_COMMIT_FAILURE",
    });

    clock.advance(1);
    const [retryLease] = await backend.lease({
      workerId: "worker-a",
      types: ["research.stage.execute"],
      limit: 1,
      leaseMs: 30_000,
      now: clock.now(),
    });
    expect((await orchestrator.process(retryLease!)).outcome).toBe("completed");
    expect(
      backend.inspectCheckpoints().map(({ attempt, status, errorCode }) => ({
        attempt,
        status,
        errorCode,
      })),
    ).toEqual([
      { attempt: 1, status: "failed", errorCode: "SUPERSEDED_BY_RETRY" },
      { attempt: 2, status: "completed", errorCode: null },
    ]);
  });

  test("repository scope prevents cross-workspace reads", async () => {
    const backend = new InMemoryResearchBackend();
    const ids = new CryptoIdGenerator();
    const clock = new MutableClock(new Date("2026-07-24T10:00:00.000Z"));
    const workspaceId = crypto.randomUUID();
    const run = await new CreateProductResearchRun(backend, ids, clock).execute({ workspaceId, brief });

    expect(await backend.findById(crypto.randomUUID(), run.snapshot.id)).toBeNull();
  });

  test("resume is idempotent and schedules an immediate recovery job", async () => {
    const backend = new InMemoryResearchBackend();
    const ids = new CryptoIdGenerator();
    const clock = new MutableClock(new Date("2026-07-24T10:00:00.000Z"));
    const workspaceId = crypto.randomUUID();
    const run = await new CreateProductResearchRun(backend, ids, clock).execute({ workspaceId, brief });
    await new StartProductResearchRun(backend, ids, clock).execute({
      workspaceId,
      runId: run.snapshot.id,
      correlationId: "corr-resume",
    });
    await new PauseProductResearchRun(backend, clock).execute({ workspaceId, runId: run.snapshot.id });
    const resume = new ResumeProductResearchRun(backend, ids, clock);
    await resume.execute({ workspaceId, runId: run.snapshot.id, correlationId: "corr-resume" });
    await resume.execute({ workspaceId, runId: run.snapshot.id, correlationId: "corr-resume" });

    expect(backend.inspectJobs()).toHaveLength(2);
    expect((await backend.findById(workspaceId, run.snapshot.id))?.snapshot.status).toBe("queued");
  });
});
