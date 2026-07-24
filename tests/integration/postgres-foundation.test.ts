import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { CreateProductResearchRun, StartProductResearchRun } from "@outbound/application/gtm/product-research-use-cases";
import { CryptoIdGenerator, SystemClock } from "@outbound/application/shared/ports";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresProductResearchRepository } from "@outbound/infrastructure/gtm/postgres-product-research-repository";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
import { workspaces } from "@outbound/infrastructure/database/schema";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
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

  afterAll(async () => {
    await database.client`delete from jobs where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from outbox_events where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from product_research_runs where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from workspaces where id in (${workspaceA}, ${workspaceB})`;
    await database.close();
  });

  test("leases a job to exactly one concurrent worker and deduplicates enqueue", async () => {
    const now = new Date();
    const job = {
      id: ids.generate(),
      workspaceId: workspaceA,
      type: "research.stage.execute",
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
    await queue.acknowledge(leased!.id, leased!.lockedBy, new Date());
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
});
