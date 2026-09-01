import { chmod, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import postgres from "postgres";
import {
  cleanupMcpProductionSmoke,
  createMcpSmokeSeedPlan,
  formatMcpSmokeEnvironmentFile,
  McpSmokeFixtureError,
  prepareMcpProductionSmoke,
  resolveMcpSmokeFixtureIds,
  stableMcpSmokeUuid,
  type McpSmokeFixtureIds,
  type McpSmokeSeedPlan,
  type McpSmokeSeedPlanInput,
  type McpSmokeSeedTokens,
} from "./prepare-mcp-production-smoke";

export { resolveMcpSmokeFixtureIds } from "./prepare-mcp-production-smoke";

const FIXTURE_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
const TOKEN = /^[^\s\u0000-\u001f\u007f]{8,4096}$/;
const LOCAL_ENV_DIRECTORY = "/tmp/mcp-local-private";
export interface McpLocalFixtureResult {
  readonly fixtureKey: string;
  readonly workspaceIds: readonly [string, string];
  readonly workspaceSlugs: readonly [string, string];
  readonly identities: readonly [McpLocalIdentity, McpLocalIdentity, McpLocalIdentity];
  readonly fixtureIds: McpLocalFixtureIds;
  readonly credentials: McpLocalPrivateCredentials;
  readonly resource: string;
  readonly envFilePath: string;
  readonly redactedSummary: string;
}

export interface McpLocalIdentity {
  readonly name: "reviewer" | "operator" | "viewer";
  readonly workspaceId: string;
  readonly role: "reviewer" | "operator" | "viewer";
  readonly scopes: readonly string[];
  readonly clientId: string;
}

export interface McpLocalPrivateIdentity extends McpLocalIdentity {
  readonly kind: "identity";
  readonly token: string;
  readonly revoked: false;
}

export interface McpLocalPrivateRevokedIdentity {
  readonly kind: "revoked";
  readonly name: "revoked";
  readonly workspaceId: string;
  readonly role: "viewer";
  readonly scopes: readonly ["mcp:read"];
  readonly clientId: string;
  readonly token: string;
  readonly accessTokenId: string;
  readonly familyId: string;
  readonly revoked: true;
}

export type McpLocalPrivateCredential = McpLocalPrivateIdentity | McpLocalPrivateRevokedIdentity;

export interface McpLocalPrivateCredentials {
  readonly envFilePath: string;
}

interface StoredMcpLocalTokens extends McpSmokeSeedTokens {}
const PRIVATE_CREDENTIALS = new WeakMap<McpLocalPrivateCredentials, StoredMcpLocalTokens>();

export interface McpLocalSeedOptions {
  readonly mode: "create" | "reuse";
}

export interface McpLocalPrepareOptions {
  readonly databaseUrl: string;
  readonly fixtureKey: string;
  readonly envFilePath: string;
  /** Private #80 stack environment owning host, HTTPS port, and audience. */
  readonly stackEnvFilePath?: string;
  readonly readPrivateFile: (path: string) => Promise<string | null>;
  readonly writePrivateFile: (path: string, content: string) => Promise<void>;
  readonly seed?: (
    databaseUrl: string,
    outputPath: string,
    input: McpSmokeSeedPlanInput,
    options: McpLocalSeedOptions,
  ) => Promise<McpSmokeSeedPlan>;
}

export type PrepareMcpLocalOptions = McpLocalPrepareOptions;

export interface CleanupMcpLocalOptions {
  readonly databaseUrl: string;
  readonly fixtureKey: string;
  readonly envFilePath?: string;
  readonly client: McpLocalFixtureDatabaseClient;
}

export interface McpLocalFixtureDatabaseClient {
  readonly deleteFixtureKey: (fixtureKey: string) => Promise<void>;
  readonly close: () => Promise<void>;
}

export interface McpLocalFixtureFingerprint {
  readonly fixtureKey: string;
  readonly workspaceIds: readonly string[];
  readonly workspaces: number;
  readonly users: number;
  readonly memberships: number;
  readonly clients: number;
  readonly accessTokens: number;
  readonly proposals: number;
  readonly approvals: number;
}

export type McpLocalFixtureIds = McpSmokeFixtureIds;

export class McpLocalFixtureError extends Error {
  readonly code:
    | "MCP_LOCAL_FIXTURE_INVALID"
    | "MCP_LOCAL_FIXTURE_PARTIAL"
    | "MCP_LOCAL_FIXTURE_MISMATCH"
    | "MCP_LOCAL_DATABASE_INVALID"
    | "MCP_LOCAL_STACK_ENV_REQUIRED"
    | "MCP_LOCAL_CLEANUP_CLIENT_REQUIRED"
    | "MCP_LOCAL_FIXTURE_CLEANUP_REQUIRED";

  constructor(code: McpLocalFixtureError["code"]) {
    super(code);
    this.name = "McpLocalFixtureError";
    this.code = code;
  }
}

/** Resolve private credentials in memory; this value must never be serialized into a report. */
export function loadMcpLocalPrivateCredential(
  credentials: McpLocalPrivateCredentials,
  identities: readonly McpLocalIdentity[],
  fixtureIds: McpLocalFixtureIds,
  name: "reviewer" | "operator" | "viewer" | "revoked",
): McpLocalPrivateCredential {
  const tokens = PRIVATE_CREDENTIALS.get(credentials);
  if (!tokens) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_MISMATCH");
  if (name === "revoked") {
    const viewer = identities.find((identity) => identity.name === "viewer");
    if (!viewer) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_MISMATCH");
    return {
      kind: "revoked",
      name,
      workspaceId: viewer.workspaceId,
      role: "viewer",
      scopes: ["mcp:read"],
      clientId: viewer.clientId,
      token: tokens.revoked,
      accessTokenId: fixtureIds.revoked.accessTokenId,
      familyId: fixtureIds.revoked.familyId,
      revoked: true,
    };
  }
  const identity = identities.find((candidate) => candidate.name === name);
  if (!identity) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_MISMATCH");
  const token = name === "reviewer" ? tokens.reviewer : name === "operator" ? tokens.operator : tokens.viewer;
  return { ...identity, kind: "identity", token, revoked: false };
}

/** Prepare or reuse the A4 fixture without duplicating any fixture SQL. */
export async function prepareMcpLocal(options: PrepareMcpLocalOptions): Promise<McpLocalFixtureResult> {
  validateLocalDatabaseUrl(options.databaseUrl);
  validateFixtureKey(options.fixtureKey);
  if (!options.envFilePath.trim()) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_INVALID");
  const privateContent = await options.readPrivateFile(options.envFilePath);
  const privateValues = privateContent ? parsePrivateEnvironment(privateContent) : {};
  const stackEnvFilePath = options.stackEnvFilePath;
  if (stackEnvFilePath?.trim() === options.envFilePath.trim()) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_INVALID");
  const stackContent = stackEnvFilePath ? await options.readPrivateFile(stackEnvFilePath) : null;
  if (stackEnvFilePath && stackContent === null) throw new McpLocalFixtureError("MCP_LOCAL_STACK_ENV_REQUIRED");
  const stackValues = stackContent === null ? {} : parsePrivateEnvironment(stackContent);
  const hasPrivateKeys = Object.keys(privateValues).some((key) => key.startsWith("MCP_LOCAL_"));
  const existingFixtureKey = privateValues.MCP_LOCAL_FIXTURE_KEY;
  if (hasPrivateKeys && !existingFixtureKey) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_PARTIAL");
  if (existingFixtureKey && existingFixtureKey !== options.fixtureKey) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_MISMATCH");
  const tokens = existingFixtureKey ? readPrivateTokens(privateValues) : undefined;
  const endpoint = stackEnvFilePath
    ? resolveConfiguredEndpoint(stackValues, privateValues, Boolean(existingFixtureKey))
    : resolveEndpoint(privateValues, Boolean(existingFixtureKey));
  const mode: McpLocalSeedOptions["mode"] = existingFixtureKey ? "reuse" : "create";
  const input: McpSmokeSeedPlanInput = {
    fixtureKey: options.fixtureKey,
    host: endpoint.host,
    httpsPort: endpoint.httpsPort,
    ...(tokens ? { tokens } : {}),
  };
  const seed = options.seed ?? prepareMcpProductionSmoke;
  let plan: McpSmokeSeedPlan;
  try {
    plan = await seed(options.databaseUrl, options.envFilePath, input, { mode });
  } catch (error) {
    if (error instanceof McpSmokeFixtureError && error.code === "MCP_SMOKE_FIXTURE_MISMATCH") {
      throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_MISMATCH");
    }
    throw error;
  }
  if (plan.fixtureKey !== options.fixtureKey) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_MISMATCH");
  if (tokens && (plan.identities[0]!.token !== tokens.reviewer || plan.identities[1]!.token !== tokens.operator || plan.identities[2]!.token !== tokens.viewer || plan.revokedToken !== tokens.revoked)) {
    throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_MISMATCH");
  }
  const fixtureIds = resolveMcpSmokeFixtureIds(plan.fixtureKey);
  const identities: McpLocalFixtureResult["identities"] = [
    { name: "reviewer", workspaceId: plan.identities[0]!.workspaceId, role: "reviewer", scopes: plan.identities[0]!.scopes, clientId: plan.identities[0]!.clientId },
    { name: "operator", workspaceId: plan.identities[1]!.workspaceId, role: "operator", scopes: plan.identities[1]!.scopes, clientId: plan.identities[1]!.clientId },
    { name: "viewer", workspaceId: plan.identities[2]!.workspaceId, role: "viewer", scopes: plan.identities[2]!.scopes, clientId: plan.identities[2]!.clientId },
  ];
  const credentials: McpLocalPrivateCredentials = Object.freeze({
    envFilePath: options.envFilePath,
  });
  PRIVATE_CREDENTIALS.set(credentials, Object.freeze({
    reviewer: plan.identities[0]!.token,
    operator: plan.identities[1]!.token,
    viewer: plan.identities[2]!.token,
    revoked: plan.revokedToken,
  }));
  if (!existingFixtureKey) {
    const generated = formatPrivateEnvironment(options.fixtureKey, plan, options.envFilePath, endpoint.host, endpoint.httpsPort);
    try {
      const seededContent = await options.readPrivateFile(options.envFilePath);
      await options.writePrivateFile(options.envFilePath, mergePrivateEnvironment(seededContent ?? privateContent, generated));
    } catch {
      if (privateContent === null) await unlink(options.envFilePath).catch(() => undefined);
      throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_CLEANUP_REQUIRED");
    }
  }
  const resource = endpoint.resource;
  return {
    fixtureKey: plan.fixtureKey,
    workspaceIds: plan.workspaceIds,
    workspaceSlugs: plan.workspaceSlugs,
    identities,
    fixtureIds,
    credentials,
    resource,
    envFilePath: options.envFilePath,
    redactedSummary: JSON.stringify({ fixtureKey: plan.fixtureKey, workspaceIds: plan.workspaceIds, workspaceSlugs: plan.workspaceSlugs, roles: ["reviewer", "operator", "viewer"], resource }),
  };
}

/** Delete only the exact fixture after the caller supplies its explicit DB client. */
export async function cleanupMcpLocal(options: CleanupMcpLocalOptions): Promise<void> {
  validateLocalDatabaseUrl(options.databaseUrl);
  validateFixtureKey(options.fixtureKey);
  if (!options.client || typeof options.client.deleteFixtureKey !== "function") throw new McpLocalFixtureError("MCP_LOCAL_CLEANUP_CLIENT_REQUIRED");
  await options.client.deleteFixtureKey(options.fixtureKey);
  if (options.envFilePath) {
    const content = await readFile(options.envFilePath, "utf8").catch(() => null);
    if (content && parsePrivateEnvironment(content).MCP_LOCAL_FIXTURE_KEY === options.fixtureKey) await unlink(options.envFilePath).catch(() => undefined);
  }
}

/** Construct a cleanup client around the existing A4, fixture-key-scoped SQL. */
export function createMcpLocalFixtureDatabaseClient(databaseUrl: string): McpLocalFixtureDatabaseClient {
  validateLocalDatabaseUrl(databaseUrl);
  return {
    deleteFixtureKey: (fixtureKey) => cleanupMcpProductionSmoke(databaseUrl, fixtureKey),
    close: async () => undefined,
  };
}

/** Read-only counts prove same-key reuse without exposing rows or credentials. */
export async function readMcpLocalFixtureFingerprint(databaseUrl: string, fixtureKey: string): Promise<McpLocalFixtureFingerprint> {
  validateFixtureKey(fixtureKey);
  validateLocalDatabaseUrl(databaseUrl);
  const plan = createMcpSmokeSeedPlan({ fixtureKey, host: "mcp.localhost", httpsPort: 18443, tokens: { reviewer: "fingerprint-reviewer", operator: "fingerprint-operator", viewer: "fingerprint-viewer", revoked: "fingerprint-revoked" } });
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 20 });
  try {
    const workspaces = await sql`select id, slug from workspaces where slug in (${plan.workspaceSlugs[0]}, ${plan.workspaceSlugs[1]}) order by slug` as Array<{ readonly id: string; readonly slug: string }>;
    const workspaceIds = workspaces.map((row) => row.id);
    const users = [
      stableMcpSmokeUuid(`${fixtureKey}:user:reviewer`),
      stableMcpSmokeUuid(`${fixtureKey}:user:operator`),
      stableMcpSmokeUuid(`${fixtureKey}:user:viewer`),
    ] as const;
    const count = async (query: PromiseLike<readonly unknown[]>): Promise<number> => {
      const rows = await query as readonly [{ readonly count?: number | string | bigint }?];
      return Number(rows[0]?.count ?? 0);
    };
    const workspaceCount = await count(sql`select count(*)::int as count from workspaces where slug in (${plan.workspaceSlugs[0]}, ${plan.workspaceSlugs[1]})`);
    const userCount = await count(sql`select count(*)::int as count from auth_users where id in (${users[0]}, ${users[1]}, ${users[2]})`);
    const membershipCount = await count(sql`select count(*)::int as count from workspace_members where workspace_id in (select id from workspaces where slug in (${plan.workspaceSlugs[0]}, ${plan.workspaceSlugs[1]}))`);
    const clientCount = await count(sql`select count(*)::int as count from mcp_oauth_clients where workspace_id in (select id from workspaces where slug in (${plan.workspaceSlugs[0]}, ${plan.workspaceSlugs[1]}))`);
    const accessTokenCount = await count(sql`select count(*)::int as count from mcp_oauth_access_tokens where workspace_id in (select id from workspaces where slug in (${plan.workspaceSlugs[0]}, ${plan.workspaceSlugs[1]}))`);
    const proposalCount = await count(sql`select count(*)::int as count from mcp_effect_proposals where workspace_id in (select id from workspaces where slug in (${plan.workspaceSlugs[0]}, ${plan.workspaceSlugs[1]}))`);
    const approvalCount = await count(sql`select count(*)::int as count from approval_items where workspace_id in (select id from workspaces where slug in (${plan.workspaceSlugs[0]}, ${plan.workspaceSlugs[1]}))`);
    return { fixtureKey, workspaceIds, workspaces: workspaceCount, users: userCount, memberships: membershipCount, clients: clientCount, accessTokens: accessTokenCount, proposals: proposalCount, approvals: approvalCount };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function validateFixtureKey(fixtureKey: string): void {
  if (!FIXTURE_KEY.test(fixtureKey)) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_INVALID");
}

interface LocalMcpEndpoint {
  readonly host: string;
  readonly httpsPort: number;
  readonly resource: string;
}

function resolveEndpoint(values: Record<string, string>, existingFixture: boolean): LocalMcpEndpoint {
  return resolveEndpointStrict(values, existingFixture, true);
}

function resolveConfiguredEndpoint(
  stackValues: Record<string, string>,
  fixtureValues: Record<string, string>,
  existingFixture: boolean,
): LocalMcpEndpoint {
  if (!hasEndpointValues(stackValues)) throw new McpLocalFixtureError("MCP_LOCAL_STACK_ENV_REQUIRED");
  const endpoint = resolveEndpointStrict(stackValues, false, false);
  if (hasEndpointValues(fixtureValues)) {
    const fixtureEndpoint = resolveEndpointStrict(fixtureValues, existingFixture, false);
    if (fixtureEndpoint.host !== endpoint.host || fixtureEndpoint.httpsPort !== endpoint.httpsPort) {
      throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_MISMATCH");
    }
  }
  return endpoint;
}

function hasEndpointValues(values: Record<string, string>): boolean {
  return Boolean(values.MCP_LOCAL_RESOURCE || values.MCP_SMOKE_RESOURCE || values.MCP_LOCAL_HOST || values.MCP_LOCAL_HTTPS_PORT);
}

function resolveEndpointStrict(values: Record<string, string>, existingFixture: boolean, allowDefaults: boolean): LocalMcpEndpoint {
  const endpointValue = values.MCP_LOCAL_RESOURCE ?? values.MCP_SMOKE_RESOURCE;
  let resourceEndpoint: { readonly host: string; readonly port: number } | undefined;
  if (endpointValue) {
    try {
      const parsed = new URL(endpointValue);
      const host = parsed.hostname.replace(/^\[|\]$/g, "");
      const port = Number(parsed.port || "443");
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/mcp" || parsed.search || parsed.hash || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("invalid");
      validateHost(host);
      resourceEndpoint = { host: parsed.hostname.startsWith("[") ? `[${host}]` : host, port };
    } catch {
      throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_INVALID");
    }
  }
  const hostValue = values.MCP_LOCAL_HOST;
  const portValue = values.MCP_LOCAL_HTTPS_PORT;
  if (existingFixture && !endpointValue && (!hostValue || !portValue)) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_PARTIAL");
  const host = hostValue ?? resourceEndpoint?.host ?? (allowDefaults ? "mcp.localhost" : undefined);
  if (!host) throw new McpLocalFixtureError("MCP_LOCAL_STACK_ENV_REQUIRED");
  validateHost(host);
  const httpsPort = portValue ? parsePort(portValue) : resourceEndpoint?.port ?? (allowDefaults ? 18443 : undefined);
  if (!httpsPort) throw new McpLocalFixtureError("MCP_LOCAL_STACK_ENV_REQUIRED");
  if (resourceEndpoint && (resourceEndpoint.host !== host || resourceEndpoint.port !== httpsPort)) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_MISMATCH");
  return { host, httpsPort, resource: `https://${host}:${httpsPort}/mcp` };
}

function validateHost(host: string): void {
  if (host.startsWith("[") || host.endsWith("]")) {
    if (!/^\[[0-9A-Fa-f:.]+\]$/.test(host)) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_INVALID");
    return;
  }
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(host)) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_INVALID");
}

