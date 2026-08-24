import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import { CreateProductResearchRun, StartProductResearchRun } from "@outbound/application/gtm/product-research-use-cases";
import { ProductResearchApplication } from "@outbound/application/gtm/product-research-application";
import { ResearchOrchestrator } from "@outbound/application/gtm/research-orchestrator";
import type { ResearchAgentExecutor } from "@outbound/application/gtm/product-research-ports";
import { CryptoIdGenerator, SystemClock } from "@outbound/application/shared/ports";
import type { AgentExecutionResult, AgentStageInput } from "@outbound/contracts/product-research";
import type { ResearchStage } from "@outbound/domain/gtm/product-research";
import { createBetterAuthRuntime } from "@outbound/infrastructure/auth/better-auth-runtime";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresProductResearchRepository } from "@outbound/infrastructure/gtm/postgres-product-research-repository";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
import { PostgresJobOutcomeReconciler } from "@outbound/infrastructure/jobs/postgres-job-outcome-reconciler";
import { PostgresResearchToolRequestRegistry } from "@outbound/infrastructure/ai/postgres-research-tool-request-registry";
import {
  marketEvidence,
  productResearchRuns,
  researchDocuments,
  researchWorkItems,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { Sha256ContentHasher } from "@outbound/infrastructure/shared/sha256-content-hasher";
import { createProductResearchHttpHandler } from "@outbound/interface/http/product-research-handler";
import { createWorkspaceHttpHandler } from "@outbound/interface/http/workspace-handler";
import { bootstrapOwner } from "../../scripts/bootstrap-owner";
import { validOutputFor } from "../fixtures/research-agent-fixtures";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("PostgreSQL F-009 foundation", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const queue = new PostgresJobQueue(database.client);
  const repository = new PostgresProductResearchRepository(database.db);
  const ids = new CryptoIdGenerator();
  const clock = new SystemClock();
  const workspaceA = crypto.randomUUID();
  const workspaceB = crypto.randomUUID();

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
    await database.db.insert(workspaces).values([
      { id: workspaceA, slug: `workspace-a-${workspaceA}`, name: "Workspace A" },
      { id: workspaceB, slug: `workspace-b-${workspaceB}`, name: "Workspace B" },
    ]);
  });

  afterEach(async () => {
    await database.client`delete from jobs where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from research_documents where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from outbox_events where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from product_research_runs where workspace_id in (${workspaceA}, ${workspaceB})`;
  });

  afterAll(async () => {
    await database.client`delete from jobs where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from research_documents where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from outbox_events where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from product_research_runs where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from workspaces where id in (${workspaceA}, ${workspaceB})`;
    await database.close();
  });

  test("leases a job to exactly one concurrent worker and deduplicates enqueue", async () => {
    const now = new Date();
    const jobType = `integration.queue.${crypto.randomUUID()}`;
    const job = {
      id: ids.generate(),
      workspaceId: workspaceA,
      type: jobType,
      payload: { test: true },
      idempotencyKey: `queue-contract-${crypto.randomUUID()}`,
      correlationId: "integration-queue",
      maxAttempts: 3,
      availableAt: now,
    };
    expect(await queue.enqueue(job)).toEqual({ inserted: true });
    expect(await queue.enqueue({ ...job, id: ids.generate() })).toEqual({ inserted: false });

    const leaseRequest = {
      types: [job.type],
      limit: 1,
      leaseMs: 30_000,
      now,
    };
    const [workerA, workerB] = await Promise.all([
      queue.lease({ ...leaseRequest, workerId: "worker-a" }),
      queue.lease({ ...leaseRequest, workerId: "worker-b" }),
    ]);
    expect(workerA.length + workerB.length).toBe(1);
    const leased = workerA[0] ?? workerB[0];
    expect(leased).toBeDefined();
    expect(leased!.payload).toEqual({ test: true });
    await queue.acknowledge(leased!.id, leased!.lockedBy, new Date());
  });

  test("dead-letters an expired final lease instead of leaving the job running forever", async () => {
    const now = new Date();
    const jobType = `integration.expired-final-lease.${crypto.randomUUID()}`;
    const jobId = ids.generate();
    await queue.enqueue({
      id: jobId,
      workspaceId: workspaceA,
      type: jobType,
      payload: { test: "worker-crash" },
      idempotencyKey: `expired-final-lease-${crypto.randomUUID()}`,
      correlationId: "integration-expired-final-lease",
      maxAttempts: 1,
      availableAt: now,
    });
    const [leased] = await queue.lease({
      workerId: "crashed-worker",
      types: [jobType],
      limit: 1,
      leaseMs: 1_000,
      now,
    });
    expect(leased?.attempts).toBe(1);

    const afterExpiry = new Date(now.getTime() + 2_000);
    expect(await queue.lease({
      workerId: "recovery-worker",
      types: [jobType],
      limit: 1,
      leaseMs: 1_000,
      now: afterExpiry,
    })).toEqual([]);

    const rows = await database.client<{ status: string; last_error_code: string | null; completed_at: Date | null }[]>`
      select status, last_error_code, completed_at
      from jobs
      where id = ${jobId}
    `;
    expect(rows[0]).toMatchObject({
      status: "dead_lettered",
      last_error_code: "JOB_LEASE_EXHAUSTED",
      completed_at: afterExpiry,
    });
  });

  test("defers scheduled work without exhausting the retry budget", async () => {
    const now = new Date();
    const availableAt = new Date(now.getTime() + 60_000);
    const jobType = `integration.defer.${crypto.randomUUID()}`;
    const jobId = ids.generate();
    await queue.enqueue({
      id: jobId,
      workspaceId: workspaceA,
      type: jobType,
      payload: { reason: "outside-window" },
      idempotencyKey: `defer-${crypto.randomUUID()}`,
      correlationId: "integration-defer",
      maxAttempts: 1,
      availableAt: now,
    });
    const [leased] = await queue.lease({
      workerId: "window-worker",
      types: [jobType],
      limit: 1,
      leaseMs: 30_000,
      now,
    });
    await queue.defer({
      jobId,
      workerId: leased!.lockedBy,
      availableAt,
      errorCode: "OUTSIDE_SENDING_WINDOW",
      errorMessage: "Wait for the configured window",
    });

    const rows = await database.client<{ status: string; attempts: number; available_at: Date }[]>`
      select status, attempts, available_at from jobs where id = ${jobId}
    `;
    expect(rows[0]).toMatchObject({ status: "pending", attempts: 0, available_at: availableAt });
    const [reLeased] = await queue.lease({
      workerId: "next-window-worker",
      types: [jobType],
      limit: 1,
      leaseMs: 30_000,
      now: availableAt,
    });
    expect(reLeased?.attempts).toBe(1);
    await queue.acknowledge(reLeased!.id, reLeased!.lockedBy, availableAt);
  });

  test("normalizes and revives one legacy document job without touching provider delivery jobs", async () => {
    const now = new Date();
    const documentId = crypto.randomUUID();
    const documentJobId = crypto.randomUUID();
    const deliveryJobId = crypto.randomUUID();
    await database.db.insert(researchDocuments).values({
      id: documentId,
      workspaceId: workspaceA,
      filename: "legacy.md",
      contentType: "text/markdown",
      sizeBytes: 12,
      checksumSha256: "a".repeat(64),
      objectKey: `${workspaceA}/legacy.md`,
      status: "uploaded",
    });
    await queue.enqueue({
      id: documentJobId,
      workspaceId: workspaceA,
      type: "research.document.process",
      payload: JSON.stringify({ workspaceId: workspaceA, documentId }),
      idempotencyKey: `legacy-document-${documentId}`,
      correlationId: "integration-document-reconcile",
      maxAttempts: 3,
      availableAt: now,
    });
    await queue.enqueue({
      id: deliveryJobId,
      workspaceId: workspaceA,
      type: "outreach.dispatch",
      payload: { workspaceId: workspaceA, actionId: crypto.randomUUID() },
      idempotencyKey: `delivery-${crypto.randomUUID()}`,
      correlationId: "integration-provider-delivery",
      maxAttempts: 3,
      availableAt: now,
    });
    await database.client`
      update jobs set status = 'dead_lettered', attempts = max_attempts, completed_at = ${now}
      where id in (${documentJobId}, ${deliveryJobId})
    `;

    const reconciler = new PostgresJobOutcomeReconciler(database.db, { now: () => now });
    expect(await reconciler.reconcile()).toBe(1);
    const rows = await database.client<{ id: string; status: string; attempts: number; payload: unknown }[]>`
      select id, status, attempts, payload from jobs where id in (${documentJobId}, ${deliveryJobId}) order by id
    `;
    const documentJob = rows.find((row) => row.id === documentJobId);
    const deliveryJob = rows.find((row) => row.id === deliveryJobId);
    expect(documentJob).toMatchObject({
      status: "pending",
      attempts: 0,
      payload: { workspaceId: workspaceA, documentId, _reconciliationAttempts: 1 },
    });
    expect(deliveryJob?.status).toBe("dead_lettered");
  });

  test("leases fairly across workspaces even when one workspace has a large fan-out", async () => {
    const now = new Date();
    const jobType = `integration.fairness.${crypto.randomUUID()}`;
    for (let index = 0; index < 4; index += 1) {
      await queue.enqueue({
        id: ids.generate(),
        workspaceId: workspaceA,
        type: jobType,
        payload: { index },
        idempotencyKey: `workspace-a-${index}-${crypto.randomUUID()}`,
        correlationId: "integration-fairness",
        maxAttempts: 3,
        availableAt: now,
      });
    }
    await queue.enqueue({
      id: ids.generate(),
      workspaceId: workspaceB,
      type: jobType,
      payload: { index: 0 },
      idempotencyKey: `workspace-b-${crypto.randomUUID()}`,
      correlationId: "integration-fairness",
      maxAttempts: 3,
      availableAt: now,
    });

    const leased = await queue.lease({
      workerId: "fair-worker",
      types: [jobType],
      limit: 2,
      leaseMs: 30_000,
      now,
    });

    expect(new Set(leased.map((job) => job.workspaceId))).toEqual(
      new Set([workspaceA, workspaceB]),
    );
    await Promise.all(
      leased.map((job) => queue.acknowledge(job.id, job.lockedBy, new Date())),
    );
  });

  test("leases the highest-priority due job first inside one workspace", async () => {
    const now = new Date();
    const jobType = `integration.priority.${crypto.randomUUID()}`;
    await queue.enqueue({
      id: ids.generate(), workspaceId: workspaceA, type: jobType, payload: { priority: "low" },
      idempotencyKey: crypto.randomUUID(), correlationId: "priority", maxAttempts: 3,
      availableAt: new Date(now.getTime() - 60_000), priority: 1,
    });
    await queue.enqueue({
      id: ids.generate(), workspaceId: workspaceA, type: jobType, payload: { priority: "high" },
      idempotencyKey: crypto.randomUUID(), correlationId: "priority", maxAttempts: 3,
      availableAt: now, priority: 100,
    });
    const [leased] = await queue.lease({
      workerId: "priority-worker", types: [jobType], limit: 1, leaseMs: 30_000, now,
    });
    expect(leased?.payload).toEqual({ priority: "high" });
    expect(leased?.priority).toBe(100);
    await queue.acknowledge(leased!.id, leased!.lockedBy, now);
  });

  test("allows only one active research run per workspace", async () => {
    const create = new CreateProductResearchRun(repository, ids, clock);
    const start = new StartProductResearchRun(repository, ids, clock);
    const brief = {
      productUrl: "https://example.com",
      productName: "Active-run invariant",
      description: "",
      geography: "France",
      languages: ["fr"],
      salesMotion: "saas" as const,
      knownCompetitors: [],
      internalDocumentIds: [],
      depth: "standard" as const,
      researchVersion: 3 as const,
    };
    const first = await create.execute({ workspaceId: workspaceA, brief });
    const second = await create.execute({
      workspaceId: workspaceA,
      brief: { ...brief, productName: "Second active-run candidate" },
    });
    await start.execute({
      workspaceId: workspaceA,
      runId: first.snapshot.id,
      correlationId: "first-active-run",
    });

    await expect(start.execute({
      workspaceId: workspaceA,
      runId: second.snapshot.id,
      correlationId: "second-active-run",
    })).rejects.toThrow();

    await database.db
      .update(productResearchRuns)
      .set({ status: "completed", activeStage: null })
      .where(eq(productResearchRuns.id, first.snapshot.id));
    const startedSecond = await start.execute({
      workspaceId: workspaceA,
      runId: second.snapshot.id,
      correlationId: "second-active-run-after-completion",
    });
    expect(startedSecond.snapshot.status).toBe("queued");
  });

  test("claims identical research tool calls once, caches success and reclaims expired leases", async () => {
    const run = await new CreateProductResearchRun(repository, ids, clock).execute({
      workspaceId: workspaceA,
      brief: {
        productUrl: "https://example.com",
        productName: "Tool registry",
        description: "",
        geography: "France",
        languages: ["fr"],
        salesMotion: "saas",
        knownCompetitors: [],
        internalDocumentIds: [],
        depth: "standard",
        researchVersion: 3,
      },
    });
    const registry = new PostgresResearchToolRequestRegistry(database.db);
    const now = new Date();
    const claimInput = {
      workspaceId: workspaceA,
      runId: run.snapshot.id,
      toolName: "searchWeb",
      normalizedInputHash: "a".repeat(64),
      normalizedInput: { query: "buyer workflow", limit: 5 },
      now,
      leaseMs: 1_000,
    };
    const claims = await Promise.all([
      registry.claim(claimInput),
      registry.claim(claimInput),
      registry.claim(claimInput),
    ]);
    expect(claims.filter((claim) => claim.kind === "execute")).toHaveLength(1);
    expect(claims.filter((claim) => claim.kind === "in_progress")).toHaveLength(2);
    const lease = claims.find((claim) => claim.kind === "execute")!;
    if (lease.kind !== "execute") throw new Error("expected lease");
    await registry.complete({
      leaseToken: lease.leaseToken,
      output: "[]",
      contentHash: "b".repeat(64),
      now: new Date(now.getTime() + 10),
    });
    expect(await registry.claim({ ...claimInput, now: new Date(now.getTime() + 20) })).toEqual({
      kind: "cache_hit",
      output: "[]",
      contentHash: "b".repeat(64),
    });

    const expiring = await registry.claim({
      ...claimInput,
      normalizedInputHash: "c".repeat(64),
      normalizedInput: { query: "another workflow", limit: 5 },
      leaseMs: 5,
    });
    expect(expiring.kind).toBe("execute");
    const reclaimed = await registry.claim({
      ...claimInput,
      normalizedInputHash: "c".repeat(64),
      normalizedInput: { query: "another workflow", limit: 5 },
      now: new Date(now.getTime() + 10),
      leaseMs: 1_000,
    });
    expect(reclaimed.kind).toBe("execute");
  });

  test("persists four concurrent market work items and inserts one durable finalizer", async () => {
    const run = await new CreateProductResearchRun(repository, ids, clock).execute({
      workspaceId: workspaceA,
      brief: {
        productUrl: "https://example.com",
        productName: "Fanout integration",
        description: "",
        geography: "France",
        languages: ["fr"],
        salesMotion: "saas",
        knownCompetitors: [],
        internalDocumentIds: [],
        depth: "standard",
        researchVersion: 3,
      },
    });
    await new StartProductResearchRun(repository, ids, clock).execute({
      workspaceId: workspaceA,
      runId: run.snapshot.id,
      correlationId: "postgres-fanout",
    });
    const orchestrator = new ResearchOrchestrator(
      repository,
      queue,
      new FanoutIntegrationFixtureAgents(),
      ids,
      clock,
      new Sha256ContentHasher(),
    );
    for (let index = 0; index < 3; index += 1) {
      const [job] = await queue.lease({
        workerId: "fanout-planner",
        types: ["research.stage.execute"],
        limit: 1,
        leaseMs: 30_000,
        now: new Date(),
      });
      await orchestrator.process(job!);
    }
    const children = await queue.lease({
      workerId: "fanout-workers",
      types: ["research.stage.execute"],
      limit: 10,
      leaseMs: 30_000,
      now: new Date(),
    });
    expect(children).toHaveLength(4);
    await Promise.all(children.map((job) => orchestrator.process(job)));
    const finalizers = await queue.lease({
      workerId: "fanout-finalizer",
      types: ["research.stage.execute"],
      limit: 10,
      leaseMs: 30_000,
      now: new Date(),
    });
    expect(finalizers).toHaveLength(1);
    expect(finalizers[0]?.payload).toMatchObject({ finalizeFanout: true });
    await orchestrator.process(finalizers[0]!);

    const persistedItems = await database.db
      .select()
      .from(researchWorkItems)
      .where(eq(researchWorkItems.runId, run.snapshot.id));
    expect(persistedItems).toHaveLength(4);
    expect(persistedItems.every((item) => item.status === "completed")).toBe(true);
    const joined = await repository.findCompletedCheckpoint(
      workspaceA,
      run.snapshot.id,
      "market_investigation",
    );
    const joinedOutput = joined?.output as {
      investigations: unknown[];
      notInvestigatedHypothesisIds: string[];
    };
    expect(joinedOutput.notInvestigatedHypothesisIds).toEqual(["H05"]);
    expect(Array.isArray(joinedOutput.investigations)).toBe(true);
    expect(joinedOutput.investigations).toHaveLength(4);
  });

  test("persists run state, first job and outbox event atomically with workspace isolation", async () => {
    const create = new CreateProductResearchRun(repository, ids, clock);
    const start = new StartProductResearchRun(repository, ids, clock);
    const run = await create.execute({
      workspaceId: workspaceA,
      brief: {
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
      },
    });
    await start.execute({
      workspaceId: workspaceA,
      runId: run.snapshot.id,
      correlationId: "integration-start",
    });

    expect((await repository.findById(workspaceA, run.snapshot.id))?.snapshot.status).toBe("queued");
    expect(await repository.findById(workspaceB, run.snapshot.id)).toBeNull();
    const rows = await database.client<{ jobs: number; events: number }[]>`
      select
        (select count(*)::int from jobs where workspace_id = ${workspaceA} and payload->>'runId' = ${run.snapshot.id}) as jobs,
        (select count(*)::int from outbox_events where workspace_id = ${workspaceA} and aggregate_id = ${run.snapshot.id}) as events
    `;
    expect(rows[0]).toEqual({ jobs: 1, events: 1 });

    let crossWorkspaceInsertRejected = false;
    try {
      await database.client`
        insert into research_stage_runs (
          id, workspace_id, run_id, stage, attempt, status, input_hash, started_at
        ) values (
          ${ids.generate()}, ${workspaceB}, ${run.snapshot.id}, 'product_analysis', 1,
          'running', 'cross-workspace', now()
        )
      `;
    } catch {
      crossWorkspaceInsertRejected = true;
    }
    expect(crossWorkspaceInsertRejected).toBe(true);
  });

  test("serves the HTTP workflow and invalidates checkpoints transactionally", async () => {
    const application = new ProductResearchApplication(repository, repository, ids, clock);
    const handle = createProductResearchHttpHandler({
      application,
      contextResolver: {
        async resolve() {
          return { userId: crypto.randomUUID(), workspaceId: workspaceA, role: "operator" };
        },
      },
    });
    const createResponse = await handle(
      new Request("http://localhost/api/v1/product-research-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productUrl: "https://example.com",
          productName: "HTTP Integration",
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
    const created = (await createResponse.json()) as { id: string };
    expect(createResponse.status).toBe(201);
    expect(
      (
        await handle(
          new Request(
            `http://localhost/api/v1/product-research-runs/${created.id}/actions/start`,
            { method: "POST" },
          ),
        )
      ).status,
    ).toBe(202);

    const orchestrator = new ResearchOrchestrator(
      repository,
      queue,
      new IntegrationFixtureAgents(),
      ids,
      clock,
      new Sha256ContentHasher(),
    );
    let processedStages = 0;
    while (processedStages < 3) {
      const leased = await queue.lease({
        workerId: "integration-http-worker",
        types: ["research.stage.execute"],
        limit: 1,
        leaseMs: 30_000,
        now: clock.now(),
      });
      const job = leased[0]!;
      const payload = job.payload as { runId?: string };
      if (payload.runId !== created.id) {
        await queue.acknowledge(job.id, job.lockedBy, clock.now());
        continue;
      }
      await orchestrator.process(job);
      processedStages += 1;
    }
    await database.db.insert(marketEvidence).values({
      id: ids.generate(),
      workspaceId: workspaceA,
      runId: created.id,
      sourceType: "public_web",
      url: "https://example.com/evidence",
      title: "Integration evidence",
      excerpt: "A persisted source excerpt.",
      contentHash: crypto.randomUUID().replaceAll("-", ""),
      observedAt: clock.now(),
    });

    const evidenceResponse = await handle(
      new Request(
        `http://localhost/api/v1/product-research-runs/${created.id}/evidence?limit=1`,
      ),
    );
    expect(evidenceResponse.status).toBe(200);
    expect(((await evidenceResponse.json()) as { data: unknown[] }).data).toHaveLength(1);

    const researchMore = await handle(
      new Request(
        `http://localhost/api/v1/product-research-runs/${created.id}/actions/research-more`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fromStage: "competitor_discovery",
            reason: "Integration test requests more research",
          }),
        },
      ),
    );
    expect(researchMore.status).toBe(202);
    const checkpoints = await database.client<{ stage: string; status: string }[]>`
      select stage::text, status::text
      from research_stage_runs
      where workspace_id = ${workspaceA} and run_id = ${created.id}
      order by started_at
    `;
    expect(checkpoints.map(({ stage, status }) => ({ stage, status }))).toEqual([
      { stage: "product_analysis", status: "completed" },
      { stage: "competitor_discovery", status: "invalidated" },
      { stage: "competitor_analysis", status: "invalidated" },
    ]);

    // Re-executing an invalidated stage must allocate a fresh attempt number
    // instead of colliding with the invalidated checkpoint row. Stale jobs
    // from before the invalidation are acknowledged without crashing.
    let reexecuted = false;
    for (let guard = 0; guard < 10 && !reexecuted; guard += 1) {
      const leased = await queue.lease({
        workerId: "integration-http-worker",
        types: ["research.stage.execute"],
        limit: 1,
        leaseMs: 30_000,
        now: clock.now(),
      });
      const job = leased[0];
      if (!job) break;
      const payload = job.payload as { runId?: string; stage?: string };
      if (payload.runId !== created.id) {
        await queue.acknowledge(job.id, job.lockedBy, clock.now());
        continue;
      }
      const outcome = await orchestrator.process(job);
      reexecuted =
        payload.stage === "competitor_discovery" && outcome.outcome === "completed";
    }
    expect(reexecuted).toBe(true);
    const discoveryAttempts = await database.client<
      { attempt: number; status: string }[]
    >`
      select attempt, status::text
      from research_stage_runs
      where workspace_id = ${workspaceA} and run_id = ${created.id} and stage = 'competitor_discovery'
      order by attempt
    `;
    expect(discoveryAttempts.map(({ attempt, status }) => ({ attempt, status }))).toEqual([
      { attempt: 1, status: "invalidated" },
      { attempt: 2, status: "completed" },
    ]);

    let continuedToNextStage = false;
    for (let guard = 0; guard < 10 && !continuedToNextStage; guard += 1) {
      const leased = await queue.lease({
        workerId: "integration-http-worker",
        types: ["research.stage.execute"],
        limit: 1,
        leaseMs: 30_000,
        now: clock.now(),
      });
      const job = leased[0];
      if (!job) break;
      const payload = job.payload as { runId?: string; stage?: string };
      if (payload.runId !== created.id) {
        await queue.acknowledge(job.id, job.lockedBy, clock.now());
        continue;
      }
      const outcome = await orchestrator.process(job);
      continuedToNextStage =
        payload.stage === "competitor_analysis" && outcome.outcome === "completed";
    }
    expect(continuedToNextStage).toBe(true);
    const analysisAttempts = await database.client<
      { attempt: number; status: string }[]
    >`
      select attempt, status::text
      from research_stage_runs
      where workspace_id = ${workspaceA} and run_id = ${created.id} and stage = 'competitor_analysis'
      order by attempt
    `;
    expect(analysisAttempts.map(({ attempt, status }) => ({ attempt, status }))).toEqual([
      { attempt: 1, status: "invalidated" },
      { attempt: 2, status: "completed" },
    ]);
  });

  test("authenticates a real session and resolves its workspace membership", async () => {
    const email = `integration-${crypto.randomUUID()}@example.com`;
    const closedAuth = createBetterAuthRuntime(database.db, {
      baseUrl: "http://localhost",
      secret: "integration-secret-with-at-least-32-characters",
      trustedOrigins: ["http://localhost"],
    });
    const forbiddenSignUp = await closedAuth.handle(
      new Request("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({
          name: "Uninvited User",
          email,
          password: "integration-password-123",
        }),
      }),
    );
    expect(forbiddenSignUp.status).toBe(400);
    expect((await forbiddenSignUp.json()) as { code: string }).toMatchObject({
      code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
    });

    const bootstrap = await bootstrapOwner(database.db, {
      baseUrl: "http://localhost",
      secret: "integration-secret-with-at-least-32-characters",
      email,
      name: "Integration Operator",
      password: "integration-password-123",
      workspaceSlug: `workspace-a-${workspaceA}`,
      workspaceName: "Workspace A",
    });
    expect(bootstrap.workspaceId).toBe(workspaceA);
    expect(
      await bootstrapOwner(database.db, {
        baseUrl: "http://localhost",
        secret: "integration-secret-with-at-least-32-characters",
        email,
        name: "Integration Operator",
        password: "integration-password-123",
        workspaceSlug: `workspace-a-${workspaceA}`,
        workspaceName: "Workspace A",
      }),
    ).toEqual(bootstrap);

    const signIn = await closedAuth.handle(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({
          email,
          password: "integration-password-123",
        }),
      }),
    );
    expect(signIn.status).toBe(200);
    const cookie = responseCookies(signIn);
    expect(cookie).toContain("session_token");

    const workspaceResponse = await createWorkspaceHttpHandler({
      sessions: closedAuth.sessions,
      memberships: closedAuth.memberships,
    })(
      new Request("http://localhost/api/v1/workspaces", {
        headers: { cookie },
      }),
    );
    expect(workspaceResponse.status).toBe(200);
    expect(await workspaceResponse.json()).toMatchObject({
      data: [
        {
          id: workspaceA,
          slug: `workspace-a-${workspaceA}`,
          role: "owner",
        },
      ],
    });

    const handle = createProductResearchHttpHandler({
      application: new ProductResearchApplication(repository, repository, ids, clock),
      contextResolver: closedAuth.contextResolver,
    });
    const createResponse = await handle(
      new Request("http://localhost/api/v1/product-research-runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-workspace-slug": `workspace-a-${workspaceA}`,
        },
        body: JSON.stringify({
          productUrl: "https://example.com",
          productName: "Authenticated HTTP Integration",
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
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { id: string };

    const missingWorkspace = await handle(
      new Request(`http://localhost/api/v1/product-research-runs/${created.id}`, {
        headers: { cookie },
      }),
    );
    expect(missingWorkspace.status).toBe(400);
    expect((await missingWorkspace.json()) as { code: string }).toMatchObject({
      code: "WORKSPACE_CONTEXT_REQUIRED",
    });

    await database.client`
      update workspace_members
      set status = 'disabled'
      where workspace_id = ${workspaceA} and user_id = ${bootstrap.userId}
    `;
    const disabledMembership = await handle(
      new Request(`http://localhost/api/v1/product-research-runs/${created.id}`, {
        headers: {
          cookie,
          "x-workspace-slug": `workspace-a-${workspaceA}`,
        },
      }),
    );
    expect(disabledMembership.status).toBe(403);
    expect((await disabledMembership.json()) as { code: string }).toMatchObject({
      code: "WORKSPACE_FORBIDDEN",
    });

    const signOut = await closedAuth.handle(
      new Request("http://localhost/api/auth/sign-out", {
        method: "POST",
        headers: {
          cookie,
          origin: "http://localhost",
        },
      }),
    );
    expect(signOut.status).toBe(200);
    const revokedResponse = await handle(
      new Request(`http://localhost/api/v1/product-research-runs/${created.id}`, {
        headers: {
          cookie,
          "x-workspace-slug": `workspace-a-${workspaceA}`,
        },
      }),
    );
    expect(revokedResponse.status).toBe(401);
  });
});

