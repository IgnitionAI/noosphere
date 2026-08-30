import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import postgres from "postgres";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIXTURE_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
const TOKEN = /^[^\s\u0000-\u001f\u007f]{8,4096}$/;
const EMPTY_REDIRECT_URIS: readonly string[] = [];
export const MCP_SMOKE_PRIVATE_ENV_DIRECTORY = "/tmp/mcp-smoke-private";

export interface McpSmokeSeedTokens {
  readonly reviewer: string;
  readonly operator: string;
  readonly viewer: string;
  readonly revoked: string;
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
    foreignProposalId: stableUuid(`${input.fixtureKey}:proposal:foreign`),
    viewerProposalId: stableUuid(`${input.fixtureKey}:proposal:viewer`),
    revokedToken: tokens.revoked,
  };
}

/** Serialize only smoke inputs. Database credentials are deliberately absent. */
export function formatMcpSmokeEnvironmentFile(plan: McpSmokeSeedPlan, host = "mcp-smoke.localhost", httpsPort = 18443): string {
  const endpoint = `https://${host}:${httpsPort}/mcp`;
  const identities = plan.identities.map(({ clientId: _clientId, ...identity }) => identity);
  return [
    `MCP_SMOKE_URL=${shellQuote(endpoint)}`,
    `MCP_SMOKE_RESOURCE=${shellQuote(endpoint)}`,
    `MCP_SMOKE_IDENTITIES_JSON=${shellQuote(JSON.stringify(identities))}`,
    `MCP_SMOKE_FOREIGN_PROPOSAL_ID=${shellQuote(plan.foreignProposalId)}`,
    `MCP_SMOKE_VIEWER_PROPOSAL_ID=${shellQuote(plan.viewerProposalId)}`,
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
): Promise<McpSmokeSeedPlan> {
  const plan = createMcpSmokeSeedPlan(input);
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 20 });
  const now = new Date();
  try {
    await prepareMcpSmokeEnvironmentDirectory(outputPath);
    await sql.begin(async (tx) => {
      await removeFixtureRows(tx, plan.workspaceSlugs);
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
      await tx`insert into mcp_oauth_access_tokens (id, token_hash, family_id, client_id, user_id, workspace_id, scopes, audience, expires_at, revoked_at) values (${stableUuid(`${plan.fixtureKey}:access:revoked`)}, ${hashToken(plan.revokedToken)}, ${stableUuid(`${plan.fixtureKey}:family:revoked`)}, ${revoked.clientId}, ${stableUuid(`${plan.fixtureKey}:user:viewer`)}, ${revoked.workspaceId}, ${tx.json(revoked.scopes as never)}, ${revokedAudience}, ${new Date(now.getTime() + 3_600_000)}, ${now})`;
      await insertProposal(tx, plan, plan.workspaceIds[0], plan.identities[0]!.clientId, plan.foreignProposalId, stableUuid(`${plan.fixtureKey}:aggregate:foreign`), "Foreign proposal");
      await insertProposal(tx, plan, plan.workspaceIds[1], plan.identities[2]!.clientId, plan.viewerProposalId, stableUuid(`${plan.fixtureKey}:aggregate:viewer`), "Viewer proposal");
    });
    await writeFile(outputPath, formatMcpSmokeEnvironmentFile(plan, input.host, input.httpsPort), { encoding: "utf8", mode: 0o600 });
    await chmod(outputPath, 0o600);
    const mode = (await stat(outputPath)).mode & 0o777;
    if (mode !== 0o600) throw new Error("MCP smoke environment file must be mode 0600");
    return plan;
  } catch {
    throw new Error("MCP smoke fixture preparation failed");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Remove only rows identified by the exact generated workspace slugs. */
export async function cleanupMcpProductionSmoke(databaseUrl: string, fixtureKey: string, outputPath?: string): Promise<void> {
  if (!FIXTURE_KEY.test(fixtureKey)) throw new Error("MCP smoke fixture key is invalid");
  const slugs = [`mcp-smoke-${fixtureKey}-a`, `mcp-smoke-${fixtureKey}-b`] as const;
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 20 });
  try {
    await sql.begin(async (tx) => removeFixtureRows(tx, slugs));
    if (outputPath) await unlink(outputPath).catch(() => undefined);
  } catch {
    throw new Error("MCP smoke fixture cleanup failed");
  } finally {
    await sql.end({ timeout: 5 });
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

async function removeFixtureRows(tx: any, workspaceSlugs: readonly string[]): Promise<void> {
  for (const slug of workspaceSlugs) {
    const rows = await tx`select id from workspaces where slug = ${slug}` as Array<{ readonly id: string }>;
    for (const row of rows) {
      const workspaceId = row.id;
      await tx`update mcp_effect_proposals set approval_item_id = null, operation_id = null, job_id = null, reconciliation_id = null where workspace_id = ${workspaceId}`;
      await tx`delete from mcp_effect_traces where workspace_id = ${workspaceId}`;
      await tx`delete from outbox_events where workspace_id = ${workspaceId}`;
      await tx`delete from mcp_effect_reconciliations where workspace_id = ${workspaceId}`;
      await tx`delete from mcp_effect_intentions where workspace_id = ${workspaceId}`;
      await tx`delete from mcp_operations where workspace_id = ${workspaceId}`;
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
      await tx`delete from workspaces where id = ${workspaceId}`;
    }
  }
}

function stableUuid(seed: string): string {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function randomToken(): string { return randomBytes(32).toString("base64url"); }
function hashToken(value: string): string { return createHash("sha256").update(value).digest("base64url"); }
export function mcpSmokeProposalInputHash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }

if (import.meta.main) {
  const command = process.argv[2] ?? "prepare";
  const databaseUrl = process.env.SMOKE_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("SMOKE_DATABASE_URL or TEST_DATABASE_URL is required");
  const fixtureKey = process.env.MCP_SMOKE_FIXTURE_KEY ?? `a4-${randomBytes(6).toString("hex")}`;
  const host = process.env.MCP_SMOKE_HOST ?? "mcp-smoke.localhost";
  const httpsPort = Number(process.env.MCP_SMOKE_HTTPS_PORT ?? "18443");
  const outputPath = process.env.MCP_SMOKE_ENV_FILE ?? join(MCP_SMOKE_PRIVATE_ENV_DIRECTORY, `mcp-smoke-${fixtureKey}.env`);
  if (command === "prepare") {
    await prepareMcpProductionSmoke(databaseUrl, outputPath, { fixtureKey, host, httpsPort });
    console.log(outputPath);
  } else if (command === "revoke") {
    await revokeMcpProductionSmoke(databaseUrl, fixtureKey);
  } else if (command === "cleanup") {
    await cleanupMcpProductionSmoke(databaseUrl, fixtureKey, outputPath);
  } else {
    throw new Error("Usage: prepare-mcp-production-smoke.ts [prepare|revoke|cleanup]");
  }
}