function parsePort(port: string): number {
  if (!/^\d{1,5}$/.test(port)) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_INVALID");
  const value = Number(port);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_INVALID");
  return value;
}

export function validateLocalDatabaseUrl(databaseUrl: string): void {
  try {
    const url = new URL(databaseUrl);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (!(url.protocol === "postgres:" || url.protocol === "postgresql:") || !["localhost", "127.0.0.1", "::1"].includes(hostname) || !url.pathname.slice(1) || url.search || url.hash) throw new Error("invalid");
  } catch {
    throw new McpLocalFixtureError("MCP_LOCAL_DATABASE_INVALID");
  }
}

function parsePrivateEnvironment(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  const seen = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^\s*([A-Z][A-Z0-9_]*)=(.*)\s*$/.exec(line);
    if (!match || seen.has(match[1]!)) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_INVALID");
    seen.add(match[1]!);
    values[match[1]!] = unquote(match[2]!);
  }
  return values;
}

function readPrivateTokens(values: Record<string, string>): McpSmokeSeedTokens {
  const tokens = {
    reviewer: values.MCP_LOCAL_REVIEWER_TOKEN,
    operator: values.MCP_LOCAL_OPERATOR_TOKEN,
    viewer: values.MCP_LOCAL_VIEWER_TOKEN,
    revoked: values.MCP_LOCAL_REVOKED_TOKEN,
  };
  if (Object.values(tokens).some((token) => !token || !TOKEN.test(token))) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_PARTIAL");
  return tokens as McpSmokeSeedTokens;
}