class IntegrationFixtureAgents implements ResearchAgentExecutor {
  async execute(stage: ResearchStage, _input: AgentStageInput): Promise<AgentExecutionResult> {
    return {
      output: validOutputFor(stage),
      metadata: {
        provider: "fixture",
        model: "integration-v1",
        promptVersion: "integration-v1",
        parameters: {},
        cost: 0,
        latencyMs: 1,
      },
    };
  }
}

class FanoutIntegrationFixtureAgents implements ResearchAgentExecutor {
  async execute(stage: ResearchStage, input: AgentStageInput): Promise<AgentExecutionResult> {
    const output = structuredClone(validOutputFor(stage)) as Record<string, any>;
    if (stage === "organization_discovery") {
      const base = output.hypotheses[0];
      output.hypotheses = Array.from({ length: 5 }, (_, index) => ({
        ...structuredClone(base),
        hypothesisId: `H${String(index + 1).padStart(2, "0")}`,
        organizationType: `Evidence-derived organization ${index + 1}`,
      }));
    }
    if (stage === "market_investigation" && input.workItemKey !== "main") {
      output.investigations[0].hypothesisId = input.workItemKey.replace("hypothesis:", "");
    }
    return {
      output: output as AgentExecutionResult["output"],
      metadata: {
        provider: "fixture",
        model: "fanout-integration-v1",
        promptVersion: "fanout-integration-v1",
        parameters: {},
        cost: 0,
        latencyMs: 1,
      },
    };
  }
}

function responseCookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}
