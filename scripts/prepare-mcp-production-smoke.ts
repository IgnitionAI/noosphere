import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import postgres from "postgres";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIXTURE_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
const TOKEN = /^[^\s\u0000-\u001f\u007f]{8,4096}$/;
const EMPTY_REDIRECT_URIS: readonly string[] = [];
export const MCP_SMOKE_PRIVATE_ENV_DIRECTORY = "/tmp/mcp-smoke-private";

/** Reject missing, malformed, or expired publication schedules on reuse. */
export function isMcpSmokeScheduledForValid(value: unknown, now: Date): value is Date {
  if (!(value instanceof Date)) return false;
  const scheduledAt = value.getTime();
  const currentAt = now.getTime();
  return Number.isFinite(scheduledAt) && Number.isFinite(currentAt) && scheduledAt > currentAt;
}

export interface McpSmokeSeedTokens {
  readonly reviewer: string;
  readonly operator: string;
  readonly viewer: string;
  readonly revoked: string;
}

export interface McpSmokeFixtureIds {
  readonly proposal: { readonly foreign: string; readonly viewer: string };
  readonly aggregate: { readonly foreign: string; readonly viewer: string };
  readonly content: { readonly foreign: McpSmokeSourceFixtureIds; readonly viewer: McpSmokeSourceFixtureIds };
  readonly revoked: { readonly accessTokenId: string; readonly familyId: string };
}

/**
 * Deterministic IDs for the conversation source used by the governed-effect
 * proposal fixtures. The aggregate IDs intentionally remain the conversation
 * IDs because that is the authoritative key consumed by FactsReader.
 */
export interface McpSmokeConversationFixtureIds {
  readonly conversationId: string;
  readonly contactId: string;
  readonly identityId: string;
  readonly accountId: string;
  readonly messageId: string;
  readonly providerAccountId: string;
}

export interface McpSmokeSourceFixtureIds {
  readonly assetId: string;
  readonly publicationId: string;
  readonly campaignId: string;
  readonly accountId: string;
  readonly providerAccountId: string;
}

/** Resolve every fixture identifier without touching the database. */
export function resolveMcpSmokeFixtureIds(fixtureKey: string): McpSmokeFixtureIds {
  if (!FIXTURE_KEY.test(fixtureKey)) throw new Error("MCP smoke fixture key is invalid");
  const aggregate = {
    foreign: stableUuid(`${fixtureKey}:aggregate:foreign`),
    viewer: stableUuid(`${fixtureKey}:aggregate:viewer`),
  } as const;
  const source = (index: number): McpSmokeSourceFixtureIds => ({
    assetId: stableUuid(`${fixtureKey}:content:${index}:asset`),
    publicationId: stableUuid(`${fixtureKey}:content:${index}:publication`),
    campaignId: stableUuid(`${fixtureKey}:content:${index}:campaign`),
    accountId: stableUuid(`${fixtureKey}:content:${index}:account`),
    providerAccountId: `local-fake-account-${fixtureKey}-${index}`,
  });
  return {
    proposal: {
      foreign: stableUuid(`${fixtureKey}:proposal:foreign`),
      viewer: stableUuid(`${fixtureKey}:proposal:viewer`),
    },
    aggregate,
    content: { foreign: source(0), viewer: source(1) },
    revoked: {
      accessTokenId: stableUuid(`${fixtureKey}:access:revoked`),
      familyId: stableUuid(`${fixtureKey}:family:revoked`),
    },
  };
}

/** Resolve the complete, workspace-local conversation source chain IDs. */
export function resolveMcpSmokeConversationFixtureIds(fixtureKey: string, index: 0 | 1): McpSmokeConversationFixtureIds {
  if (!FIXTURE_KEY.test(fixtureKey) || (index !== 0 && index !== 1)) throw new Error("MCP smoke conversation fixture index is invalid");
  const aggregateId = resolveMcpSmokeFixtureIds(fixtureKey).aggregate[index === 0 ? "foreign" : "viewer"];
  return {
    conversationId: aggregateId,
    contactId: stableUuid(`${fixtureKey}:conversation:${index}:contact`),
    identityId: stableUuid(`${fixtureKey}:conversation:${index}:identity`),
    accountId: stableUuid(`${fixtureKey}:conversation:${index}:account`),
    messageId: stableUuid(`${fixtureKey}:conversation:${index}:message`),
    providerAccountId: `local-fake-messaging-${fixtureKey}-${index}`,
  };
}

export interface McpSmokeSeedPlan {
  readonly fixtureKey: string;
  readonly workspaceIds: readonly [string, string];
  readonly workspaceSlugs: readonly [string, string];
  readonly identities: readonly [
    { readonly name: "reviewer"; readonly token: string; readonly workspaceId: string; readonly role: "reviewer"; readonly scopes: readonly ["mcp:read", "mcp:write", "mcp:approve"]; readonly clientId: string },
    { readonly name: "operator"; readonly token: string; readonly workspaceId: string; readonly role: "operator"; readonly scopes: readonly ["mcp:read", "mcp:write"]; readonly clientId: string },
    { readonly name: "viewer"; readonly token: string; readonly workspaceId: string; readonly role: "viewer"; readonly scopes: readonly ["mcp:read"]; readonly clientId: string },
  ];
  readonly foreignProposalId: string;
  readonly viewerProposalId: string;
  readonly revokedToken: string;
}

export interface McpSmokeSeedPlanInput {
  readonly fixtureKey: string;
  readonly host: string;
  readonly httpsPort: number;
  readonly tokens?: McpSmokeSeedTokens;
}

export interface McpSmokePrepareOptions {
  readonly mode: "create" | "reuse";
}

export class McpSmokeFixtureError extends Error {
  readonly code: "MCP_SMOKE_FIXTURE_EXISTS" | "MCP_SMOKE_FIXTURE_PARTIAL" | "MCP_SMOKE_FIXTURE_MISMATCH" | "MCP_SMOKE_FIXTURE_IMMUTABLE_RETAINED";

  constructor(code: McpSmokeFixtureError["code"]) {
    super(code);
    this.name = "McpSmokeFixtureError";
    this.code = code;
  }
}

/** Build deterministic IDs so rerunning prepare with one fixture key is safe. */
export function createMcpSmokeSeedPlan(input: McpSmokeSeedPlanInput): McpSmokeSeedPlan {
  if (!FIXTURE_KEY.test(input.fixtureKey)) throw new Error("MCP smoke fixture key is invalid");
  if (!/^[A-Za-z0-9.-]{1,63}$/.test(input.host)) throw new Error("MCP smoke host is invalid");
  if (!Number.isSafeInteger(input.httpsPort) || input.httpsPort < 1 || input.httpsPort > 65535) throw new Error("MCP smoke HTTPS port is invalid");
  const tokens = input.tokens ?? {
    reviewer: randomToken(),
    operator: randomToken(),
    viewer: randomToken(),
    revoked: randomToken(),
  };
  for (const token of Object.values(tokens)) if (!TOKEN.test(token)) throw new Error("MCP smoke token is invalid");
  const workspaceIds = [stableUuid(`${input.fixtureKey}:workspace:a`), stableUuid(`${input.fixtureKey}:workspace:b`)] as const;
  const workspaceSlugs = [`mcp-smoke-${input.fixtureKey}-a`, `mcp-smoke-${input.fixtureKey}-b`] as const;
  const identities = [
    { name: "reviewer" as const, token: tokens.reviewer, workspaceId: workspaceIds[0], role: "reviewer" as const, scopes: ["mcp:read", "mcp:write", "mcp:approve"] as const, clientId: `mcp-smoke-${input.fixtureKey}-reviewer` },
    { name: "operator" as const, token: tokens.operator, workspaceId: workspaceIds[0], role: "operator" as const, scopes: ["mcp:read", "mcp:write"] as const, clientId: `mcp-smoke-${input.fixtureKey}-operator` },
    { name: "viewer" as const, token: tokens.viewer, workspaceId: workspaceIds[1], role: "viewer" as const, scopes: ["mcp:read"] as const, clientId: `mcp-smoke-${input.fixtureKey}-viewer` },
  ] as const;
  return {
    fixtureKey: input.fixtureKey,
    workspaceIds,
    workspaceSlugs,
    identities,
    foreignProposalId: resolveMcpSmokeFixtureIds(input.fixtureKey).proposal.foreign,
    viewerProposalId: resolveMcpSmokeFixtureIds(input.fixtureKey).proposal.viewer,
    revokedToken: tokens.revoked,
  };
}

