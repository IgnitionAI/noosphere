import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { encryptSecret } from "@outbound/infrastructure/security/secret-crypto";
import { PostgresOutreachScheduler } from "@outbound/infrastructure/scheduler/postgres-outreach-scheduler";
import type { UnipileClient, UnipileAccountSnapshot } from "@outbound/infrastructure/integrations/unipile-client";
import { createOutreachHttpHandler } from "@outbound/interface/http/outreach-handler";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-034 outreach scheduler", () => {
  if (!databaseUrl) return;
  process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY ?? "test-outreach-encryption-key";
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const sequenceId = crypto.randomUUID();
  const sequenceVersionId = crypto.randomUUID();
  const enrollmentId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const offerId = crypto.randomUUID();
  const offerVersionId = crypto.randomUUID();
  const icpId = crypto.randomUUID();
  const icpVersionId = crypto.randomUUID();
  const strategyId = crypto.randomUUID();
  const strategyVersionId = crypto.randomUUID();
  const policyId = crypto.randomUUID();
  const policyVersionId = crypto.randomUUID();
  let sends = 0;
  const provider: UnipileClient = {
    async connect() { return snapshot; },
    async check() { return snapshot; },
    async send() { sends += 1; await Bun.sleep(25); return { providerMessageId: `provider-${sends}` }; },
  };
  const snapshot: UnipileAccountSnapshot = { providerAccountId: `account-${accountId}`, displayName: "Sender", status: "connected", capabilities: { email: { sending: true } }, quotas: {} };
  const scheduler = new PostgresOutreachScheduler(database.db, provider);
  const context = { userId, workspaceId, role: "operator" as "operator" | "viewer" | "admin" };
  const http = createOutreachHttpHandler({ database: database.db, contextResolver: { async resolve() { return context; } } });

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.client`insert into workspaces (id, slug, name) values (${workspaceId}, ${`f034-a-${workspaceId}`}, 'F-034 A'), (${otherWorkspaceId}, ${`f034-b-${otherWorkspaceId}`}, 'F-034 B')`;
    await database.client`insert into auth_users (id, name, email) values (${userId}, 'Scheduler Tester', ${`f034-${userId}@example.com`})`;
    await database.client`insert into offers (id, workspace_id, name, category, value_proposition, target_audience) values (${offerId}, ${workspaceId}, 'Offer', 'autre', 'Value', 'Teams')`;
    await database.client`insert into offer_versions (id, workspace_id, offer_id, version, name, category, value_proposition, target_audience, published_by, published_at) values (${offerVersionId}, ${workspaceId}, ${offerId}, 1, 'Offer', 'autre', 'Value', 'Teams', ${userId}, now())`;
    await database.client`insert into icps (id, workspace_id, name, current_version) values (${icpId}, ${workspaceId}, 'ICP', 1)`;
    await database.client`insert into icp_versions (id, workspace_id, icp_id, version, name, confidence, criteria, buying_committee, problems, signals, exclusions, unknowns, unresolved_contradictions, blocked_findings, published_by, published_at) values (${icpVersionId}, ${workspaceId}, ${icpId}, 1, 'ICP', 0.9, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, ${userId}, now())`;
    await database.client`insert into messaging_strategies (id, workspace_id, name, draft_rules) values (${strategyId}, ${workspaceId}, 'Strategy', '{}'::jsonb)`;
    await database.client`insert into messaging_strategy_versions (id, workspace_id, strategy_id, version, rules, published_by, published_at) values (${strategyVersionId}, ${workspaceId}, ${strategyId}, 1, '{}'::jsonb, ${userId}, now())`;
    await database.client`insert into ai_policies (id, workspace_id, name, draft_rules) values (${policyId}, ${workspaceId}, 'Policy', '{}'::jsonb)`;
    await database.client`insert into ai_policy_versions (id, workspace_id, policy_id, version, rules, published_by, published_at) values (${policyVersionId}, ${workspaceId}, ${policyId}, 1, '{}'::jsonb, ${userId}, now())`;
    await database.client`insert into sequences (id, workspace_id, name) values (${sequenceId}, ${workspaceId}, 'Sequence')`;
    await database.client`insert into sequence_versions (id, workspace_id, sequence_id, version, steps, published_by, published_at) values (${sequenceVersionId}, ${workspaceId}, ${sequenceId}, 1, '[{"position":1,"kind":"email","delayDays":0,"subject":"Hello","body":"First"},{"position":2,"kind":"email","delayDays":1,"subject":"Follow up","body":"Second"}]'::jsonb, ${userId}, now())`;
    await database.client`insert into campaigns (id, workspace_id, name, objective, status, offer_version_id, icp_version_id, messaging_strategy_version_id, ai_policy_version_id, sequence_version_id, created_by) values (${campaignId}, ${workspaceId}, 'Campaign', '', 'active', ${offerVersionId}, ${icpVersionId}, ${strategyVersionId}, ${policyVersionId}, ${sequenceVersionId}, ${userId})`;
    await database.client`insert into contacts (id, workspace_id, first_name, last_name) values (${contactId}, ${workspaceId}, 'Ada', 'Lovelace')`;
    await database.client`insert into contact_identities (id, workspace_id, contact_id, type, value, normalized_value) values (${crypto.randomUUID()}, ${workspaceId}, ${contactId}, 'email', 'ada@example.com', 'ada@example.com')`;
    await database.client`insert into campaign_enrollments (id, workspace_id, campaign_id, contact_id, sequence_version_id, enrolled_by) values (${enrollmentId}, ${workspaceId}, ${campaignId}, ${contactId}, ${sequenceVersionId}, ${userId})`;
    await database.client`insert into connected_accounts (id, workspace_id, provider, provider_account_id, display_name, status, capabilities, quotas, encrypted_secret, created_by) values (${accountId}, ${workspaceId}, 'unipile', ${snapshot.providerAccountId}, 'Sender', 'connected', ${JSON.stringify(snapshot.capabilities)}::jsonb, '{}'::jsonb, ${encryptSecret('access-token')}, ${userId})`;
  });

  afterAll(async () => {
    await database.client.begin(async (sql) => {
      for (const table of ["offer_versions", "icp_versions", "messaging_strategy_versions", "ai_policy_versions", "sequence_versions"]) await sql.unsafe(`alter table ${table} disable trigger user`);
      await sql`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`alter table audit_logs disable trigger user`;
      await sql`delete from audit_logs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
      await sql`alter table audit_logs enable trigger user`;
      await sql`delete from jobs where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
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
      await sql`delete from connected_accounts where workspace_id = ${workspaceId}`;
      await sql`delete from contacts where workspace_id = ${workspaceId}`;
      await sql`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
      for (const table of ["offer_versions", "icp_versions", "messaging_strategy_versions", "ai_policy_versions", "sequence_versions"]) await sql.unsafe(`alter table ${table} enable trigger user`);
    });
    await database.client`delete from auth_users where id = ${userId}`;
    await database.close();
  });

  test("plans the immutable sequence snapshot and avoids duplicate actions", async () => {
    const first = await scheduler.planEnrollment({ workspaceId, enrollmentId, userId });
    const replay = await scheduler.planEnrollment({ workspaceId, enrollmentId, userId });
    expect(first).toHaveLength(2);
    expect(first[0]?.status).toBe("awaiting_approval");
    expect(first[0]?.approvalItemId).toBeString();
    expect(first[1]?.status).toBe("planned");
    expect(replay).toHaveLength(0);
  });

  test("final checks cancel suppression and suspend a degraded account", async () => {
    const actions = await scheduler.list({ workspaceId, campaignId });
    const followUp = actions.find((action) => action.stepPosition === 2)!;
    const now = new Date();
    await database.client`update outreach_actions set status = 'planned', scheduled_at = ${now} where id = ${followUp.id}`;
    const jobs: unknown[] = [];
    expect(await scheduler.markDue({ workspaceId, now, queue: { async enqueue(job) { jobs.push(job); return { inserted: true }; } } })).toBe(1);
    expect(jobs).toHaveLength(1);
    expect(await scheduler.markDue({ workspaceId, now, queue: { async enqueue(job) { jobs.push(job); return { inserted: true }; } } })).toBe(0);
    const firstAction = actions.find((action) => action.stepPosition === 1)!;
    await database.client`update outreach_actions set status = 'due', scheduled_at = ${now} where id = ${firstAction.id}`;
    await database.client`insert into approval_items (id, workspace_id, campaign_id, contact_id, enrollment_id, item_type, channel, content_original, source_updated_at, status) values (${crypto.randomUUID()}, ${workspaceId}, ${campaignId}, ${contactId}, ${enrollmentId}, 'first_contact', 'email', '{}'::jsonb, now(), 'approved')`;
    await database.client`insert into contact_suppressions (id, workspace_id, contact_id, channel, reason) values (${crypto.randomUUID()}, ${workspaceId}, ${contactId}, 'global', 'Do not contact')`;
    expect((await scheduler.execute({ workspaceId, actionId: firstAction.id, now })).status).toBe("cancelled");

    await database.client`delete from contact_suppressions where workspace_id = ${workspaceId} and contact_id = ${contactId}`;
    await database.client`update outreach_actions set status = 'due', scheduled_at = ${now} where id = ${followUp.id}`;
    await database.client`update connected_accounts set status = 'degraded' where id = ${accountId}`;
    expect((await scheduler.execute({ workspaceId, actionId: followUp.id, now })).status).toBe("suspended");
    await database.client`update connected_accounts set status = 'connected' where id = ${accountId}`;
    const resumedJobs: unknown[] = [];
    expect(await scheduler.markDue({ workspaceId, now: new Date(now.getTime() + 61_000), queue: { async enqueue(job) { resumedJobs.push(job); return { inserted: true }; } } })).toBe(1);
    expect(resumedJobs).toHaveLength(1);
  });

  test("leases and idempotency make concurrent delivery a single send", async () => {
    await database.client`update connected_accounts set status = 'connected' where id = ${accountId}`;
    const actions = await scheduler.list({ workspaceId, campaignId });
    const action = actions.find((candidate) => candidate.stepPosition === 2)!;
    await database.client`update outreach_actions set status = 'due', scheduled_at = now(), last_error_code = null where id = ${action.id}`;
    const before = sends;
    const [first, second] = await Promise.all([scheduler.execute({ workspaceId, actionId: action.id }), scheduler.execute({ workspaceId, actionId: action.id })]);
    expect(sends - before).toBe(1);
    expect(first.status).toBe("sent");
    expect(second.status).toBe("sent");
    const events = await database.client<{ count: number }[]>`select count(*)::int as count from outbox_events where workspace_id = ${workspaceId} and aggregate_id = ${action.id} and event_type = 'OutreachActionAccepted'`;
    expect(events[0]?.count).toBe(1);
  });

  test("allows reads but rejects viewer cancellation", async () => {
    context.role = "viewer";
    expect((await http(new Request(`http://localhost/api/v1/campaigns/${campaignId}/actions`))).status).toBe(200);
    const actions = await scheduler.list({ workspaceId, campaignId });
    context.role = "operator";
    expect((await http(new Request(`http://localhost/api/v1/actions/${actions[0]!.id}/actions/cancel`, { method: "POST" }))).status).toBe(200);
    context.role = "viewer";
    expect((await http(new Request(`http://localhost/api/v1/actions/${actions[0]!.id}/actions/cancel`, { method: "POST" }))).status).toBe(403);
  });
});
