import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
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
import {
  marketEvidence,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { Sha256ContentHasher } from "@outbound/infrastructure/shared/sha256-content-hasher";
import { createProductResearchHttpHandler } from "@outbound/interface/http/product-research-handler";
import { bootstrapOwner } from "../../scripts/bootstrap-owner";
import { validOutputFor } from "../fixtures/research-agent-fixtures";

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

function responseCookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}