/** Serialize only smoke inputs. Database credentials are deliberately absent. */
export function formatMcpSmokeEnvironmentFile(plan: McpSmokeSeedPlan, host = "mcp-smoke.localhost", httpsPort = 18443): string {
  const endpoint = `https://${host}:${httpsPort}/mcp`;
  const identities = plan.identities.map(({ clientId: _clientId, ...identity }) => identity);
  const fixtureIds = resolveMcpSmokeFixtureIds(plan.fixtureKey);
  return [
    `MCP_SMOKE_URL=${shellQuote(endpoint)}`,
    `MCP_SMOKE_RESOURCE=${shellQuote(endpoint)}`,
    `MCP_SMOKE_IDENTITIES_JSON=${shellQuote(JSON.stringify(identities))}`,
    `MCP_SMOKE_FOREIGN_PROPOSAL_ID=${shellQuote(plan.foreignProposalId)}`,
    `MCP_SMOKE_VIEWER_PROPOSAL_ID=${shellQuote(plan.viewerProposalId)}`,
    `MCP_SMOKE_FOREIGN_CONTENT_ASSET_ID=${shellQuote(fixtureIds.content.foreign.assetId)}`,
    `MCP_SMOKE_FOREIGN_CONTENT_PUBLICATION_ID=${shellQuote(fixtureIds.content.foreign.publicationId)}`,
    `MCP_SMOKE_FOREIGN_CAMPAIGN_ID=${shellQuote(fixtureIds.content.foreign.campaignId)}`,
    `MCP_SMOKE_VIEWER_CONTENT_ASSET_ID=${shellQuote(fixtureIds.content.viewer.assetId)}`,
    `MCP_SMOKE_VIEWER_CONTENT_PUBLICATION_ID=${shellQuote(fixtureIds.content.viewer.publicationId)}`,
    `MCP_SMOKE_VIEWER_CAMPAIGN_ID=${shellQuote(fixtureIds.content.viewer.campaignId)}`,
    `MCP_SMOKE_REVOKED_TOKEN=${shellQuote(plan.revokedToken)}`,
    `MCP_SMOKE_FIXTURE_KEY=${shellQuote(plan.fixtureKey)}`,
    "MCP_SMOKE_INSPECTOR=false",
    "",
  ].join("\n");
}

/** Keep generated OAuth material in a private container-local directory. */
export async function prepareMcpSmokeEnvironmentDirectory(outputPath: string): Promise<void> {
  const outputDirectory = dirname(outputPath);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  if (outputDirectory === MCP_SMOKE_PRIVATE_ENV_DIRECTORY || outputDirectory.startsWith(`${MCP_SMOKE_PRIVATE_ENV_DIRECTORY}/`)) {
    await chmod(outputDirectory, 0o700);
  }
}

/** Seed only workspace/auth/proposal rows after migrations have completed. */
export async function prepareMcpProductionSmoke(
  databaseUrl: string,
  outputPath: string,
  input: McpSmokeSeedPlanInput,
  options: McpSmokePrepareOptions = { mode: "create" },
): Promise<McpSmokeSeedPlan> {
  const plan = createMcpSmokeSeedPlan(input);
  const mode = options.mode;
  if (mode !== "create" && mode !== "reuse") throw new Error("MCP smoke fixture mode is invalid");
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 20 });
  const now = new Date();
  try {
    await prepareMcpSmokeEnvironmentDirectory(outputPath);
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${plan.fixtureKey}))`;
      const fixtureState = await readFixtureState(tx, plan, input);
      if (mode === "create" && fixtureState !== "absent") {
        throw new McpSmokeFixtureError(fixtureState === "mismatch"
          ? "MCP_SMOKE_FIXTURE_MISMATCH"
          : fixtureState === "retained"
            ? "MCP_SMOKE_FIXTURE_IMMUTABLE_RETAINED"
            : "MCP_SMOKE_FIXTURE_EXISTS");
      }
      if (mode === "reuse" && fixtureState === "complete") return;
      if (mode === "reuse" && fixtureState !== "absent") {
        throw new McpSmokeFixtureError(fixtureState === "mismatch"
          ? "MCP_SMOKE_FIXTURE_MISMATCH"
          : fixtureState === "retained"
            ? "MCP_SMOKE_FIXTURE_IMMUTABLE_RETAINED"
            : "MCP_SMOKE_FIXTURE_PARTIAL");
      }
      await insertFixtureRows(tx, plan, input, now);
    });
    if (!(await fileExists(outputPath))) {
      await writeFile(outputPath, formatMcpSmokeEnvironmentFile(plan, input.host, input.httpsPort), { encoding: "utf8", mode: 0o600 });
      await chmod(outputPath, 0o600);
    }
    const outputMode = (await stat(outputPath)).mode & 0o777;
    if (outputMode !== 0o600) throw new Error("MCP smoke environment file must be mode 0600");
    return plan;
  } catch (error) {
    if (error instanceof McpSmokeFixtureError) throw error;
    throw new Error("MCP smoke fixture preparation failed");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Remove only rows identified by the exact generated workspace slugs. */
export async function cleanupMcpProductionSmoke(databaseUrl: string, fixtureKey: string, outputPath?: string): Promise<void> {
  if (!FIXTURE_KEY.test(fixtureKey)) throw new Error("MCP smoke fixture key is invalid");
  assertDisposableLocalDatabase(databaseUrl);
  const slugs = [`mcp-smoke-${fixtureKey}-a`, `mcp-smoke-${fixtureKey}-b`] as const;
  const expectedWorkspaceIds = [
    stableUuid(`${fixtureKey}:workspace:a`),
    stableUuid(`${fixtureKey}:workspace:b`),
  ] as const;
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 20 });
  try {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${fixtureKey}))`;
      // 0070 source snapshots are immutable in normal product operation. Keep
      // that chain intact and remove only mutable fixture artifacts; this
      // leaves a deterministic, scoped source record without changing trigger
      // state or weakening a production guard.
      await removeFixtureRows(tx, slugs, expectedWorkspaceIds);
    });
    if (outputPath) await unlink(outputPath).catch(() => undefined);
  } catch {
    throw new Error("MCP smoke fixture cleanup failed");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function assertDisposableLocalDatabase(databaseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("MCP smoke cleanup requires a disposable local database");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!(["127.0.0.1", "localhost", "::1"].includes(hostname))) {
    throw new Error("MCP smoke cleanup requires a disposable local database");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/^[A-Za-z0-9_.-]+(?:[-_](?:local|test|e2e))(?:[-_.A-Za-z0-9]*)?$/i.test(databaseName)) {
    throw new Error("MCP smoke cleanup requires a disposable local database");
  }
}

