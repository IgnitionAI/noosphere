import { describe, expect, test } from "bun:test";
import { ProductResearchApplication } from "@outbound/application/gtm/product-research-application";
import { ResearchOrchestrator } from "@outbound/application/gtm/research-orchestrator";
import type { ResearchAgentExecutor } from "@outbound/application/gtm/product-research-ports";
import { TerminalAgentError } from "@outbound/application/gtm/product-research-ports";
import { CryptoIdGenerator, SystemClock } from "@outbound/application/shared/ports";
import type { AgentExecutionResult, AgentStageInput } from "@outbound/contracts/product-research";
import { researchStages, type ResearchStage } from "@outbound/domain/gtm/product-research";
import { createProductResearchHttpHandler } from "@outbound/interface/http/product-research-handler";
import { RequestAuthenticationError } from "@outbound/interface/http/request-context";
import { InMemoryResearchBackend } from "@outbound/infrastructure/testing/in-memory-research-backend";
import { Sha256ContentHasher } from "@outbound/infrastructure/shared/sha256-content-hasher";
import { validOutputFor } from "../fixtures/research-agent-fixtures";

describe("F-009 HTTP routes", () => {
  test("an operator creates a draft in the workspace derived from the request context", async () => {
    const { backend, workspaceId, handle } = createHarness();
    const response = await createRun(handle);

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      id: string;
      status: string;
      links: { self: string; start: string };
    };
    expect(body.status).toBe("draft");
    expect(body.links.self).toBe(`/api/v1/product-research-runs/${body.id}`);
    expect((await backend.findById(workspaceId, body.id))?.snapshot.workspaceId).toBe(workspaceId);
  });

  test("an operator starts a run and a viewer reads its progress", async () => {
    const harness = createHarness();
    const created = (await (await createRun(harness.handle)).json()) as { id: string };

    const started = await harness.handle(
      new Request(`http://localhost/api/v1/product-research-runs/${created.id}/actions/start`, {
        method: "POST",
        headers: { "x-correlation-id": "http-start-test" },
      }),
    );
    expect(started.status).toBe(202);

    harness.context.role = "viewer";
    const response = await harness.handle(
      new Request(`http://localhost/api/v1/product-research-runs/${created.id}`),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      status: string;
      activeStage: string | null;
      brief: { productName: string; geography: string; depth: string };
      stages: Array<{ stage: string; status: string }>;
    };
    expect(body).toMatchObject({
      id: created.id,
      status: "queued",
      activeStage: null,
      brief: {
        productName: "Example",
        geography: "France",
        depth: "standard",
      },
    });
    expect(body.stages[0]).toMatchObject({
      stage: "product_analysis",
      status: "queued",
      attempts: 0,
      lastErrorCode: null,
    });
  });

  test("a terminal V3 checkpoint is exposed as failed rather than queued", async () => {
    const harness = createHarness(new GlobalDeadlineAgents());
    const response = await harness.handle(
      new Request("http://localhost/api/v1/product-research-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productUrl: "https://example.com",
          productName: "Example",
          description: "",
          geography: "France",
          languages: ["fr"],
          salesMotion: "saas",
          knownCompetitors: [],
          internalDocumentIds: [],
          depth: "standard",
          researchVersion: 3,
        }),
      }),
    );
    const created = (await response.json()) as { id: string };
    await action(harness.handle, created.id, "start");
    const [job] = await harness.backend.lease({
      workerId: "http-terminal-stage",
      types: ["research.stage.execute"],
      limit: 1,
      leaseMs: 30_000,
      now: harness.clock.now(),
    });
    expect(await harness.orchestrator.process(job!)).toMatchObject({ outcome: "partial" });

    const progress = await harness.handle(
      new Request(`http://localhost/api/v1/product-research-runs/${created.id}`),
    );
    const body = (await progress.json()) as {
      status: string;
      stages: Array<{ stage: string; status: string; lastErrorCode: string | null }>;
    };
    expect(body.status).toBe("partial");
    expect(body.stages[0]).toMatchObject({
      stage: "product_truth",
      status: "failed",
      lastErrorCode: "RESEARCH_GLOBAL_DEADLINE_EXHAUSTED",
    });
  });

  test("a viewer can recover the latest workspace run after leaving the progress page", async () => {
    const harness = createHarness();
    const older = (await (await createRun(harness.handle)).json()) as { id: string };
    const active = (await (await createRun(harness.handle)).json()) as { id: string };
    await action(harness.handle, active.id, "start");

    harness.context.role = "viewer";
    const response = await harness.handle(
      new Request("http://localhost/api/v1/product-research-runs?limit=10"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ id: string; status: string; brief: { productName: string } }>;
    };
    expect(body.data.map((run) => run.id)).toEqual(
      expect.arrayContaining([active.id, older.id]),
    );
    expect(body.data.find((run) => run.id === active.id)).toMatchObject({
      id: active.id,
      status: "queued",
      brief: { productName: "Example" },
    });
  });

  test("pause and resume actions are idempotent", async () => {
    const harness = createHarness();
    const created = (await (await createRun(harness.handle)).json()) as { id: string };
    await action(harness.handle, created.id, "start");

    expect((await action(harness.handle, created.id, "pause")).status).toBe(202);
    expect((await action(harness.handle, created.id, "pause")).status).toBe(202);
    expect((await action(harness.handle, created.id, "resume")).status).toBe(202);
    expect((await action(harness.handle, created.id, "resume")).status).toBe(202);

    const response = await harness.handle(
      new Request(`http://localhost/api/v1/product-research-runs/${created.id}`),
    );
    expect((await response.json()) as { status: string }).toMatchObject({ status: "queued" });
  });

  test("a viewer cannot create or mutate a research run", async () => {
    const harness = createHarness();
    harness.context.role = "viewer";

    const response = await createRun(harness.handle);
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect((await response.json()) as { code: string }).toMatchObject({
      code: "WORKSPACE_FORBIDDEN",
    });
  });

  test("an unauthenticated request receives Problem Details", async () => {
    const backend = new InMemoryResearchBackend();
    const handle = createProductResearchHttpHandler({
      application: new ProductResearchApplication(
        backend,
        backend,
        new CryptoIdGenerator(),
        new SystemClock(),
      ),
      contextResolver: {
        async resolve() {
          throw new RequestAuthenticationError();
        },
      },
    });

    const response = await createRun(handle);
    expect(response.status).toBe(401);
    expect((await response.json()) as { code: string }).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  test("an invalid adapter context is rejected before reaching the application", async () => {
    const backend = new InMemoryResearchBackend();
    const handle = createProductResearchHttpHandler({
      application: new ProductResearchApplication(
        backend,
        backend,
        new CryptoIdGenerator(),
        new SystemClock(),
      ),
      contextResolver: {
        async resolve() {
          return {
            userId: "invalid",
            workspaceId: "invalid",
            role: "owner",
          } as never;
        },
      },
    });

    expect((await createRun(handle)).status).toBe(401);
    expect(backend.inspectRuns()).toHaveLength(0);
  });

  test("an invalid state transition returns a stable conflict", async () => {
    const harness = createHarness();
    const created = (await (await createRun(harness.handle)).json()) as { id: string };

    const response = await action(harness.handle, created.id, "pause");
    expect(response.status).toBe(409);
    expect((await response.json()) as { code: string }).toMatchObject({
      code: "PRODUCT_RESEARCH_INVALID_STATE",
    });
  });

  test("a known route rejects unsupported HTTP methods", async () => {
    const harness = createHarness();
    const response = await harness.handle(
      new Request("http://localhost/api/v1/product-research-runs", { method: "PUT" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
  });

  test("a run from another workspace is indistinguishable from a missing run", async () => {
    const harness = createHarness();
    const created = (await (await createRun(harness.handle)).json()) as { id: string };
    harness.context.workspaceId = crypto.randomUUID();

    const response = await harness.handle(
      new Request(`http://localhost/api/v1/product-research-runs/${created.id}`),
    );
    expect(response.status).toBe(404);
    expect((await response.json()) as { code: string }).toMatchObject({
      code: "PRODUCT_RESEARCH_RUN_NOT_FOUND",
    });
  });

  test("the create route rejects a workspace supplied by the client", async () => {
    const harness = createHarness();
    const response = await harness.handle(
      new Request("http://localhost/api/v1/product-research-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productUrl: "https://example.com",
          productName: "Example",
          description: "",
          geography: "France",
          languages: ["fr"],
          salesMotion: "saas",
          knownCompetitors: [],
          internalDocumentIds: [],
          depth: "standard",
          workspaceId: crypto.randomUUID(),
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "INVALID_REQUEST" });
  });

  test("evidence is workspace-scoped and paginated by cursor", async () => {
    const harness = createHarness();
    const created = (await (await createRun(harness.handle)).json()) as { id: string };
    for (const index of [1, 2, 3]) {
      harness.backend.seedEvidence({
        id: crypto.randomUUID(),
        workspaceId: harness.workspaceId,
        runId: created.id,
        sourceType: "public_web",
        url: `https://example.com/source-${index}`,
        title: `Source ${index}`,
        excerpt: `Evidence ${index}`,
        contentHash: `hash-${index}`,
        observedAt: new Date(`2026-07-2${index}T10:00:00.000Z`),
        createdAt: new Date(`2026-07-2${index}T10:00:00.000Z`),
      });
    }
    harness.context.role = "viewer";

    const first = await harness.handle(
      new Request(
        `http://localhost/api/v1/product-research-runs/${created.id}/evidence?limit=2`,
      ),
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      data: Array<{ title: string }>;
      nextCursor: string | null;
    };
    expect(firstBody.data.map((item) => item.title)).toEqual(["Source 1", "Source 2"]);
    expect(firstBody.nextCursor).not.toBeNull();

    const second = await harness.handle(
      new Request(
        `http://localhost/api/v1/product-research-runs/${created.id}/evidence?limit=2&cursor=${firstBody.nextCursor}`,
      ),
    );
    const secondBody = (await second.json()) as {
      data: Array<{ title: string }>;
      nextCursor: string | null;
    };
    expect(secondBody.data.map((item) => item.title)).toEqual(["Source 3"]);
    expect(secondBody.nextCursor).toBeNull();
  });

  test("research-more invalidates machine checkpoints from the requested stage", async () => {
    const harness = createHarness();
    const created = (await (await createRun(harness.handle)).json()) as { id: string };
    await action(harness.handle, created.id, "start");
    for (let index = 0; index < 3; index += 1) {
      const leased = await harness.backend.lease({
        workerId: "http-test-worker",
        types: ["research.stage.execute"],
        limit: 1,
        leaseMs: 30_000,
        now: harness.clock.now(),
      });
      await harness.orchestrator.process(leased[0]!);
    }

    const response = await harness.handle(
      new Request(
        `http://localhost/api/v1/product-research-runs/${created.id}/actions/research-more`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fromStage: "competitor_discovery",
            reason: "Comparer deux nouveaux concurrents détectés",
          }),
        },
      ),
    );

    expect(response.status).toBe(202);
    const body = (await response.json()) as { status: string; completedStages: string[] };
    expect(body.status).toBe("queued");
    expect(body.completedStages).toEqual(["product_analysis"]);
    expect(
      harness.backend
        .inspectCheckpoints()
        .filter((checkpoint) => checkpoint.stage !== "product_analysis")
        .map((checkpoint) => checkpoint.status),
    ).toEqual(["invalidated", "invalidated"]);
  });

  test("research-more preserves a human-reviewed checkpoint", async () => {
    const harness = createHarness();
    const created = (await (await createRun(harness.handle)).json()) as { id: string };
    await action(harness.handle, created.id, "start");
    for (let index = 0; index < 3; index += 1) {
      const leased = await harness.backend.lease({
        workerId: "http-test-worker",
        types: ["research.stage.execute"],
        limit: 1,
        leaseMs: 30_000,
        now: harness.clock.now(),
      });
      await harness.orchestrator.process(leased[0]!);
    }
    harness.backend.markCheckpointHumanReviewed(created.id, "competitor_discovery");

    const response = await harness.handle(
      new Request(
        `http://localhost/api/v1/product-research-runs/${created.id}/actions/research-more`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fromStage: "competitor_discovery",
            reason: "Revoir uniquement les analyses postérieures",
          }),
        },
      ),
    );
    const body = (await response.json()) as { completedStages: string[] };
    expect(body.completedStages).toEqual(["product_analysis", "competitor_discovery"]);
    expect(
      harness.backend
        .inspectCheckpoints()
        .find((checkpoint) => checkpoint.stage === "competitor_discovery"),
    ).toMatchObject({ status: "completed", review: "human_reviewed" });
  });

  test("the completed pipeline exposes a report and requires a reviewer for ICP approval", async () => {
    const harness = createHarness();
    const created = (await (await createRun(harness.handle)).json()) as { id: string };
    await action(harness.handle, created.id, "start");
    for (let index = 0; index < researchStages.length; index += 1) {
      const leased = await harness.backend.lease({
        workerId: "http-report-worker",
        types: ["research.stage.execute"],
        limit: 1,
        leaseMs: 30_000,
        now: harness.clock.now(),
      });
      expect(leased).toHaveLength(1);
      await harness.orchestrator.process(leased[0]!);
    }

    harness.context.role = "viewer";
    const report = await harness.handle(
      new Request(`http://localhost/api/v1/product-research-runs/${created.id}/report`),
    );
    expect(report.status).toBe(200);
    expect((await report.json()) as { run: { status: string } }).toMatchObject({
      run: { status: "ready_for_review" },
    });

    const proposalId = crypto.randomUUID();
    const forbidden = await harness.handle(
      new Request(
        `http://localhost/api/v1/product-research-runs/${created.id}/actions/approve-icp`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proposalId, reason: "ICP validé" }),
        },
      ),
    );
    expect(forbidden.status).toBe(403);

    harness.context.role = "reviewer";
    const approved = await harness.handle(
      new Request(
        `http://localhost/api/v1/product-research-runs/${created.id}/actions/approve-icp`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proposalId, reason: "ICP validé" }),
        },
      ),
    );
    expect(approved.status).toBe(204);
    expect(harness.backend.proposalReviews).toHaveLength(1);
  });

  test("V3 exposes an automatic read-only report with no review links", async () => {
    const harness = createHarness();
    const createdResponse = await harness.handle(
      new Request("http://localhost/api/v1/product-research-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productUrl: "https://example.com",
          productName: "Example V3",
          description: "",
          geography: "France",
          languages: ["fr"],
          salesMotion: "saas",
          knownCompetitors: [],
          internalDocumentIds: [],
          depth: "standard",
          researchVersion: 3,
        }),
      }),
    );
    const created = (await createdResponse.json()) as { id: string };
    await action(harness.handle, created.id, "start");
    for (const _stage of [
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
    ]) {
      const [job] = await harness.backend.lease({
        workerId: "http-v3-worker",
        types: ["research.stage.execute"],
        limit: 1,
        leaseMs: 30_000,
        now: harness.clock.now(),
      });
      await harness.orchestrator.process(job!);
    }

    harness.context.role = "viewer";
    const response = await harness.handle(
      new Request(`http://localhost/api/v1/product-research-runs/${created.id}/report`),
    );
    const report = (await response.json()) as {
      run: { status: string };
      proposals: unknown[];
      links: Record<string, string>;
    };
    expect(response.status).toBe(200);
    expect(report.run.status).toBe("completed");
    expect(report.proposals).toHaveLength(1);
    expect(report.links).toEqual({});
  });
});