function formatPrivateEnvironment(fixtureKey: string, plan: McpSmokeSeedPlan, envFilePath: string, host: string, httpsPort: number): string {
  return [
    `MCP_LOCAL_FIXTURE_KEY=${shellQuote(fixtureKey)}`,
    `MCP_LOCAL_HOST=${shellQuote(host)}`,
    `MCP_LOCAL_HTTPS_PORT=${shellQuote(String(httpsPort))}`,
    `MCP_LOCAL_RESOURCE=${shellQuote(`https://${host}:${httpsPort}/mcp`)}`,
    `MCP_LOCAL_REVIEWER_TOKEN=${shellQuote(plan.identities[0]!.token)}`,
    `MCP_LOCAL_OPERATOR_TOKEN=${shellQuote(plan.identities[1]!.token)}`,
    `MCP_LOCAL_VIEWER_TOKEN=${shellQuote(plan.identities[2]!.token)}`,
    `MCP_LOCAL_REVOKED_TOKEN=${shellQuote(plan.revokedToken)}`,
    `MCP_LOCAL_ENV_FILE=${shellQuote(envFilePath)}`,
    "",
  ].join("\n");
}

function mergePrivateEnvironment(existing: string | null, generated: string): string {
  return existing?.trim() ? `${existing.trimEnd()}\n${generated}` : generated;
}