/** Revoke only this fixture's memberships, clients, and access tokens. */
export async function revokeMcpProductionSmoke(databaseUrl: string, fixtureKey: string): Promise<void> {
  if (!FIXTURE_KEY.test(fixtureKey)) throw new Error("MCP smoke fixture key is invalid");
  const slugs = [`mcp-smoke-${fixtureKey}-a`, `mcp-smoke-${fixtureKey}-b`] as const;
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 20 });
  try {
    await sql.begin(async (tx) => {
      for (const slug of slugs) {
        const rows = await tx`select id from workspaces where slug = ${slug}` as Array<{ readonly id: string }>;
        for (const row of rows) {
          await tx`update workspace_members set status = 'inactive' where workspace_id = ${row.id}`;
          await tx`update mcp_oauth_clients set revoked_at = coalesce(revoked_at, now()) where workspace_id = ${row.id}`;
          await tx`update mcp_oauth_access_tokens set revoked_at = coalesce(revoked_at, now()) where workspace_id = ${row.id}`;
        }
      }
    });
  } catch {
    throw new Error("MCP smoke fixture revocation failed");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

type FixtureState = "absent" | "complete" | "partial" | "mismatch" | "retained";

async function readFixtureState(tx: any, plan: McpSmokeSeedPlan, input: McpSmokeSeedPlanInput): Promise<FixtureState> {
  const workspaces = await tx`select id, slug from workspaces where slug in (${plan.workspaceSlugs[0]}, ${plan.workspaceSlugs[1]}) order by slug` as Array<{ readonly id: string; readonly slug: string }>;
  if (workspaces.length === 0) return "absent";
  if (workspaces.length !== 2) return "partial";
  for (const [index, workspace] of workspaces.entries()) {
    if (workspace.id !== plan.workspaceIds[index] || workspace.slug !== plan.workspaceSlugs[index]) return "mismatch";
  }

  // A previous cleanup intentionally retains migration-0070 immutable source
  // rows. Reusing that key would either collide with immutable IDs or require
  // weakening a production trigger, so force a new fixture key instead.
  const retainedSourceRows = await tx`
    select id from content_asset_versions
    where workspace_id in (${plan.workspaceIds[0]}, ${plan.workspaceIds[1]})
    union all
    select id from content_briefs
    where workspace_id in (${plan.workspaceIds[0]}, ${plan.workspaceIds[1]})
    limit 1
  ` as Array<{ readonly id: string }>;
  const retainedProposals = await tx`
    select id from mcp_effect_proposals
    where workspace_id in (${plan.workspaceIds[0]}, ${plan.workspaceIds[1]})
    limit 1
  ` as Array<{ readonly id: string }>;
  if (retainedSourceRows.length > 0 && retainedProposals.length === 0) return "retained";

  for (const identity of plan.identities) {
    const userId = stableUuid(`${plan.fixtureKey}:user:${identity.name}`);
    const clientId = stableUuid(`${plan.fixtureKey}:client:${identity.name}`);
    const accessId = stableUuid(`${plan.fixtureKey}:access:${identity.name}`);
    const users = await tx`select id from auth_users where id = ${userId}` as Array<{ readonly id: string }>;
    const members = await tx`select user_id from workspace_members where workspace_id = ${identity.workspaceId} and user_id = ${userId} and role = ${identity.role} and status = 'active'` as Array<{ readonly user_id: string }>;
    const clients = await tx`select id, allowed_scopes from mcp_oauth_clients where id = ${clientId} and client_id = ${identity.clientId} and workspace_id = ${identity.workspaceId}` as Array<{ readonly id: string; readonly allowed_scopes: unknown }>;
    const access = await tx`select token_hash, scopes, audience from mcp_oauth_access_tokens where id = ${accessId} and client_id = ${identity.clientId} and user_id = ${userId} and workspace_id = ${identity.workspaceId} and revoked_at is null` as Array<{ readonly token_hash: string; readonly scopes: unknown; readonly audience: string }>;
    if (users.length !== 1 || members.length !== 1 || clients.length !== 1 || access.length !== 1) return "partial";
    if (!sameScopes(clients[0]!.allowed_scopes, identity.scopes) || !sameScopes(access[0]!.scopes, identity.scopes) || access[0]!.audience !== `https://${input.host}:${input.httpsPort}/mcp`) return "mismatch";
    if (input.tokens && access[0]!.token_hash !== hashToken(input.tokens[identity.name])) return "mismatch";
  }

  const revoked = plan.identities[2]!;
  const revokedRows = await tx`select token_hash, family_id, revoked_at, scopes, audience from mcp_oauth_access_tokens where id = ${resolveMcpSmokeFixtureIds(plan.fixtureKey).revoked.accessTokenId} and client_id = ${revoked.clientId} and workspace_id = ${revoked.workspaceId}` as Array<{ readonly token_hash: string; readonly family_id: string; readonly revoked_at: Date | null; readonly scopes: unknown; readonly audience: string }>;
  if (revokedRows.length !== 1 || revokedRows[0]!.family_id !== resolveMcpSmokeFixtureIds(plan.fixtureKey).revoked.familyId || revokedRows[0]!.revoked_at === null) return "partial";
  if (!sameScopes(revokedRows[0]!.scopes, revoked.scopes) || revokedRows[0]!.audience !== `https://${input.host}:${input.httpsPort}/mcp`) return "mismatch";
  if (input.tokens && revokedRows[0]!.token_hash !== hashToken(input.tokens.revoked)) return "mismatch";

  const foreignProposal = await tx`select id, approval_item_id from mcp_effect_proposals where id = ${plan.foreignProposalId} and workspace_id = ${plan.workspaceIds[0]}` as Array<{ readonly id: string; readonly approval_item_id: string | null }>;
  const viewerProposal = await tx`select id, approval_item_id from mcp_effect_proposals where id = ${plan.viewerProposalId} and workspace_id = ${plan.workspaceIds[1]}` as Array<{ readonly id: string; readonly approval_item_id: string | null }>;
  if (foreignProposal.length !== 1 || viewerProposal.length !== 1 || !foreignProposal[0]!.approval_item_id || !viewerProposal[0]!.approval_item_id) return "partial";
  const approvalRows = await tx`select id from approval_items where id in (${foreignProposal[0]!.approval_item_id}, ${viewerProposal[0]!.approval_item_id}) and proposal_id in (${plan.foreignProposalId}, ${plan.viewerProposalId})` as Array<{ readonly id: string }>;
  if (approvalRows.length !== 2) return "partial";
  const fixtureIds = resolveMcpSmokeFixtureIds(plan.fixtureKey);
  for (const [index, aggregateId] of [fixtureIds.aggregate.foreign, fixtureIds.aggregate.viewer].entries()) {
    const sourceState = await readConversationSourceState(tx, plan, plan.workspaceIds[index]!, aggregateId, index as 0 | 1);
    if (sourceState !== "complete") return sourceState;
  }
  for (const [index, source] of [fixtureIds.content.foreign, fixtureIds.content.viewer].entries()) {
    const sourceState = await readContentSourceState(tx, plan, plan.workspaceIds[index]!, source, index);
    if (sourceState !== "complete") return sourceState;
  }
  return "complete";
}

async function readConversationSourceState(
  tx: any,
  plan: McpSmokeSeedPlan,
  workspaceId: string,
  aggregateId: string,
  index: 0 | 1,
): Promise<Exclude<FixtureState, "absent">> {
  const ids = resolveMcpSmokeConversationFixtureIds(plan.fixtureKey, index);
  const conversation = await tx`select id, workspace_id, contact_id, connected_account_id, provider, provider_account_id, provider_thread_id, channel, automation_mode, status from conversations where workspace_id = ${workspaceId} and id = ${aggregateId}` as Array<{ id: string; workspace_id: string; contact_id: string; connected_account_id: string | null; provider: string; provider_account_id: string; provider_thread_id: string; channel: string; automation_mode: string; status: string }>;
  const contact = await tx`select id, workspace_id, preferred_channel, status, anonymized_at from contacts where workspace_id = ${workspaceId} and id = ${ids.contactId}` as Array<{ id: string; workspace_id: string; preferred_channel: string | null; status: string; anonymized_at: Date | null }>;
  const identity = await tx`select id, workspace_id, contact_id, type, value, normalized_value from contact_identities where workspace_id = ${workspaceId} and id = ${ids.identityId}` as Array<{ id: string; workspace_id: string; contact_id: string; type: string; value: string; normalized_value: string }>;
  const message = await tx`select id, workspace_id, conversation_id, provider_message_id, direction, sender_type, body from messages where workspace_id = ${workspaceId} and id = ${ids.messageId}` as Array<{ id: string; workspace_id: string; conversation_id: string; provider_message_id: string; direction: string; sender_type: string; body: string }>;
  const account = await tx`select id, workspace_id, provider, provider_account_id, status, capabilities -> 'linkedin' ->> 'messaging' as messaging, quotas -> 'linkedin' ->> 'remaining' as remaining from connected_accounts where workspace_id = ${workspaceId} and id = ${ids.accountId}` as Array<{ id: string; workspace_id: string; provider: string; provider_account_id: string; status: string; messaging: string | null; remaining: string | null }>;
  if ([conversation, contact, identity, message, account].some((rows) => rows.length !== 1)) return "partial";
  const conversationRow = conversation[0]!;
  const contactRow = contact[0]!;
  const identityRow = identity[0]!;
  const messageRow = message[0]!;
  const accountRow = account[0]!;
  const complete = conversationRow.id === aggregateId
    && conversationRow.workspace_id === workspaceId
    && conversationRow.contact_id === ids.contactId
    && conversationRow.connected_account_id === ids.accountId
    && conversationRow.provider === "unipile"
    && conversationRow.provider_account_id === ids.providerAccountId
    && conversationRow.provider_thread_id === `local-fake-thread-${plan.fixtureKey}-${index}`
    && conversationRow.channel === "linkedin"
    && conversationRow.automation_mode === "setter"
    && conversationRow.status === "open"
    && contactRow.workspace_id === workspaceId
    && contactRow.preferred_channel === "linkedin"
    && contactRow.status === "active"
    && contactRow.anonymized_at === null
    && identityRow.workspace_id === workspaceId
    && identityRow.contact_id === ids.contactId
    && identityRow.type === "linkedin"
    && identityRow.value === `local-fake-profile-${plan.fixtureKey}-${index}`
    && identityRow.normalized_value === identityRow.value
    && messageRow.workspace_id === workspaceId
    && messageRow.conversation_id === aggregateId
    && messageRow.provider_message_id === `local-fake-message-${plan.fixtureKey}-${index}`
    && messageRow.direction === "outbound"
    && messageRow.sender_type === "system"
    && messageRow.body === "Local smoke conversation seed"
    && accountRow.workspace_id === workspaceId
    && accountRow.provider === "unipile"
    && accountRow.provider_account_id === ids.providerAccountId
    && accountRow.status === "connected"
    && accountRow.messaging === "true"
    && accountRow.remaining === "4";
  return complete ? "complete" : "mismatch";
}

async function readContentSourceState(
  tx: any,
  plan: McpSmokeSeedPlan,
  workspaceId: string,
  source: McpSmokeSourceFixtureIds,
  index: number,
): Promise<Exclude<FixtureState, "absent">> {
  const ids = {
    offer: stableUuid(`${plan.fixtureKey}:content:${index}:offer`),
    offerVersion: stableUuid(`${plan.fixtureKey}:content:${index}:offer-version`),
    icp: stableUuid(`${plan.fixtureKey}:content:${index}:icp`),
    icpVersion: stableUuid(`${plan.fixtureKey}:content:${index}:icp-version`),
    strategy: stableUuid(`${plan.fixtureKey}:content:${index}:strategy`),
    strategyVersion: stableUuid(`${plan.fixtureKey}:content:${index}:strategy-version`),
    idea: stableUuid(`${plan.fixtureKey}:content:${index}:idea`),
    generationRun: stableUuid(`${plan.fixtureKey}:content:${index}:generation-run`),
    brief: stableUuid(`${plan.fixtureKey}:content:${index}:brief`),
    assetVersion: stableUuid(`${plan.fixtureKey}:content:${index}:asset-version`),
    sequence: stableUuid(`${plan.fixtureKey}:content:${index}:sequence`),
  } as const;
  const asset = await tx`select id, idea_id, type, status, latest_version, revision from content_assets where workspace_id = ${workspaceId} and id = ${source.assetId}` as Array<{ id: string; idea_id: string; type: string; status: string; latest_version: number; revision: number }>;
  const assetVersion = await tx`select id, asset_id, brief_id, generation_run_id, version, body, ready, jsonb_typeof(draft) as draft_type, jsonb_typeof(audit) as audit_type, jsonb_typeof(critique) as critique_type, jsonb_typeof(readiness) as readiness_type from content_asset_versions where workspace_id = ${workspaceId} and id = ${ids.assetVersion}` as Array<{ id: string; asset_id: string; brief_id: string; generation_run_id: string; version: number; body: string; ready: boolean; draft_type: string; audit_type: string; critique_type: string; readiness_type: string }>;
  const brief = await tx`select id, run_id, idea_id, strategy_version_id, jsonb_typeof(snapshot) as snapshot_type, jsonb_typeof(evidence_snapshot) as evidence_type from content_briefs where workspace_id = ${workspaceId} and id = ${ids.brief}` as Array<{ id: string; run_id: string; idea_id: string; strategy_version_id: string; snapshot_type: string; evidence_type: string }>;
  const run = await tx`select id, idea_id, asset_id, strategy_version_id, status, stage from content_generation_runs where workspace_id = ${workspaceId} and id = ${ids.generationRun}` as Array<{ id: string; idea_id: string; asset_id: string; strategy_version_id: string; status: string; stage: string }>;
  const idea = await tx`select id, strategy_version_id, status, fingerprint from content_ideas where workspace_id = ${workspaceId} and id = ${ids.idea}` as Array<{ id: string; strategy_version_id: string; status: string; fingerprint: string }>;
  const strategyVersion = await tx`select id, strategy_id, offer_version_id, icp_version_id, version, jsonb_typeof(snapshot) as snapshot_type from editorial_strategy_versions where workspace_id = ${workspaceId} and id = ${ids.strategyVersion}` as Array<{ id: string; strategy_id: string; offer_version_id: string; icp_version_id: string; version: number; snapshot_type: string }>;
  const strategy = await tx`select id, offer_id, offer_version_id, icp_id, icp_version_id, status, current_version from editorial_strategies where workspace_id = ${workspaceId} and id = ${ids.strategy}` as Array<{ id: string; offer_id: string; offer_version_id: string; icp_id: string; icp_version_id: string; status: string; current_version: number }>;
  const offerVersion = await tx`select id, offer_id, version from offer_versions where workspace_id = ${workspaceId} and id = ${ids.offerVersion}` as Array<{ id: string; offer_id: string; version: number }>;
  const offer = await tx`select id, status, current_version from offers where workspace_id = ${workspaceId} and id = ${ids.offer}` as Array<{ id: string; status: string; current_version: number }>;
  const icpVersion = await tx`select id, icp_id, version from icp_versions where workspace_id = ${workspaceId} and id = ${ids.icpVersion}` as Array<{ id: string; icp_id: string; version: number }>;
  const icp = await tx`select id, current_version from icps where workspace_id = ${workspaceId} and id = ${ids.icp}` as Array<{ id: string; current_version: number }>;
  const account = await tx`select id, provider, provider_account_id, status, capabilities -> 'linkedin' ->> 'publishing' as publishing, quotas -> 'linkedin' ->> 'remaining' as remaining from connected_accounts where workspace_id = ${workspaceId} and id = ${source.accountId}` as Array<{ id: string; provider: string; provider_account_id: string; status: string; publishing: string | null; remaining: string | null }>;
  const channelAccount = await tx`select provider, provider_account_id from workspace_channel_accounts where workspace_id = ${workspaceId} and channel = 'linkedin'` as Array<{ provider: string; provider_account_id: string }>;
  const publication = await tx`select id, asset_id, asset_version_id, network, provider, status, request_key, scheduled_for, jsonb_typeof(content_snapshot) as content_type, content_snapshot ->> 'body' as content_body, jsonb_typeof(policy_snapshot) as policy_type, policy_snapshot ->> 'policyVersion' as policy_version, account_snapshot ->> 'providerAccountId' as account_id from content_publications where workspace_id = ${workspaceId} and id = ${source.publicationId}` as Array<{ id: string; asset_id: string; asset_version_id: string; network: string; provider: string; status: string; request_key: string; scheduled_for: Date; content_type: string; content_body: string | null; policy_type: string; policy_version: string | null; account_id: string | null }>;
  const campaign = await tx`select id, status, icp_version_id, sequence_id, channel, automation_stage, jsonb_typeof(autopilot_policy) as policy_type, autopilot_policy -> 'scheduleWindow' ->> 'start' as schedule_start, autopilot_policy -> 'scheduleWindow' ->> 'end' as schedule_end, autopilot_policy -> 'scheduleWindow' ->> 'timeZone' as time_zone from campaigns where workspace_id = ${workspaceId} and id = ${source.campaignId}` as Array<{ id: string; status: string; icp_version_id: string; sequence_id: string; channel: string; automation_stage: string; policy_type: string; schedule_start: string | null; schedule_end: string | null; time_zone: string | null }>;
  if ([asset, assetVersion, brief, run, idea, strategyVersion, strategy, offerVersion, offer, icpVersion, icp, account, channelAccount, publication, campaign].some((rows) => rows.length !== 1)) return "partial";
  const assetRow = asset[0]!;
  const versionRow = assetVersion[0]!;
  const briefRow = brief[0]!;
  const runRow = run[0]!;
  const ideaRow = idea[0]!;
  const strategyVersionRow = strategyVersion[0]!;
  const strategyRow = strategy[0]!;
  const offerVersionRow = offerVersion[0]!;
  const offerRow = offer[0]!;
  const icpVersionRow = icpVersion[0]!;
  const icpRow = icp[0]!;
  const accountRow = account[0]!;
  const channelAccountRow = channelAccount[0]!;
  const publicationRow = publication[0]!;
  const campaignRow = campaign[0]!;
  const scheduledForMs = isMcpSmokeScheduledForValid(publicationRow.scheduled_for, new Date())
    ? publicationRow.scheduled_for.getTime()
    : Number.NaN;
  const complete = assetRow.id === source.assetId && assetRow.idea_id === ids.idea && assetRow.type === "linkedin_text" && assetRow.status === "ready" && assetRow.latest_version === 1 && assetRow.revision === 1
    && versionRow.id === ids.assetVersion && versionRow.asset_id === source.assetId && versionRow.brief_id === ids.brief && versionRow.generation_run_id === ids.generationRun && versionRow.version === 1 && versionRow.body === "Local fixture body" && versionRow.ready === true && [versionRow.draft_type, versionRow.audit_type, versionRow.critique_type, versionRow.readiness_type].every((type) => type === "object")
    && briefRow.run_id === ids.generationRun && briefRow.idea_id === ids.idea && briefRow.strategy_version_id === ids.strategyVersion && briefRow.snapshot_type === "object" && briefRow.evidence_type === "object"
    && runRow.idea_id === ids.idea && runRow.asset_id === source.assetId && runRow.strategy_version_id === ids.strategyVersion && runRow.status === "ready" && runRow.stage === "completed"
    && ideaRow.strategy_version_id === ids.strategyVersion && ideaRow.status === "discovered" && ideaRow.fingerprint === mcpSmokeProposalInputHash(`${plan.fixtureKey}:content:${index}:idea`)
    && strategyVersionRow.strategy_id === ids.strategy && strategyVersionRow.offer_version_id === ids.offerVersion && strategyVersionRow.icp_version_id === ids.icpVersion && strategyVersionRow.version === 1 && strategyVersionRow.snapshot_type === "object"
    && strategyRow.offer_id === ids.offer && strategyRow.offer_version_id === ids.offerVersion && strategyRow.icp_id === ids.icp && strategyRow.icp_version_id === ids.icpVersion && strategyRow.status === "active" && strategyRow.current_version === 1
    && offerVersionRow.offer_id === ids.offer && offerVersionRow.version === 1 && offerRow.status === "draft" && offerRow.current_version === 1
    && icpVersionRow.icp_id === ids.icp && icpVersionRow.version === 1 && icpRow.current_version === 1
    && accountRow.provider === "unipile" && accountRow.provider_account_id === source.providerAccountId && accountRow.status === "connected" && accountRow.publishing === "true" && accountRow.remaining === "4"
    && channelAccountRow.provider === "unipile" && channelAccountRow.provider_account_id === source.providerAccountId
    && publicationRow.asset_id === source.assetId && publicationRow.asset_version_id === ids.assetVersion && publicationRow.network === "linkedin" && publicationRow.provider === "unipile" && publicationRow.status === "scheduled" && publicationRow.request_key === `mcp-smoke-${plan.fixtureKey}-content-${index}` && Number.isFinite(scheduledForMs) && scheduledForMs > Date.now() && publicationRow.content_type === "object" && publicationRow.content_body === "Local fixture body" && publicationRow.policy_type === "object" && publicationRow.policy_version === "local-fixture-v1" && publicationRow.account_id === source.providerAccountId
    && campaignRow.status === "active" && campaignRow.icp_version_id === ids.icpVersion && campaignRow.sequence_id === ids.sequence && campaignRow.channel === "linkedin" && campaignRow.automation_stage === "active" && campaignRow.policy_type === "object" && campaignRow.schedule_start === "09:00" && campaignRow.schedule_end === "17:00" && campaignRow.time_zone === "UTC";
  return complete ? "complete" : "mismatch";
}

async function insertFixtureRows(tx: any, plan: McpSmokeSeedPlan, input: McpSmokeSeedPlanInput, now: Date): Promise<void> {
  for (const [index, workspaceId] of plan.workspaceIds.entries()) {
    await tx`insert into workspaces (id, slug, name, status) values (${workspaceId}, ${plan.workspaceSlugs[index]!}, ${`MCP smoke ${input.fixtureKey} ${index === 0 ? "A" : "B"}`}, 'active')`;
  }
  for (const identity of plan.identities) {
    const email = `${identity.name}-${plan.fixtureKey}@mcp-smoke.invalid`;
    const allowedScopes = identity.scopes;
    const accessAudience = `https://${input.host}:${input.httpsPort}/mcp`;
    await tx`insert into auth_users (id, name, email, email_verified) values (${stableUuid(`${plan.fixtureKey}:user:${identity.name}`)}, ${`MCP smoke ${identity.name}`}, ${email}, true)`;
    await tx`insert into workspace_members (workspace_id, user_id, role, status) values (${identity.workspaceId}, ${stableUuid(`${plan.fixtureKey}:user:${identity.name}`)}, ${identity.role}, 'active')`;
    await tx`insert into mcp_oauth_clients (id, client_id, client_name, redirect_uris, user_id, workspace_id, workspace_slug, allowed_scopes) values (${stableUuid(`${plan.fixtureKey}:client:${identity.name}`)}, ${identity.clientId}, ${`MCP smoke ${identity.name}`}, ${tx.json(EMPTY_REDIRECT_URIS as never)}, ${stableUuid(`${plan.fixtureKey}:user:${identity.name}`)}, ${identity.workspaceId}, ${plan.workspaceSlugs[identity.workspaceId === plan.workspaceIds[0] ? 0 : 1]}, ${tx.json(allowedScopes as never)})`;
    await tx`insert into mcp_oauth_access_tokens (id, token_hash, family_id, client_id, user_id, workspace_id, scopes, audience, expires_at, revoked_at) values (${stableUuid(`${plan.fixtureKey}:access:${identity.name}`)}, ${hashToken(identity.token)}, ${stableUuid(`${plan.fixtureKey}:family:${identity.name}`)}, ${identity.clientId}, ${stableUuid(`${plan.fixtureKey}:user:${identity.name}`)}, ${identity.workspaceId}, ${tx.json(allowedScopes as never)}, ${accessAudience}, ${new Date(now.getTime() + 3_600_000)}, null)`;
  }
  const revoked = plan.identities[2]!;
  const revokedAudience = `https://${input.host}:${input.httpsPort}/mcp`;
  await tx`insert into mcp_oauth_access_tokens (id, token_hash, family_id, client_id, user_id, workspace_id, scopes, audience, expires_at, revoked_at) values (${resolveMcpSmokeFixtureIds(plan.fixtureKey).revoked.accessTokenId}, ${hashToken(plan.revokedToken)}, ${resolveMcpSmokeFixtureIds(plan.fixtureKey).revoked.familyId}, ${revoked.clientId}, ${stableUuid(`${plan.fixtureKey}:user:viewer`)}, ${revoked.workspaceId}, ${tx.json(revoked.scopes as never)}, ${revokedAudience}, ${new Date(now.getTime() + 3_600_000)}, ${now})`;
  const fixtureIds = resolveMcpSmokeFixtureIds(plan.fixtureKey);
  await insertContentSourceFixture(tx, plan, plan.workspaceIds[0], fixtureIds.content.foreign.assetId, now, 0);
  await insertContentSourceFixture(tx, plan, plan.workspaceIds[1], fixtureIds.content.viewer.assetId, now, 1);
  await insertConversationSourceFixture(tx, plan, plan.workspaceIds[0], fixtureIds.aggregate.foreign, now, 0);
  await insertConversationSourceFixture(tx, plan, plan.workspaceIds[1], fixtureIds.aggregate.viewer, now, 1);
  await insertProposal(tx, plan, plan.workspaceIds[0], plan.identities[0]!.clientId, plan.foreignProposalId, fixtureIds.aggregate.foreign, "Foreign proposal");
  await insertProposal(tx, plan, plan.workspaceIds[1], plan.identities[2]!.clientId, plan.viewerProposalId, fixtureIds.aggregate.viewer, "Viewer proposal");
}

async function insertConversationSourceFixture(
  tx: any,
  plan: McpSmokeSeedPlan,
  workspaceId: string,
  aggregateId: string,
  now: Date,
  index: 0 | 1,
): Promise<void> {
  const ids = resolveMcpSmokeConversationFixtureIds(plan.fixtureKey, index);
  const profile = `local-fake-profile-${plan.fixtureKey}-${index}`;
  const providerThreadId = `local-fake-thread-${plan.fixtureKey}-${index}`;
  const providerMessageId = `local-fake-message-${plan.fixtureKey}-${index}`;
  await tx`insert into connected_accounts (id, workspace_id, provider, provider_account_id, display_name, status, capabilities, quotas, encrypted_secret, last_checked_at) values (${ids.accountId}, ${workspaceId}, 'unipile', ${ids.providerAccountId}, ${`MCP smoke local fake messaging ${index}`}, 'connected', ${tx.json({ linkedin: { messaging: true } } as never)}, ${tx.json({ linkedin: { remaining: 4 } } as never)}, 'local-fixture-no-provider', ${now})`;
  await tx`insert into contacts (id, workspace_id, first_name, last_name, preferred_channel, status, source, created_at, updated_at, revision) values (${ids.contactId}, ${workspaceId}, ${`Smoke${index}`}, 'Contact', 'linkedin', 'active', 'manual', ${now}, ${now}, 1)`;
  await tx`insert into contact_identities (id, workspace_id, contact_id, type, value, normalized_value, verification_status, source, created_at, updated_at) values (${ids.identityId}, ${workspaceId}, ${ids.contactId}, 'linkedin', ${profile}, ${profile}, 'verified', 'manual', ${now}, ${now})`;
  await tx`insert into conversations (id, workspace_id, contact_id, connected_account_id, provider, provider_account_id, provider_thread_id, channel, origin, automation_mode, subject, status, unread_count, last_message_at, created_at, updated_at) values (${aggregateId}, ${workspaceId}, ${ids.contactId}, ${ids.accountId}, 'unipile', ${ids.providerAccountId}, ${providerThreadId}, 'linkedin', 'outside_campaign', 'setter', ${`MCP smoke conversation ${index}`}, 'open', 0, ${now}, ${now}, ${now})`;
  // An outbound seed message proves the conversation/message relation while
  // keeping the authoritative human-reply fact false for prepare/worker.
  await tx`insert into messages (id, workspace_id, conversation_id, provider_message_id, direction, sender_type, body, sent_at, created_at) values (${ids.messageId}, ${workspaceId}, ${aggregateId}, ${providerMessageId}, 'outbound', 'system', 'Local smoke conversation seed', ${now}, ${now})`;
}

async function insertContentSourceFixture(
  tx: any,
  plan: McpSmokeSeedPlan,
  workspaceId: string,
  aggregateId: string,
  now: Date,
  index: number,
): Promise<void> {
  const offerId = stableUuid(`${plan.fixtureKey}:content:${index}:offer`);
  const offerVersionId = stableUuid(`${plan.fixtureKey}:content:${index}:offer-version`);
  const icpId = stableUuid(`${plan.fixtureKey}:content:${index}:icp`);
  const icpVersionId = stableUuid(`${plan.fixtureKey}:content:${index}:icp-version`);
  const strategyId = stableUuid(`${plan.fixtureKey}:content:${index}:strategy`);
  const strategyVersionId = stableUuid(`${plan.fixtureKey}:content:${index}:strategy-version`);
  const ideaId = stableUuid(`${plan.fixtureKey}:content:${index}:idea`);
  const generationRunId = stableUuid(`${plan.fixtureKey}:content:${index}:generation-run`);
  const briefId = stableUuid(`${plan.fixtureKey}:content:${index}:brief`);
  const assetVersionId = stableUuid(`${plan.fixtureKey}:content:${index}:asset-version`);
  const source = resolveMcpSmokeFixtureIds(plan.fixtureKey).content[index === 0 ? "foreign" : "viewer"];
  const publicationId = source.publicationId;
  const accountId = source.accountId;
  const providerAccountId = source.providerAccountId;
  const campaignSchedule = { start: "09:00", end: "17:00", timeZone: "UTC" };
  await tx`insert into offers (id, workspace_id, name, status, current_version, category, value_proposition, target_audience) values (${offerId}, ${workspaceId}, ${`MCP smoke ${plan.fixtureKey} content offer ${index}`}, 'draft', 1, 'saas', 'Local fixture', 'Local fixture')`;
  await tx`insert into offer_versions (id, workspace_id, offer_id, version, name, category, value_proposition, target_audience, published_at) values (${offerVersionId}, ${workspaceId}, ${offerId}, 1, ${`MCP smoke ${plan.fixtureKey} content offer ${index}`}, 'saas', 'Local fixture', 'Local fixture', ${now})`;
  await tx`insert into icps (id, workspace_id, name, current_version) values (${icpId}, ${workspaceId}, ${`MCP smoke ${plan.fixtureKey} content ICP ${index}`}, 1)`;
  await tx`insert into icp_versions (id, workspace_id, icp_id, version, name, confidence, criteria, buying_committee, problems, signals, exclusions, unknowns, unresolved_contradictions, blocked_findings, published_at) values (${icpVersionId}, ${workspaceId}, ${icpId}, 1, ${`MCP smoke ${plan.fixtureKey} content ICP ${index}`}, '0.9000', ${tx.json({} as never)}, ${tx.json({} as never)}, ${tx.json([] as never)}, ${tx.json([] as never)}, ${tx.json([] as never)}, ${tx.json([] as never)}, ${tx.json([] as never)}, ${tx.json([] as never)}, ${now})`;
  await tx`insert into editorial_strategies (id, workspace_id, name, offer_id, offer_version_id, icp_id, icp_version_id, status, current_version, draft, provider, model, prompt_version) values (${strategyId}, ${workspaceId}, ${`MCP smoke ${plan.fixtureKey} content strategy ${index}`}, ${offerId}, ${offerVersionId}, ${icpId}, ${icpVersionId}, 'active', 1, ${tx.json({} as never)}, 'fixture', 'fixture', 'v1')`;
  await tx`insert into editorial_strategy_versions (id, workspace_id, strategy_id, version, offer_version_id, icp_version_id, snapshot, provider, model, prompt_version, published_at) values (${strategyVersionId}, ${workspaceId}, ${strategyId}, 1, ${offerVersionId}, ${icpVersionId}, ${tx.json({} as never)}, 'fixture', 'fixture', 'v1', ${now})`;
  await tx`insert into content_ideas (id, workspace_id, strategy_version_id, status, angle, rationale, audience, pillar, priority, fingerprint, freshness_until, first_seen_at, last_seen_at, created_at, updated_at) values (${ideaId}, ${workspaceId}, ${strategyVersionId}, 'discovered', 'Local fixture angle', 'Local fixture rationale', 'Local fixture audience', 'Local fixture pillar', 50, ${mcpSmokeProposalInputHash(`${plan.fixtureKey}:content:${index}:idea`)}, ${new Date(now.getTime() + 86_400_000)}, ${now}, ${now}, ${now}, ${now})`;
  await tx`insert into content_assets (id, workspace_id, idea_id, type, status, latest_version, revision, created_at, updated_at) values (${aggregateId}, ${workspaceId}, ${ideaId}, 'linkedin_text', 'ready', 1, 1, ${now}, ${now})`;
  await tx`insert into content_generation_runs (id, workspace_id, idea_id, asset_id, strategy_version_id, asset_version_id, status, stage, created_at, updated_at) values (${generationRunId}, ${workspaceId}, ${ideaId}, ${aggregateId}, ${strategyVersionId}, ${assetVersionId}, 'ready', 'completed', ${now}, ${now})`;
  await tx`insert into content_briefs (id, workspace_id, run_id, idea_id, strategy_version_id, snapshot, evidence_snapshot, created_at) values (${briefId}, ${workspaceId}, ${generationRunId}, ${ideaId}, ${strategyVersionId}, ${tx.json({} as never)}, ${tx.json({} as never)}, ${now})`;
  await tx`insert into content_asset_versions (id, workspace_id, asset_id, brief_id, generation_run_id, version, body, draft, audit, critique, readiness, ready, created_at) values (${assetVersionId}, ${workspaceId}, ${aggregateId}, ${briefId}, ${generationRunId}, 1, 'Local fixture body', ${tx.json({} as never)}, ${tx.json({} as never)}, ${tx.json({} as never)}, ${tx.json({ ready: true } as never)}, true, ${now})`;
  await tx`insert into connected_accounts (id, workspace_id, provider, provider_account_id, display_name, status, capabilities, quotas, encrypted_secret, last_checked_at) values (${accountId}, ${workspaceId}, 'unipile', ${providerAccountId}, ${`MCP smoke local fake ${index}`}, 'connected', ${tx.json({ linkedin: { publishing: true } } as never)}, ${tx.json({ linkedin: { remaining: 4 } } as never)}, 'local-fixture-no-provider', ${now})`;
  await tx`insert into workspace_channel_accounts (workspace_id, channel, provider, provider_account_id, display_name, selected_by, created_at, updated_at) values (${workspaceId}, 'linkedin', 'unipile', ${providerAccountId}, ${`MCP smoke local fake ${index}`}, ${stableUuid(`${plan.fixtureKey}:user:${index === 0 ? "reviewer" : "viewer"}`)}, ${now}, ${now})`;
  const scheduledFor = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  await tx`insert into content_publications (id, workspace_id, asset_id, asset_version_id, network, provider, status, request_key, scheduled_for, content_snapshot, policy_snapshot, account_snapshot, created_at, updated_at) values (${publicationId}, ${workspaceId}, ${aggregateId}, ${assetVersionId}, 'linkedin', 'unipile', 'scheduled', ${`mcp-smoke-${plan.fixtureKey}-content-${index}`}, ${scheduledFor}, ${tx.json({ body: "Local fixture body" } as never)}, ${tx.json({ policyVersion: "local-fixture-v1" } as never)}, ${tx.json({ provider: "unipile", providerAccountId } as never)}, ${now}, ${now})`;
  await tx`insert into campaigns (id, workspace_id, name, status, icp_version_id, channel, sequence_id, autopilot_policy, automation_stage, created_at, updated_at) values (${source.campaignId}, ${workspaceId}, ${`MCP smoke ${plan.fixtureKey} campaign ${index}`}, 'active', ${icpVersionId}, 'linkedin', ${stableUuid(`${plan.fixtureKey}:content:${index}:sequence`)}, ${tx.json({ scheduleWindow: campaignSchedule } as never)}, 'active', ${now}, ${now})`;
}

async function insertProposal(tx: any, plan: McpSmokeSeedPlan, workspaceId: string, clientId: string, proposalId: string, aggregateId: string, body: string): Promise<void> {
  const requestKey = stableUuid(`${proposalId}:request`);
  const correlationId = stableUuid(`${proposalId}:correlation`);
  const intent = { kind: "conversation_reply", aggregateId, body };
  const source = { kind: "conversation_reply", aggregateId, revision: 1, sourceVersion: 1, factsVersion: 1 };
  const contentOriginal = { body, subject: "Smoke fixture" };
  const approvalContext = { fixture: plan.fixtureKey };
  await tx`insert into mcp_effect_proposals (id, workspace_id, client_id, kind, request_key, input_hash, aggregate_id, intent_snapshot, source_snapshot, revision, source_version, status, version, correlation_id) values (${proposalId}, ${workspaceId}, ${clientId}, 'conversation_reply', ${requestKey}, ${mcpSmokeProposalInputHash(`${plan.fixtureKey}:${proposalId}`)}, ${aggregateId}, ${tx.json(intent as never)}, ${tx.json(source as never)}, 1, 1, 'approval_required', 1, ${correlationId})`;
  const approvalId = stableUuid(`${proposalId}:approval`);
  await tx`insert into approval_items (id, workspace_id, proposal_id, item_type, channel, content_original, context, status) values (${approvalId}, ${workspaceId}, ${proposalId}, 'mcp_external_effect', 'linkedin', ${tx.json(contentOriginal as never)}, ${tx.json(approvalContext as never)}, 'pending')`;
  await tx`update mcp_effect_proposals set approval_item_id = ${approvalId} where workspace_id = ${workspaceId} and id = ${proposalId}`;
}

export interface McpSmokeWorkspaceRecord {
  readonly id: string;
  readonly slug: string;
}

export function validateMcpSmokeWorkspaceIdentity(input: {
  readonly expectedId: string;
  readonly expectedSlug: string;
  readonly slugRows: readonly McpSmokeWorkspaceRecord[];
  readonly idRows: readonly McpSmokeWorkspaceRecord[];
}): void {
  const { expectedId, expectedSlug, slugRows, idRows } = input;
  if (slugRows.length > 1 || idRows.length > 1 || slugRows.length !== idRows.length) {
    throw new Error("MCP_SMOKE_FIXTURE_CLEANUP_IDENTITY_MISMATCH");
  }
  if (slugRows.length === 0) return;
  const slugRow = slugRows[0]!;
  const idRow = idRows[0]!;
  if (slugRow.id !== expectedId || slugRow.slug !== expectedSlug || idRow.id !== expectedId || idRow.slug !== expectedSlug) {
    throw new Error("MCP_SMOKE_FIXTURE_CLEANUP_IDENTITY_MISMATCH");
  }
}

async function removeFixtureRows(tx: any, workspaceSlugs: readonly string[], expectedWorkspaceIds: readonly [string, string]): Promise<void> {
  const targets: McpSmokeWorkspaceRecord[] = [];
  for (const [index, slug] of workspaceSlugs.entries()) {
    const expectedId = expectedWorkspaceIds[index];
    if (!expectedId) throw new Error("MCP_SMOKE_FIXTURE_CLEANUP_IDENTITY_MISMATCH");
    const slugRows = await tx`select id, slug from workspaces where slug = ${slug}` as McpSmokeWorkspaceRecord[];
    const idRows = await tx`select id, slug from workspaces where id = ${expectedId}` as McpSmokeWorkspaceRecord[];
    validateMcpSmokeWorkspaceIdentity({ expectedId, expectedSlug: slug, slugRows, idRows });
    if (slugRows.length === 1) targets.push({ id: expectedId, slug });
  }
  for (const target of targets) {
      const workspaceId = target.id;
      await tx`update mcp_effect_proposals set approval_item_id = null, operation_id = null, job_id = null, reconciliation_id = null where workspace_id = ${workspaceId}`;
      await tx`delete from mcp_effect_traces where workspace_id = ${workspaceId}`;
      await tx`delete from outbox_events where workspace_id = ${workspaceId}`;
      await tx`delete from mcp_effect_reconciliations where workspace_id = ${workspaceId}`;
      await tx`delete from mcp_effect_intentions where workspace_id = ${workspaceId}`;
      await tx`delete from mcp_operations where workspace_id = ${workspaceId}`;
      await tx`delete from content_publication_attempts where workspace_id = ${workspaceId}`;
      await tx`delete from content_publication_reconciliations where workspace_id = ${workspaceId}`;
      await tx`delete from content_publications where workspace_id = ${workspaceId}`;
      await tx`delete from workspace_channel_accounts where workspace_id = ${workspaceId}`;
      await tx`delete from campaigns where workspace_id = ${workspaceId}`;
      // Conversation source fixtures are mutable and must be detached before
      // contacts/accounts are removed. This order also keeps FK failures from
      // leaving a half-cleaned workspace fixture.
      await tx`delete from messages where workspace_id = ${workspaceId}`;
      await tx`delete from conversations where workspace_id = ${workspaceId}`;
      await tx`delete from contact_identities where workspace_id = ${workspaceId}`;
      await tx`delete from contacts where workspace_id = ${workspaceId}`;
      await tx`delete from connected_accounts where workspace_id = ${workspaceId}`;
      await tx`delete from approval_items where workspace_id = ${workspaceId}`;
      await tx`delete from mcp_effect_proposals where workspace_id = ${workspaceId}`;
      await tx`delete from jobs where workspace_id = ${workspaceId}`;
      await tx`delete from mcp_oauth_audit_events where workspace_id = ${workspaceId}`;
      await tx`delete from mcp_oauth_token_revocations where workspace_id = ${workspaceId}`;
      await tx`delete from mcp_oauth_refresh_tokens where workspace_id = ${workspaceId}`;
      await tx`delete from mcp_oauth_access_tokens where workspace_id = ${workspaceId}`;
      await tx`delete from mcp_oauth_authorization_codes where workspace_id = ${workspaceId}`;
      await tx`delete from mcp_oauth_clients where workspace_id = ${workspaceId}`;
      const users = await tx`select user_id from workspace_members where workspace_id = ${workspaceId}` as Array<{ readonly user_id: string }>;
      await tx`delete from workspace_members where workspace_id = ${workspaceId}`;
      for (const user of users) await tx`delete from auth_users where id = ${user.user_id}`;
      // The immutable content source rows are retained under this exact
      // fixture-owned workspace because 0070 intentionally forbids deleting
      // them. Never disable or bypass that trigger during cleanup.
  }
}

function stableUuid(seed: string): string {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sameScopes(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && expected.every((scope) => value.includes(scope))
    && value.every((scope) => typeof scope === "string");
}

export function stableMcpSmokeUuid(seed: string): string { return stableUuid(seed); }

function randomToken(): string { return randomBytes(32).toString("base64url"); }
function hashToken(value: string): string { return createHash("sha256").update(value).digest("base64url"); }
export function mcpSmokeProposalInputHash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }

if (import.meta.main) {
  const command = process.argv[2] ?? "prepare";
  const requestedMode = process.argv[3] ?? process.env.MCP_SMOKE_MODE ?? "create";
  if (requestedMode !== "create" && requestedMode !== "reuse") throw new Error("MCP smoke fixture mode is invalid");
  const databaseUrl = process.env.SMOKE_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("SMOKE_DATABASE_URL or TEST_DATABASE_URL is required");
  const fixtureKey = process.env.MCP_SMOKE_FIXTURE_KEY ?? `a4-${randomBytes(6).toString("hex")}`;
  const host = process.env.MCP_SMOKE_HOST ?? "mcp-smoke.localhost";
  const httpsPort = Number(process.env.MCP_SMOKE_HTTPS_PORT ?? "18443");
  const outputPath = process.env.MCP_SMOKE_ENV_FILE ?? join(MCP_SMOKE_PRIVATE_ENV_DIRECTORY, `mcp-smoke-${fixtureKey}.env`);
  if (command === "prepare") {
    await prepareMcpProductionSmoke(databaseUrl, outputPath, { fixtureKey, host, httpsPort }, { mode: requestedMode });
    console.log(outputPath);
  } else if (command === "revoke") {
    await revokeMcpProductionSmoke(databaseUrl, fixtureKey);
  } else if (command === "cleanup") {
    await cleanupMcpProductionSmoke(databaseUrl, fixtureKey, outputPath);
  } else {
    throw new Error("Usage: prepare-mcp-production-smoke.ts [prepare [create|reuse]|revoke|cleanup]");
  }
}
