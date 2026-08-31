import { chmod, open, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";

const MCP_INSPECTOR_VERSION = "0.16.3";
const MAX_IDENTITIES = 12;
const MAX_REFERENCE_LENGTH = 4_096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const ROLES = new Set<McpLocalRole>(["reviewer", "operator", "viewer"]);
const SCOPES = new Set<McpLocalScope>(["mcp:read", "mcp:write", "mcp:approve"]);
const ROLE_SCOPES: Readonly<Record<McpLocalRole, ReadonlySet<McpLocalScope>>> = {
  reviewer: new Set(["mcp:read", "mcp:write", "mcp:approve"]),
  operator: new Set(["mcp:read", "mcp:write"]),
  viewer: new Set(["mcp:read"]),
};

export type McpLocalRole = "reviewer" | "operator" | "viewer";
export type McpLocalScope = "mcp:read" | "mcp:write" | "mcp:approve";
export const MCP_LOCAL_ROLE_SCOPES = ROLE_SCOPES;

export interface McpLocalIdentityLabel {
  readonly name: string;
  readonly workspaceId: string;
  readonly role: McpLocalRole;
  readonly scopes: readonly McpLocalScope[];
}

export interface WriteMcpLocalClientConfigOptions {
  readonly outputPath: string;
  readonly resource: string;
  readonly caPath: string;
  readonly tokenFilePath: string;
  readonly identities: readonly McpLocalIdentityLabel[];
}

export interface McpLocalClientConfig {
  readonly resource: string;
  readonly transport: "streamable-http";
  readonly legacyTransport: "http";
  readonly caPath: string;
  readonly tokenFilePath: string;
  readonly identities: readonly McpLocalIdentityLabel[];
  readonly redacted: true;
}

export interface InspectorCommandOptions {
  readonly forwarderUrl: string;
  readonly method: "tools/list";
}

/** Validate and atomically write a non-secret local client configuration. */
export async function writeMcpLocalClientConfig(
  options: WriteMcpLocalClientConfigOptions,
): Promise<McpLocalClientConfig> {
  const resource = canonicalResource(options.resource);
  const caPath = pathReference(options.caPath, "caPath");
  const tokenFilePath = pathReference(options.tokenFilePath, "tokenFilePath");
  const identities = validateIdentities(options.identities);
  const config: McpLocalClientConfig = {
    resource,
    transport: "streamable-http",
    legacyTransport: "http",
    caPath,
    tokenFilePath,
    identities,
    redacted: true,
  };
  const outputPath = resolve(options.outputPath);
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const payload = `${JSON.stringify(config, null, 2)}\n`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, outputPath);
    await chmod(outputPath, 0o600);
    return config;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

/** Build the pinned Inspector command; credentials stay in the forwarder. */
export function buildMcpLocalInspectorCommand(options: InspectorCommandOptions): string[] {
  const forwarder = canonicalForwarderUrl(options.forwarderUrl);
  if (options.method !== "tools/list") throw new Error("Inspector method is unsupported");
  return [
    "npx",
    "--yes",
    `@modelcontextprotocol/inspector@${MCP_INSPECTOR_VERSION}`,
    "--cli",
    forwarder,
    "--transport",
    "http",
    "--method",
    options.method,
  ];
}

function canonicalResource(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("resource must be a canonical HTTPS /mcp URL"); }
  if (parsed.protocol !== "https:" || parsed.pathname !== "/mcp" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("resource must be a canonical HTTPS /mcp URL");
  }
  return parsed.href;
}

function canonicalForwarderUrl(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("Inspector forwarder URL is invalid"); }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/mcp" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Inspector forwarder must be loopback HTTP /mcp");
  }
  return parsed.href;
}

function pathReference(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_REFERENCE_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} must be a bounded path reference`);
  }
  return value;
}

function validateIdentities(values: readonly McpLocalIdentityLabel[]): readonly McpLocalIdentityLabel[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_IDENTITIES) {
    throw new Error("identities must contain 1-12 labels");
  }
  const names = new Set<string>();
  return values.map((identity, index) => {
    if (!identity || typeof identity !== "object" || Array.isArray(identity)) throw new Error(`identity ${index} is invalid`);
    const name = boundedName(identity?.name, `identity ${index} name`);
    if (names.has(name)) throw new Error(`identity ${name} is duplicated`);
    names.add(name);
    if (typeof identity.workspaceId !== "string" || !UUID.test(identity.workspaceId)) throw new Error(`identity ${name} workspaceId is invalid`);
    if (typeof identity.role !== "string" || !ROLES.has(identity.role as McpLocalRole)) throw new Error(`identity ${name} role is invalid`);
    const scopes: readonly unknown[] = Array.isArray(identity.scopes) ? identity.scopes : [];
    if (scopes.length < 1 || scopes.length > SCOPES.size) throw new Error(`identity ${name} scopes are invalid`);
    if (new Set(scopes).size !== scopes.length || scopes.some((scope) => typeof scope !== "string" || !SCOPES.has(scope as McpLocalScope))) throw new Error(`identity ${name} scopes are invalid`);
    const role = identity.role as McpLocalRole;
    const validatedScopes = scopes as readonly McpLocalScope[];
    if (!validatedScopes.includes("mcp:read") || validatedScopes.some((scope) => !ROLE_SCOPES[role].has(scope))) throw new Error(`identity ${name} scopes are invalid for role`);
    return {
      name,
      workspaceId: identity.workspaceId,
      role,
      scopes: [...validatedScopes],
    };
  });
}

function boundedName(value: unknown, label: string): string {
  if (typeof value !== "string" || !NAME.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function parseIdentityLabels(raw: string): readonly McpLocalIdentityLabel[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { throw new Error("MCP_LOCAL_IDENTITIES_JSON must be valid JSON"); }
  if (!Array.isArray(parsed)) throw new Error("MCP_LOCAL_IDENTITIES_JSON must be an array");
  return parsed.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`identity ${index} is invalid`);
    const record = value as Record<string, unknown>;
    return {
      name: record.name as string,
      workspaceId: record.workspaceId as string,
      role: record.role as McpLocalRole,
      scopes: record.scopes as McpLocalScope[],
    };
  });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (import.meta.main) {
  const config = await writeMcpLocalClientConfig({
    outputPath: requiredEnvironment("MCP_LOCAL_CLIENT_CONFIG_PATH"),
    resource: requiredEnvironment("MCP_LOCAL_RESOURCE"),
    caPath: requiredEnvironment("MCP_LOCAL_CA_CERT"),
    tokenFilePath: requiredEnvironment("MCP_LOCAL_TOKEN_FILE"),
    identities: parseIdentityLabels(requiredEnvironment("MCP_LOCAL_IDENTITIES_JSON")),
  });
  console.log(`MCP local client config written: ${config.resource}`);
}
