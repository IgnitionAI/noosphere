import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { CreateProductResearchRun } from "@outbound/application/gtm/product-research-use-cases";
import { ProductResearchApplication } from "@outbound/application/gtm/product-research-application";
import { ResearchOrchestrator } from "@outbound/application/gtm/research-orchestrator";
import type { ResearchAgentExecutor } from "@outbound/application/gtm/product-research-ports";
import type { AgentExecutionResult, AgentStageInput } from "@outbound/contracts/product-research";
import { researchStages, type ResearchStage } from "@outbound/domain/gtm/product-research";
import { CryptoIdGenerator, SystemClock } from "@outbound/application/shared/ports";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { PostgresProductResearchRepository } from "@outbound/infrastructure/gtm/postgres-product-research-repository";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
import { projectResearchStage } from "@outbound/infrastructure/gtm/research-stage-projection";
import { Sha256ContentHasher } from "@outbound/infrastructure/shared/sha256-content-hasher";
import {
  authUsers,
  icpProposals,
  icpVersions,
  researchFindings,
  workspaces,
} from "@outbound/infrastructure/database/schema";
import { createProductResearchHttpHandler } from "@outbound/interface/http/product-research-handler";
import { validOutputFor } from "../fixtures/research-agent-fixtures";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-011 human review and publication", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const repository = new PostgresProductResearchRepository(database.db);
  const queue = new PostgresJobQueue(database.client);
  const ids = new CryptoIdGenerator();
  const clock = new SystemClock();
  const workspaceId = crypto.randomUUID();
  const reviewerId = crypto.randomUUID();
  let runId: string;

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
    await database.db
      .insert(workspaces)
      .values({ id: workspaceId, slug: `workspace-f011-${workspaceId}`, name: "F-011" });
    await database.db.insert(authUsers).values({
      id: reviewerId,
      name: "F-011 Reviewer",
      email: `f011-${reviewerId}@example.com`,
    });
    const create = new CreateProductResearchRun(repository, ids, clock);
    const run = await create.execute({
      workspaceId,
      brief: {
        productUrl: "https://example.com",
        productName: "F-011 Example",
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
    runId = run.snapshot.id;
  });

  afterAll(async () => {
    await database.client`delete from jobs where workspace_id = ${workspaceId}`;
    await database.client`delete from outbox_events where workspace_id = ${workspaceId}`;
    await database.client`delete from product_research_runs where workspace_id = ${workspaceId}`;
    await database.client`delete from auth_users where id = ${reviewerId}`;
    await database.client`delete from workspaces where id = ${workspaceId}`;
    await database.close();
  });

  test("a human correction survives a stage re-projection", async () => {
    await projectResearchStage({
      executor: database.db,
      workspaceId,
      runId,
      stage: "product_analysis",
      output: validOutputFor("product_analysis"),
    });
    await projectResearchStage({
      executor: database.db,
      workspaceId,
      runId,
      stage: "icp_synthesis",
      output: validOutputFor("icp_synthesis"),
    });
    const [proposal] = await database.db
      .select()
      .from(icpProposals)
      .where(eq(icpProposals.runId, runId));
    expect(proposal).toBeDefined();

    // The human corrects the proposal name.
    await database.client`
      update icp_proposals
      set name = 'Human corrected ICP', human_edited = true, updated_at = now()
      where workspace_id = ${workspaceId} and run_id = ${runId}
    `;
    const [finding] = await database.db
      .select()
      .from(researchFindings)
      .where(eq(researchFindings.runId, runId));
    expect(finding).toBeDefined();
    await database.client`
      update research_findings
      set statement = 'Human corrected statement', review_status = 'corrected',
          human_edited = true, updated_at = now()
      where workspace_id = ${workspaceId} and run_id = ${runId}
    `;

    // The stage runs again with a different machine output.
    await projectResearchStage({
      executor: database.db,
      workspaceId,
      runId,
      stage: "product_analysis",
      output: validOutputFor("product_analysis"),
    });
    await projectResearchStage({
      executor: database.db,
      workspaceId,
      runId,
      stage: "icp_synthesis",
      output: validOutputFor("icp_synthesis"),
    });

    const proposalsAfter = await database.client<{ name: string }[]>`
      select name from icp_proposals
      where workspace_id = ${workspaceId} and run_id = ${runId}
    `;
    expect(proposalsAfter.map((row) => row.name)).toContain("Human corrected ICP");
    const findingsAfter = await database.client<
      { statement: string; review_status: string }[]
    >`
      select statement, review_status from research_findings
      where workspace_id = ${workspaceId} and run_id = ${runId} and human_edited
    `;
    expect(findingsAfter.map(({ statement, review_status }) => ({ statement, review_status }))).toEqual([
      { statement: "Human corrected statement", review_status: "corrected" },
    ]);
  });

  test("corrects findings and proposals, then publishes an immutable ICP version gated to admin", async () => {
    const context = {
      userId: reviewerId,
      workspaceId,
      role: "admin" as "admin" | "operator",
    };
    const application = new ProductResearchApplication(repository, repository, ids, clock);
    const handle = createProductResearchHttpHandler({
      application,
      contextResolver: { async resolve() { return context; } },
    });
    const created = (await (
      await handle(
        new Request("http://localhost/api/v1/product-research-runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            productUrl: "https://example.com",
            productName: "F-011 Publication",
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
      )
    ).json()) as { id: string };
    await handle(
      new Request(
        `http://localhost/api/v1/product-research-runs/${created.id}/actions/start`,
        { method: "POST" },
      ),
    );

    const orchestrator = new ResearchOrchestrator(
      repository,
      queue,
      new PublicationFixtureAgents(),
      ids,
      clock,
      new Sha256ContentHasher(),
    );
    for (let stage = 0; stage < researchStages.length; stage += 1) {
      const [job] = await queue.lease({
        workerId: "f011-worker",
        types: ["research.stage.execute"],
        limit: 1,
        leaseMs: 30_000,
        now: clock.now(),
      });
      expect(job).toBeDefined();
      await orchestrator.process(job!);
    }

    const reportResponse = await handle(
      new Request(`http://localhost/api/v1/product-research-runs/${created.id}/report`),
    );
    expect(reportResponse.status).toBe(200);
    const report = (await reportResponse.json()) as {
      findings: Array<{ id: string; statement: string }>;
      proposals: Array<{ id: string; name: string }>;
    };
    const finding = report.findings[0]!;
    const proposal = report.proposals[0]!;

    // Reject a finding: an unresolved contradiction blocks it for publication.
    const correctedFinding = await handle(
      new Request(
        `http://localhost/api/v1/product-research-runs/${created.id}/findings/${finding.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            decision: "rejected",
            reason: "Contradiction non résolue avec une source plus récente",
          }),
        },
      ),
    );
    expect(correctedFinding.status).toBe(200);
    expect(((await correctedFinding.json()) as { humanEdited: boolean }).humanEdited).toBe(true);

    // Correct the proposal name.
    const correctedProposal = await handle(
      new Request(
        `http://localhost/api/v1/product-research-runs/${created.id}/icp-proposals/${proposal.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "ICP validé par le fondateur" }),
        },
      ),
    );
    expect(correctedProposal.status).toBe(200);
    expect(((await correctedProposal.json()) as { name: string }).name).toBe(
      "ICP validé par le fondateur",
    );

    await handle(
      new Request(
        `http://localhost/api/v1/product-research-runs/${created.id}/actions/approve-icp`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proposalId: proposal.id }),
        },
      ),
    );

    context.role = "operator";
    const forbiddenPublish = await handle(
      new Request(
        `http://localhost/api/v1/product-research-runs/${created.id}/actions/publish-icp`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proposalId: proposal.id }),
        },
      ),
    );
    expect(forbiddenPublish.status).toBe(403);

    context.role = "admin";
    const published = await handle(
      new Request(
        `http://localhost/api/v1/product-research-runs/${created.id}/actions/publish-icp`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proposalId: proposal.id }),
        },
      ),
    );
    expect(published.status).toBe(201);
    const version = (await published.json()) as {
      id: string;
      version: number;
      name: string;
      unknowns: string[];
      blockedFindings: Array<{ findingId: string }>;
    };
    expect(version.version).toBe(1);
    expect(version.name).toBe("ICP validé par le fondateur");
    expect(version.unknowns).toContain("Available budget");
    expect(version.blockedFindings.map((row) => row.findingId)).toContain(finding.id);

    const duplicate = await handle(
      new Request(
        `http://localhost/api/v1/product-research-runs/${created.id}/actions/publish-icp`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proposalId: proposal.id }),
        },
      ),
    );
    expect(duplicate.status).toBe(409);

    const versions = await database.db
      .select()
      .from(icpVersions)
      .where(eq(icpVersions.workspaceId, workspaceId));
    expect(versions).toHaveLength(1);
    const outbox = await database.client<{ count: number }[]>`
      select count(*)::int as count from outbox_events
      where workspace_id = ${workspaceId} and event_type = 'ICPVersionPublished'
    `;
    expect(outbox[0]?.count).toBe(1);
  });
});

class PublicationFixtureAgents implements ResearchAgentExecutor {
  async execute(stage: ResearchStage, _input: AgentStageInput): Promise<AgentExecutionResult> {
    return {
      output: validOutputFor(stage),
      metadata: {
        provider: "fixture",
        model: "f011-v1",
        promptVersion: "f011-v1",
        parameters: {},
        cost: 0,
        latencyMs: 1,
      },
    };
  }
}
