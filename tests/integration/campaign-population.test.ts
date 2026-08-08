import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { createCampaignHttpHandler } from "@outbound/interface/http/campaign-handler";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-032 campaign population and enrollment", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const competingCampaignId = crypto.randomUUID();
  const normalContactId = crypto.randomUUID();
  const excludedContactId = crypto.randomUUID();
  const suppressedContactId = crypto.randomUUID();
  const companyId = crypto.randomUUID();
  const largeCompanyId = crypto.randomUUID();
  const offerId = crypto.randomUUID();
  const offerVersionId = crypto.randomUUID();
  const icpId = crypto.randomUUID();
  const icpVersionId = crypto.randomUUID();
  const strategyId = crypto.randomUUID();
  const strategyVersionId = crypto.randomUUID();
  const policyId = crypto.randomUUID();
  const policyVersionId = crypto.randomUUID();
  const sequenceId = crypto.randomUUID();
  const sequenceVersionId = crypto.randomUUID();
  const competingSequenceId = crypto.randomUUID();
  const competingSequenceVersionId = crypto.randomUUID();
  const context = { userId, workspaceId, role: "admin" as "admin" | "operator" | "reviewer" | "viewer" };
  const handle = createCampaignHttpHandler({ database: database.db, contextResolver: { async resolve() { return context; } } });

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.client`insert into workspaces (id, slug, name) values (${workspaceId}, ${`f032-a-${workspaceId}`}, 'F-032 A'), (${otherWorkspaceId}, ${`f032-b-${otherWorkspaceId}`}, 'F-032 B')`;
    await database.client`insert into auth_users (id, name, email) values (${userId}, 'Population Tester', ${`f032-${userId}@example.com`})`;
    await database.client`insert into companies (id, workspace_id, name, sector, employee_count_min, employee_count_max, location) values
      (${companyId}, ${workspaceId}, 'Legal Co', 'legal', 50, 100, 'France'),
      (${largeCompanyId}, ${workspaceId}, 'Large Legal Co', 'legal', 2000, 3000, 'France')`;
    await database.client`insert into contacts (id, workspace_id, first_name, last_name, source) values
      (${normalContactId}, ${workspaceId}, 'Normal', 'Prospect', 'manual'),
      (${excludedContactId}, ${workspaceId}, 'Large', 'Prospect', 'manual'),
      (${suppressedContactId}, ${workspaceId}, 'Suppressed', 'Prospect', 'manual')`;
    await database.client`insert into contact_identities (id, workspace_id, contact_id, type, value, normalized_value) values
      (${crypto.randomUUID()}, ${workspaceId}, ${normalContactId}, 'email', 'normal@example.com', 'normal@example.com'),
      (${crypto.randomUUID()}, ${workspaceId}, ${excludedContactId}, 'email', 'large@example.com', 'large@example.com'),
      (${crypto.randomUUID()}, ${workspaceId}, ${suppressedContactId}, 'email', 'suppressed@example.com', 'suppressed@example.com')`;
    await database.client`insert into contact_employments (id, workspace_id, contact_id, company_id, title, started_on, is_current) values
      (${crypto.randomUUID()}, ${workspaceId}, ${normalContactId}, ${companyId}, 'Counsel', '2024-01-01', true),
      (${crypto.randomUUID()}, ${workspaceId}, ${excludedContactId}, ${largeCompanyId}, 'Counsel', '2024-01-01', true),
      (${crypto.randomUUID()}, ${workspaceId}, ${suppressedContactId}, ${companyId}, 'Counsel', '2024-01-01', true)`;
    await database.client`insert into offers (id, workspace_id, name, category, value_proposition, target_audience) values (${offerId}, ${workspaceId}, 'Offer F032', 'autre', 'Value', 'Legal')`;
    await database.client`insert into offer_versions (id, workspace_id, offer_id, version, name, category, value_proposition, target_audience, published_by, published_at) values (${offerVersionId}, ${workspaceId}, ${offerId}, 1, 'Offer F032', 'autre', 'Value', 'Legal', ${userId}, now())`;
    await database.client`insert into icps (id, workspace_id, name, current_version) values (${icpId}, ${workspaceId}, 'ICP F032', 1)`;
    await database.client`insert into icp_versions (id, workspace_id, icp_id, version, name, confidence, criteria, buying_committee, problems, signals, exclusions, unknowns, unresolved_contradictions, blocked_findings, published_by, published_at) values (${icpVersionId}, ${workspaceId}, ${icpId}, 1, 'ICP F032', 0.9, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, ${userId}, now())`;
    await database.client`insert into icp_criterion (id, workspace_id, icp_version_id, dimension, operator, expected_value, weight, required, exclusion) values
      (${crypto.randomUUID()}, ${workspaceId}, ${icpVersionId}, 'company.sector', 'equals', '"legal"'::jsonb, 1, true, false),
      (${crypto.randomUUID()}, ${workspaceId}, ${icpVersionId}, 'company.employee_count_min', 'gte', '1000'::jsonb, 1, false, true)`;
    await database.client`insert into messaging_strategies (id, workspace_id, name, draft_rules) values (${strategyId}, ${workspaceId}, 'Strategy F032', '{}'::jsonb)`;
    await database.client`insert into messaging_strategy_versions (id, workspace_id, strategy_id, version, rules, published_by, published_at) values (${strategyVersionId}, ${workspaceId}, ${strategyId}, 1, '{}'::jsonb, ${userId}, now())`;
    await database.client`insert into ai_policies (id, workspace_id, name, draft_rules) values (${policyId}, ${workspaceId}, 'Policy F032', '{}'::jsonb)`;
    await database.client`insert into ai_policy_versions (id, workspace_id, policy_id, version, rules, published_by, published_at) values (${policyVersionId}, ${workspaceId}, ${policyId}, 1, '{}'::jsonb, ${userId}, now())`;
    await database.client`insert into sequences (id, workspace_id, name) values (${sequenceId}, ${workspaceId}, 'Sequence F032'), (${competingSequenceId}, ${workspaceId}, 'Sequence Competing')`;
    await database.client`insert into sequence_versions (id, workspace_id, sequence_id, version, steps, published_by, published_at) values
      (${sequenceVersionId}, ${workspaceId}, ${sequenceId}, 1, '[{"kind":"email","body":"Hello"}]'::jsonb, ${userId}, now()),
      (${competingSequenceVersionId}, ${workspaceId}, ${competingSequenceId}, 1, '[{"kind":"email","body":"Hello"}]'::jsonb, ${userId}, now())`;
    await database.client`insert into campaigns (id, workspace_id, name, status, offer_version_id, icp_version_id, messaging_strategy_version_id, ai_policy_version_id, sequence_version_id, created_by, activated_by, activated_at) values
      (${campaignId}, ${workspaceId}, 'Campaign F032', 'active', ${offerVersionId}, ${icpVersionId}, ${strategyVersionId}, ${policyVersionId}, ${sequenceVersionId}, ${userId}, ${userId}, now()),
      (${competingCampaignId}, ${workspaceId}, 'Campaign Competing', 'active', ${offerVersionId}, ${icpVersionId}, ${strategyVersionId}, ${policyVersionId}, ${competingSequenceVersionId}, ${userId}, ${userId}, now())`;
  });

  afterAll(async () => {
    await database.client.begin(async (sql) => {
      await sql`delete from campaign_enrollments where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from campaign_prospects where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from contact_suppressions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`alter table audit_logs disable trigger user`;
      await sql`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`alter table audit_logs enable trigger user`;
      await sql`delete from campaigns where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`delete from icp_criterion where workspace_id = ${workspaceId}`;
      for (const table of ["offer_versions", "icp_versions", "messaging_strategy_versions", "ai_policy_versions", "sequence_versions"]) await sql.unsafe(`alter table ${table} disable trigger user`);
      await sql`delete from offer_versions where workspace_id = ${workspaceId}`;
      await sql`delete from icp_versions where workspace_id = ${workspaceId}`;
      await sql`delete from messaging_strategy_versions where workspace_id = ${workspaceId}`;
      await sql`delete from ai_policy_versions where workspace_id = ${workspaceId}`;
      await sql`delete from sequence_versions where workspace_id = ${workspaceId}`;
      for (const table of ["offer_versions", "icp_versions", "messaging_strategy_versions", "ai_policy_versions", "sequence_versions"]) await sql.unsafe(`alter table ${table} enable trigger user`);
      await sql`delete from contact_identities where workspace_id = ${workspaceId}`;
      await sql`delete from contact_employments where workspace_id = ${workspaceId}`;
      await sql`delete from contacts where workspace_id = ${workspaceId}`;
      await sql`delete from companies where workspace_id = ${workspaceId}`;
      await sql`delete from offers where workspace_id = ${workspaceId}`;
      await sql`delete from icps where workspace_id = ${workspaceId}`;
      await sql`delete from messaging_strategies where workspace_id = ${workspaceId}`;
      await sql`delete from ai_policies where workspace_id = ${workspaceId}`;
      await sql`delete from sequences where workspace_id = ${workspaceId}`;
      await sql`delete from auth_users where id = ${userId}`;
      await sql`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    });
    await database.close();
  });

  function send(method: string, path: string, body?: unknown) {
    return handle(new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  }

  test("scores reproducibly, explains facts/missing/exclusions and isolates workspaces", async () => {
    const first = await send("GET", `/api/v1/campaigns/${campaignId}/prospects`);
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { data: Array<{ contactId: string; score: string; status: string; explanation: { facts: unknown[]; missing: unknown[]; exclusions: unknown[] } }> };
    const normal = firstBody.data.find((row) => row.contactId === normalContactId)!;
    const excluded = firstBody.data.find((row) => row.contactId === excludedContactId)!;
    expect(normal.status).toBe("candidate");
    expect(excluded.status).toBe("excluded");
    expect(excluded.explanation.exclusions).toHaveLength(1);
    expect(firstBody.data.length).toBe(3);
    const second = await send("GET", `/api/v1/campaigns/${campaignId}/prospects`);
    const repeated = (await second.json() as { data: Array<{ contactId: string; score: string }> }).data.find((row) => row.contactId === normalContactId)!;
    expect(repeated.score).toBe(normal.score);
    context.workspaceId = otherWorkspaceId;
    expect((await send("GET", `/api/v1/campaigns/${campaignId}/prospects`)).status).toBe(404);
    context.workspaceId = workspaceId;
  });

  test("selects, rejects late suppression and enrolls idempotently", async () => {
    expect((await send("POST", `/api/v1/campaigns/${campaignId}/prospects/select`, { contactIds: [normalContactId, suppressedContactId] })).status).toBe(200);
    await database.client`insert into contact_suppressions (id, workspace_id, contact_id, channel, identity_type, normalized_value, reason, created_by) values (${crypto.randomUUID()}, ${workspaceId}, ${suppressedContactId}, 'global', 'email', 'suppressed@example.com', 'Do not contact', ${userId})`;
    const suppressed = await send("POST", `/api/v1/campaigns/${campaignId}/prospects/${suppressedContactId}/actions/enroll`);
    expect(suppressed.status).toBe(409);
    const enrolled = await send("POST", `/api/v1/campaigns/${campaignId}/prospects/${normalContactId}/actions/enroll`);
    expect(enrolled.status).toBe(201);
    const replay = await send("POST", `/api/v1/campaigns/${campaignId}/prospects/${normalContactId}/actions/enroll`);
    expect(replay.status).toBe(201);
    const counts = await database.client<{ count: number; events: number }[]>`select (select count(*)::int from campaign_enrollments where campaign_id = ${campaignId} and contact_id = ${normalContactId}) as count, (select count(*)::int from outbox_events where aggregate_id = ${campaignId} and event_type = 'CampaignProspectEnrolled' and payload->>'contactId' = ${normalContactId}) as events`;
    expect(counts[0]?.count).toBe(1);
    expect(counts[0]?.events).toBe(1);
  });

  test("rejects active sequence conflicts and reviewer enrollment", async () => {
    context.role = "reviewer";
    expect((await send("POST", `/api/v1/campaigns/${campaignId}/prospects/${normalContactId}/actions/enroll`)).status).toBe(403);
    context.role = "admin";
    expect((await send("POST", `/api/v1/campaigns/${campaignId}/prospects/select`, { contactIds: [normalContactId] })).status).toBe(409);
    expect((await send("GET", `/api/v1/campaigns/${competingCampaignId}/prospects`)).status).toBe(200);
    expect((await send("POST", `/api/v1/campaigns/${competingCampaignId}/prospects/select`, { contactIds: [normalContactId] })).status).toBe(200);
    expect((await send("POST", `/api/v1/campaigns/${competingCampaignId}/prospects/${normalContactId}/actions/enroll`)).status).toBe(409);
  });
});
