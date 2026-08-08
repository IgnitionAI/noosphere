import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { createCampaignHttpHandler } from "@outbound/interface/http/campaign-handler";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-031 campaigns", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let campaignId = "";
  const offerId = crypto.randomUUID();
  const offerVersionId = crypto.randomUUID();
  const offerVersionTwoId = crypto.randomUUID();
  const icpId = crypto.randomUUID();
  const icpVersionId = crypto.randomUUID();
  const strategyId = crypto.randomUUID();
  const strategyVersionId = crypto.randomUUID();
  const policyId = crypto.randomUUID();
  const policyVersionId = crypto.randomUUID();
  const sequenceId = crypto.randomUUID();
  const sequenceVersionId = crypto.randomUUID();
  const context = { userId, workspaceId, role: "admin" as "admin" | "operator" | "viewer" };
  const handle = createCampaignHttpHandler({
    contextResolver: { async resolve() { return context; } },
    database: database.db,
  });

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.client`
      insert into workspaces (id, slug, name) values
        (${workspaceId}, ${`f031-a-${workspaceId}`}, 'F-031 A'),
        (${otherWorkspaceId}, ${`f031-b-${otherWorkspaceId}`}, 'F-031 B')
    `;
    await database.client`insert into auth_users (id, name, email) values (${userId}, 'Campaign Tester', ${`f031-${userId}@example.com`})`;
    await database.client`insert into offers (id, workspace_id, name, category, value_proposition, target_audience) values (${offerId}, ${workspaceId}, 'Offer', 'autre', 'Value', 'Teams')`;
    await database.client`insert into offer_versions (id, workspace_id, offer_id, version, name, category, value_proposition, target_audience, published_by, published_at) values (${offerVersionId}, ${workspaceId}, ${offerId}, 1, 'Offer', 'autre', 'Value', 'Teams', ${userId}, now())`;
    await database.client`insert into icps (id, workspace_id, name, current_version) values (${icpId}, ${workspaceId}, 'ICP', 1)`;
    await database.client`insert into icp_versions (id, workspace_id, icp_id, version, name, confidence, criteria, buying_committee, problems, signals, exclusions, unknowns, unresolved_contradictions, blocked_findings, published_by, published_at) values (${icpVersionId}, ${workspaceId}, ${icpId}, 1, 'ICP', 0.9, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, ${userId}, now())`;
    await database.client`insert into messaging_strategies (id, workspace_id, name, draft_rules) values (${strategyId}, ${workspaceId}, 'Strategy', '{}'::jsonb)`;
    await database.client`insert into messaging_strategy_versions (id, workspace_id, strategy_id, version, rules, published_by, published_at) values (${strategyVersionId}, ${workspaceId}, ${strategyId}, 1, '{}'::jsonb, ${userId}, now())`;
    await database.client`insert into ai_policies (id, workspace_id, name, draft_rules) values (${policyId}, ${workspaceId}, 'Policy', '{}'::jsonb)`;
    await database.client`insert into ai_policy_versions (id, workspace_id, policy_id, version, rules, published_by, published_at) values (${policyVersionId}, ${workspaceId}, ${policyId}, 1, '{}'::jsonb, ${userId}, now())`;
    await database.client`insert into sequences (id, workspace_id, name) values (${sequenceId}, ${workspaceId}, 'Sequence')`;
    await database.client`insert into sequence_versions (id, workspace_id, sequence_id, version, steps, published_by, published_at) values (${sequenceVersionId}, ${workspaceId}, ${sequenceId}, 1, '[]'::jsonb, ${userId}, now())`;
  });

  afterAll(async () => {
    await database.client.begin(async (sql) => {
      for (const table of ["offer_versions", "icp_versions", "messaging_strategy_versions", "ai_policy_versions", "sequence_versions"]) {
        await sql.unsafe(`alter table ${table} disable trigger user`);
      }
      await sql`delete from campaigns where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from offer_versions where workspace_id = ${workspaceId}`;
      await sql`delete from icp_versions where workspace_id = ${workspaceId}`;
      await sql`delete from messaging_strategy_versions where workspace_id = ${workspaceId}`;
      await sql`delete from ai_policy_versions where workspace_id = ${workspaceId}`;
      await sql`delete from sequence_versions where workspace_id = ${workspaceId}`;
      await sql`delete from offers where workspace_id = ${workspaceId}`;
      await sql`delete from icps where workspace_id = ${workspaceId}`;
      await sql`delete from messaging_strategies where workspace_id = ${workspaceId}`;
      await sql`delete from ai_policies where workspace_id = ${workspaceId}`;
      await sql`delete from sequences where workspace_id = ${workspaceId}`;
      await sql`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      for (const table of ["offer_versions", "icp_versions", "messaging_strategy_versions", "ai_policy_versions", "sequence_versions"]) {
        await sql.unsafe(`alter table ${table} enable trigger user`);
      }
      await sql`alter table audit_logs disable trigger user`;
      await sql`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`alter table audit_logs enable trigger user`;
      await sql`delete from auth_users where id = ${userId}`;
      await sql`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    });
    await database.close();
  });

  function send(method: string, path: string, body?: unknown) {
    return handle(new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }));
  }

  test("preflight, immutable snapshot and idempotent lifecycle", async () => {
    const created = await send("POST", "/api/v1/campaigns", {
      name: "Outbound campaign",
      objective: "Reach legal teams",
      offerVersionId,
      icpVersionId,
      messagingStrategyVersionId: strategyVersionId,
      aiPolicyVersionId: policyVersionId,
      sequenceVersionId,
    });
    expect(created.status).toBe(201);
    const campaign = (await created.json()) as { id: string; status: string; offerVersionId: string };
    campaignId = campaign.id;
    expect(campaign.status).toBe("draft");

    const preflight = await send("POST", `/api/v1/campaigns/${campaignId}/actions/preflight`, {});
    expect(preflight.status).toBe(200);
    const preflightBody = (await preflight.json()) as { ok: boolean; blockers: unknown[]; warnings: Array<{ code: string }> };
    expect(preflightBody.ok).toBe(true);
    expect(preflightBody.blockers).toHaveLength(0);
    expect(preflightBody.warnings.map((warning) => warning.code)).toContain("NO_VERIFIED_SENDER_ACCOUNT");

    const activated = await send("POST", `/api/v1/campaigns/${campaignId}/actions/activate`, {});
    expect(activated.status).toBe(200);
    expect(((await activated.json()) as { status: string }).status).toBe("active");
    const replay = await send("POST", `/api/v1/campaigns/${campaignId}/actions/activate`, {});
    expect(replay.status).toBe(200);

    await database.client`insert into offer_versions (id, workspace_id, offer_id, version, name, category, value_proposition, target_audience, published_by, published_at) values (${offerVersionTwoId}, ${workspaceId}, ${offerId}, 2, 'Offer v2', 'autre', 'Value v2', 'Teams', ${userId}, now())`;
    const detail = await send("GET", `/api/v1/campaigns/${campaignId}`);
    expect(((await detail.json()) as { offerVersionId: string }).offerVersionId).toBe(offerVersionId);
    try {
      await database.client.begin(async (sql) => {
        await sql`savepoint campaign_snapshot_mutation`;
        let snapshotError: unknown;
        try {
          await sql`update campaigns set offer_version_id = ${offerVersionTwoId} where id = ${campaignId}`;
        } catch (error) {
          snapshotError = error;
        }
        expect(String(snapshotError)).toContain("CAMPAIGN_SNAPSHOT_IMMUTABLE");
        await sql`rollback to savepoint campaign_snapshot_mutation`;
        throw new Error("ROLLBACK_F031_TEST");
      });
    } catch (error) {
      expect(String(error)).toContain("ROLLBACK_F031_TEST");
    }

    const activatedEvents = await database.client<{ count: number }[]>`select count(*)::int as count from outbox_events where workspace_id = ${workspaceId} and aggregate_id = ${campaignId} and event_type = 'CampaignActivated'`;
    expect(activatedEvents[0]?.count).toBe(1);
    const activatedAudits = await database.client<{ count: number }[]>`select count(*)::int as count from audit_logs where workspace_id = ${workspaceId} and subject_id = ${campaignId} and action = 'CampaignActivated'`;
    expect(activatedAudits[0]?.count).toBe(1);

    expect((await send("POST", `/api/v1/campaigns/${campaignId}/actions/pause`, {})).status).toBe(200);
    expect((await send("POST", `/api/v1/campaigns/${campaignId}/actions/pause`, {})).status).toBe(200);
    expect((await send("POST", `/api/v1/campaigns/${campaignId}/actions/resume`, {})).status).toBe(200);
    expect((await send("POST", `/api/v1/campaigns/${campaignId}/actions/resume`, {})).status).toBe(200);
    expect((await send("POST", `/api/v1/campaigns/${campaignId}/actions/archive`, {})).status).toBe(200);
    expect((await send("POST", `/api/v1/campaigns/${campaignId}/actions/archive`, {})).status).toBe(200);
    const transitions = await database.client<{ event_type: string; count: number }[]>`select event_type, count(*)::int as count from outbox_events where workspace_id = ${workspaceId} and aggregate_id = ${campaignId} group by event_type`;
    expect(Object.fromEntries(transitions.map((row) => [row.event_type, row.count]))).toMatchObject({ CampaignActivated: 1, CampaignPaused: 1, CampaignResumed: 1, CampaignArchived: 1 });
  });

  test("operator cannot activate and workspace data is isolated", async () => {
    context.role = "operator";
    const forbidden = await send("POST", `/api/v1/campaigns/${campaignId}/actions/activate`, {});
    expect(forbidden.status).toBe(403);
    context.role = "admin";
    context.workspaceId = otherWorkspaceId;
    expect((await send("GET", `/api/v1/campaigns/${campaignId}`)).status).toBe(404);
    context.workspaceId = workspaceId;
  });
});