function createHarness(agents: ResearchAgentExecutor = new FixtureAgents()) {
  const backend = new InMemoryResearchBackend();
  const workspaceId = crypto.randomUUID();
  const context = {
    userId: crypto.randomUUID(),
    workspaceId,
    role: "operator" as "viewer" | "operator" | "reviewer" | "admin" | "owner",
  };
  const application = new ProductResearchApplication(
    backend,
    backend,
    new CryptoIdGenerator(),
    new SystemClock(),
  );
  const handle = createProductResearchHttpHandler({
    application,
    contextResolver: {
      async resolve() {
        return context;
      },
    },
  });
  const clock = new SystemClock();
  const orchestrator = new ResearchOrchestrator(
    backend,
    backend,
    agents,
    new CryptoIdGenerator(),
    clock,
    new Sha256ContentHasher(),
  );
  return { backend, workspaceId, context, handle, clock, orchestrator };
}

function createRun(handle: (request: Request) => Promise<Response>): Promise<Response> {
  return handle(
    new Request("http://localhost/api/v1/product-research-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        productUrl: "https://example.com",
        productName: "Example",
        description: "",
        geography: "France",
        languages: ["fr"],
        salesMotion: "saas",
        knownCompetitors: [],
        internalDocumentIds: [],
        depth: "standard",
        researchVersion: 2,
      }),
    }),
  );
}

function action(
  handle: (request: Request) => Promise<Response>,
  runId: string,
  name: string,
): Promise<Response> {
  return handle(
    new Request(`http://localhost/api/v1/product-research-runs/${runId}/actions/${name}`, {
      method: "POST",
      headers: { "x-correlation-id": `http-${name}-test` },
    }),
  );
}

class GlobalDeadlineAgents implements ResearchAgentExecutor {
  async execute(): Promise<AgentExecutionResult> {
    throw new TerminalAgentError(
      "RESEARCH_GLOBAL_DEADLINE_EXHAUSTED",
      "The V3 run deadline has expired",
    );
  }
}

class FixtureAgents implements ResearchAgentExecutor {
  async execute(stage: ResearchStage, _input: AgentStageInput): Promise<AgentExecutionResult> {
    return {
      output: validOutputFor(stage),
      metadata: {
        provider: "fixture",
        model: "fixture-v1",
        promptVersion: "http-test-v1",
        parameters: {},
        cost: 0,
        latencyMs: 1,
      },
    };
  }
}