function unquote(value: string): string {
  if (value.startsWith("'") || value.startsWith('"')) {
    if (!value.endsWith(value[0]!)) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_INVALID");
    return value.slice(1, -1).replaceAll("'\\''", "'");
  }
  if (/\s/.test(value)) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_INVALID");
  return value;
}

function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }

if (import.meta.main) {
  const command = process.argv[2] ?? "seed";
  const databaseUrl = process.env.MCP_LOCAL_DATABASE_URL ?? process.env.MCP_LOCAL_TEST_DATABASE_URL;
  if (!databaseUrl) throw new McpLocalFixtureError("MCP_LOCAL_DATABASE_INVALID");
  validateLocalDatabaseUrl(databaseUrl);
  const fixtureKey = process.env.MCP_LOCAL_FIXTURE_KEY ?? "local-default";
  const envFilePath = process.env.MCP_LOCAL_ENV_FILE ?? join(LOCAL_ENV_DIRECTORY, `${fixtureKey}.env`);
  if (command === "seed") {
    const stackEnvFilePath = process.env.MCP_LOCAL_STACK_ENV_FILE;
    if (!stackEnvFilePath) throw new McpLocalFixtureError("MCP_LOCAL_STACK_ENV_REQUIRED");
    await mkdir(dirname(envFilePath), { recursive: true, mode: 0o700 });
    await chmod(dirname(envFilePath), 0o700);
    const result = await prepareMcpLocal({
      databaseUrl,
      fixtureKey,
      envFilePath,
      stackEnvFilePath,
      readPrivateFile: async (path) => readFile(path, "utf8").catch(() => null),
      writePrivateFile: async (path, content) => {
        await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
        await chmod(path, 0o600);
        if (((await stat(path)).mode & 0o777) !== 0o600) throw new McpLocalFixtureError("MCP_LOCAL_FIXTURE_INVALID");
      },
    });
    console.log(`MCP local fixture ready: ${result.fixtureKey}`);
  } else if (command === "cleanup") {
    const client = createMcpLocalFixtureDatabaseClient(databaseUrl);
    try {
      await cleanupMcpLocal({ databaseUrl, fixtureKey, envFilePath, client });
    } finally {
      await client.close();
    }
  } else {
    throw new Error("Usage: prepare-mcp-local.ts [seed|cleanup]");
  }
}
