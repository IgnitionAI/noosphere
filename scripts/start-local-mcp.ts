import { stat } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";

const MAX_SUBPROCESS_OUTPUT = 64 * 1024;
const LOCAL_HTTP_PORT = 18080;
const LOCAL_HTTPS_PORT = 18443;
const LOCAL_HOST = "127.0.0.1";
const LOCAL_RESOURCE_HOST = "mcp.localhost";
const COMMAND_TIMEOUT_MS = 30_000;
// Cold image builds and first-time Compose health checks may legitimately take
// several minutes. Keep both phases bounded while leaving preflight/readiness
// checks on the short command timeout.
const COLD_BUILD_TIMEOUT_MS = 10 * 60_000;
const COMPOSE_START_TIMEOUT_MS = 10 * 60_000;
const SAFE_CHILD_ENV_KEYS = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM"] as const;
const SAFE_COMMAND_ENV_KEYS = new Set(["APP_ENV_FILE", "MCP_LOCAL_HTTP_PORT", "MCP_LOCAL_HTTPS_PORT"]);
const COMPOSE_FILES = [
  "-f", "compose.infrastructure.yml",
  "-f", "compose.production.yml",
  "-f", "compose.mcp-local.yml",
] as const;

interface LocalMcpCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes?: number;
  readonly stderrBytes?: number;
}

export interface LocalMcpRunOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

type LocalMcpCommand = (argv: readonly string[], options?: LocalMcpRunOptions) => Promise<LocalMcpCommandResult>;

interface BoundedStreamResult {
  readonly text: string;
  readonly bytes: number;
}

async function readBoundedStream(stream: ReadableStream<Uint8Array>): Promise<BoundedStreamResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_SUBPROCESS_OUTPUT) {
        throw new McpLocalStartupError("MCP_LOCAL_OUTPUT_TOO_LARGE");
      }
      chunks.push(decoder.decode(next.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return { text: chunks.join(""), bytes: size };
  } finally {
    reader.releaseLock();
  }
}

async function runLocalMcpCommandInternal(
  argv: readonly string[],
  options: LocalMcpRunOptions = {},
): Promise<LocalMcpCommandResult> {
  const env: Record<string, string> = {};
  for (const key of SAFE_CHILD_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (!SAFE_COMMAND_ENV_KEYS.has(key)) throw new McpLocalStartupError("MCP_LOCAL_ENV_UNSAFE");
    env[key] = value;
  }
  const child = Bun.spawn([...argv], {
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const output = Promise.all([
    readBoundedStream(child.stdout),
    readBoundedStream(child.stderr),
    child.exited,
  ]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      child.kill();
      reject(new McpLocalStartupError("MCP_LOCAL_COMMAND_TIMEOUT"));
    }, options.timeoutMs ?? COMMAND_TIMEOUT_MS);
  });
  try {
    const [stdout, stderr, exitCode] = await Promise.race([output, timeout]);
    return {
      exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutBytes: stdout.bytes,
      stderrBytes: stderr.bytes,
    };
  } catch (error) {
    child.kill();
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface LocalMcpCommandSummary {
  readonly exitCode: number;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
}

export async function runLocalMcpCommand(
  argv: readonly string[],
  options: LocalMcpRunOptions = {},
): Promise<LocalMcpCommandSummary> {
  const result = await runLocalMcpCommandInternal(argv, options);
  return {
    exitCode: result.exitCode,
    stdoutBytes: result.stdoutBytes ?? new TextEncoder().encode(result.stdout).byteLength,
    stderrBytes: result.stderrBytes ?? new TextEncoder().encode(result.stderr).byteLength,
  };
}

export interface LocalMcpStartOptions {
  readonly envFilePath: string;
  readonly projectName: string;
  readonly httpPort: number;
  readonly httpsPort: number;
  readonly caCertificatePath?: string;
  /** Explicit disposable local integration database; never logged or returned. */
  readonly testDatabaseUrl?: string;
  readonly probePort?: (port: number) => Promise<boolean> | boolean;
  readonly commandTimeoutMs?: number;
  /** Private test seam; raw command results are not part of the public API. */
  readonly run?: unknown;
}

export interface LocalMcpReady {
  readonly projectName: string;
  readonly resource: string;
  readonly publishedPorts: readonly string[];
  readonly workerCount: 1;
  readonly correlationId: string;
}

export interface LocalMcpServiceStatus {
  readonly name: string;
  readonly state: "running" | "exited" | "missing" | "unknown";
  readonly health: "healthy" | "unhealthy" | "unknown";
}

export interface LocalMcpStatus {
  readonly projectName: string;
  readonly resource: string;
  readonly publishedPorts: readonly string[];
  readonly services: readonly LocalMcpServiceStatus[];
  readonly workerCount: number;
  readonly correlationId: string;
  readonly redacted: true;
}

export interface LocalMcpStopOptions {
  readonly envFilePath: string;
  readonly projectName: string;
  readonly cleanup?: () => Promise<void> | void;
  readonly commandTimeoutMs?: number;
  /** Private test seam; raw command results are not part of the public API. */
  readonly run?: unknown;
}

export interface LocalMcpInspectOptions {
  readonly envFilePath: string;
  readonly projectName: string;
  readonly httpPort?: number;
  readonly httpsPort?: number;
  readonly commandTimeoutMs?: number;
  /** Private test seam; raw command results are not part of the public API. */
  readonly run?: unknown;
}

export class McpLocalStartupError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "McpLocalStartupError";
    this.code = code;
  }
}

function fail(code: string): never {
  throw new McpLocalStartupError(code);
}

function resolveCommandRunner(candidate: unknown): LocalMcpCommand {
  if (candidate === undefined) return runLocalMcpCommandInternal;
  if (typeof candidate !== "function") fail("MCP_LOCAL_RUNNER_INVALID");
  return candidate as LocalMcpCommand;
}

function boundedOutput(result: LocalMcpCommandResult): string {
  if (result.stdout.length > MAX_SUBPROCESS_OUTPUT || result.stderr.length > MAX_SUBPROCESS_OUTPUT) {
    fail("MCP_LOCAL_OUTPUT_TOO_LARGE");
  }
  return result.stdout;
}

async function validatePrivateEnvFile(path: string): Promise<Readonly<Record<string, string>>> {
  let details;
  try {
    details = await stat(path);
  } catch {
    fail("MCP_LOCAL_ENV_MISSING");
  }
  if (!details!.isFile()) fail("MCP_LOCAL_ENV_INVALID");
  if ((details!.mode & 0o777) !== 0o600) fail("MCP_LOCAL_ENV_INSECURE");
  let contents: string;
  try {
    contents = await Bun.file(path).text();
  } catch {
    fail("MCP_LOCAL_ENV_INVALID");
  }
  const values: Record<string, string> = {};
  for (const line of contents!.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    const key = match?.[1];
    const rawValue = match?.[2];
    if (key === undefined || rawValue === undefined || values[key] !== undefined) fail("MCP_LOCAL_ENV_INVALID");
    let value = rawValue;
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function decodeUrlPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    fail("MCP_LOCAL_DATABASE_UNSAFE");
  }
}

function validateTestDatabaseUrl(databaseUrl: string, privateEnv: Readonly<Record<string, string>>): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail("MCP_LOCAL_DATABASE_UNSAFE");
  }
  const hostname = parsed!.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!['postgres:', 'postgresql:'].includes(parsed!.protocol) || !['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    fail("MCP_LOCAL_DATABASE_UNSAFE");
  }
  if (parsed!.search || parsed!.hash || !parsed!.username || !parsed!.password) fail("MCP_LOCAL_DATABASE_UNSAFE");
  const expectedUser = privateEnv.POSTGRES_USER;
  const expectedPassword = privateEnv.POSTGRES_PASSWORD;
  const expectedDatabase = privateEnv.POSTGRES_DB;
  if (!expectedUser || !expectedPassword || !expectedDatabase) fail("MCP_LOCAL_DATABASE_MISMATCH");
  if (decodeUrlPart(parsed!.username) !== expectedUser || decodeUrlPart(parsed!.password) !== expectedPassword) {
    fail("MCP_LOCAL_DATABASE_MISMATCH");
  }
  const databaseName = decodeUrlPart(parsed!.pathname.replace(/^\//, ""));
  const escapedExpectedDatabase = expectedDatabase.replace(/[.*+?^${}()|[\[\]\\]/g, "\\$&");
  const acceptedDatabase = new RegExp(`^${escapedExpectedDatabase}(?:[-_][a-z0-9][a-z0-9-]*)?$`);
  if (!/^noosphere_mcp_local(?:[-_][a-z0-9][a-z0-9-]*)?$/.test(expectedDatabase) || !acceptedDatabase.test(databaseName)) {
    fail("MCP_LOCAL_DATABASE_UNSAFE");
  }
}

function validateProjectName(projectName: string): void {
  if (!/^noosphere-mcp-local(?:-[a-z0-9][a-z0-9-]{0,31})?$/.test(projectName)) {
    fail("MCP_LOCAL_PROJECT_INVALID");
  }
}

function validatePorts(httpPort: number, httpsPort: number): void {
  for (const port of [httpPort, httpsPort]) {
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) fail("MCP_LOCAL_PORT_INVALID");
  }
  if (httpPort === httpsPort) fail("MCP_LOCAL_PORT_INVALID");
}

function composeBase(envFilePath: string, projectName: string): string[] {
  return ["docker", "compose", "--env-file", envFilePath, "-p", projectName, ...COMPOSE_FILES];
}

function parseComposeConfig(stdout: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    fail("MCP_LOCAL_COMPOSE_CONFIG");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("MCP_LOCAL_COMPOSE_CONFIG");
  return parsed as Record<string, unknown>;
}

function numericPort(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

function assertSafePublishedPorts(stdout: string, httpPort: number, httpsPort: number): void {
  const parsed = parseComposeConfig(stdout);
  const services = parsed.services;
  if (!services || typeof services !== "object" || Array.isArray(services)) fail("MCP_LOCAL_UNSAFE_PORTS");
  let proxyPorts: Array<{ published: number; target: number }> = [];
  for (const [name, service] of Object.entries(services as Record<string, unknown>)) {
    if (!service || typeof service !== "object" || Array.isArray(service)) fail("MCP_LOCAL_UNSAFE_PORTS");
    if (!("ports" in service)) continue;
    const ports = (service as { ports?: unknown }).ports;
    if (!Array.isArray(ports)) fail("MCP_LOCAL_UNSAFE_PORTS");
    if (ports.length === 0) continue;
    if (name !== "proxy" || ports.length !== 2) fail("MCP_LOCAL_UNSAFE_PORTS");
    proxyPorts = ports.map((port): { published: number; target: number } => {
      if (!port || typeof port !== "object" || Array.isArray(port)) fail("MCP_LOCAL_UNSAFE_PORTS");
      const value = port as { host_ip?: unknown; published?: unknown; target?: unknown; protocol?: unknown };
      const published = numericPort(value.published);
      const target = numericPort(value.target);
      if (value.host_ip !== LOCAL_HOST || value.protocol !== "tcp" || published === null || target === null) {
        fail("MCP_LOCAL_UNSAFE_PORTS");
      }
      return { published, target };
    });
  }
  const expected = new Set([`${httpPort}:80`, `${httpsPort}:443`]);
  if (proxyPorts.length !== 2 || new Set(proxyPorts.map(({ published, target }) => `${published}:${target}`)).size !== 2) {
    fail("MCP_LOCAL_UNSAFE_PORTS");
  }
  for (const port of proxyPorts) {
    if (!expected.has(`${port.published}:${port.target}`)) fail("MCP_LOCAL_UNSAFE_PORTS");
  }
}

function expectedComposeFiles(): readonly string[] {
  return COMPOSE_FILES.filter((file) => file === "-f" ? false : true).map((file) => resolve(process.cwd(), file));
}

function parseConfigFiles(value: unknown): string[] {
  if (typeof value === "string") return value.split(/[\n,]/).map((part) => part.trim()).filter(Boolean);
  if (Array.isArray(value) && value.every((part) => typeof part === "string")) return value as string[];
  fail("MCP_LOCAL_PROJECT_UNSAFE");
}

async function preflightProjectOwnership(
  run: LocalMcpCommand,
  base: readonly string[],
  projectName: string,
  timeoutMs?: number,
  env?: Readonly<Record<string, string>>,
): Promise<void> {
  const stdout = await runChecked(run, [...base, "ls", "--format", "json"], "MCP_LOCAL_PROJECT_PREFLIGHT_FAILED", env, timeoutMs);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    fail("MCP_LOCAL_PROJECT_PREFLIGHT_FAILED");
  }
  if (!Array.isArray(parsed)) fail("MCP_LOCAL_PROJECT_PREFLIGHT_FAILED");
  const project = parsed.find((entry) => entry && typeof entry === "object" && (entry as { Name?: unknown }).Name === projectName);
  if (!project) return;
  const configFiles = parseConfigFiles((project as { ConfigFiles?: unknown }).ConfigFiles);
  const actual = configFiles.map((file) => resolve(file)).sort();
  const expected = [...expectedComposeFiles()].sort();
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) {
    fail("MCP_LOCAL_PROJECT_UNSAFE");
  }
  const idsOutput = await runChecked(
    run,
    ["docker", "ps", "-aq", "--filter", `label=com.docker.compose.project=${projectName}`],
    "MCP_LOCAL_PROJECT_PREFLIGHT_FAILED",
    env,
    timeoutMs,
  );
  const ids = idsOutput.split(/\s+/).filter(Boolean);
  if (ids.some((id) => !/^[0-9a-f]{12,64}$/.test(id)) || ids.length === 0) fail("MCP_LOCAL_PROJECT_UNSAFE");
  const labelsOutput = await runChecked(
    run,
    ["docker", "inspect", "--format", "{{json .Config.Labels}}", ...ids],
    "MCP_LOCAL_PROJECT_PREFLIGHT_FAILED",
    env,
    timeoutMs,
  );
  const labels = labelsOutput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const expectedServices = new Set([
    "api", "crawler", "database", "decision-worker", "memory-worker", "migrate", "minio", "minio-init",
    "proxy", "searxng", "setter-worker", "tei-embedding", "tei-reranker", "web", "worker",
  ]);
  if (labels.length !== ids.length) fail("MCP_LOCAL_PROJECT_UNSAFE");
  for (const line of labels) {
    let parsedLabels: unknown;
    try {
      parsedLabels = JSON.parse(line);
    } catch {
      fail("MCP_LOCAL_PROJECT_UNSAFE");
    }
    if (!parsedLabels || typeof parsedLabels !== "object" || Array.isArray(parsedLabels)) fail("MCP_LOCAL_PROJECT_UNSAFE");
    const values = parsedLabels as Record<string, unknown>;
    if (values["com.docker.compose.project"] !== projectName || typeof values["com.docker.compose.service"] !== "string" || !expectedServices.has(values["com.docker.compose.service"])) {
      fail("MCP_LOCAL_PROJECT_UNSAFE");
    }
  }
}

async function runChecked(
  run: LocalMcpCommand,
  argv: string[],
  code: string,
  env?: Readonly<Record<string, string>>,
  timeoutMs = COMMAND_TIMEOUT_MS,
): Promise<string> {
  let result: LocalMcpCommandResult;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const context: LocalMcpRunOptions = env === undefined ? { timeoutMs } : { env, timeoutMs };
    const command = run(argv, context);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new McpLocalStartupError("MCP_LOCAL_COMMAND_TIMEOUT")), timeoutMs);
    });
    result = await Promise.race([command, timeout]);
  } catch (error) {
    if (error instanceof McpLocalStartupError) fail(error.code);
    fail(code);
  } finally {
    if (timer) clearTimeout(timer);
  }
  const stdout = boundedOutput(result!);
  if (result!.exitCode !== 0) fail(code);
  return stdout;
}

async function validateCommon(envFilePath: string, projectName: string): Promise<Readonly<Record<string, string>>> {
  const privateEnv = await validatePrivateEnvFile(envFilePath);
  validateProjectName(projectName);
  return privateEnv;
}

async function validateCaCertificate(path: string): Promise<void> {
  let details;
  try {
    details = await stat(path);
  } catch {
    fail("MCP_LOCAL_CA_MISSING");
  }
  if (!details!.isFile()) fail("MCP_LOCAL_CA_INVALID");
}

async function isPortAvailable(port: number): Promise<boolean> {
  const server = createServer();
  return new Promise((resolveAvailability) => {
    const finish = (available: boolean) => {
      server.removeAllListeners();
      resolveAvailability(available);
    };
    server.once("error", () => finish(false));
    server.listen(port, LOCAL_HOST, () => server.close(() => finish(true)));
  });
}

function composeEnvironment(envFilePath: string, httpPort: number, httpsPort: number): Readonly<Record<string, string>> {
  return {
    APP_ENV_FILE: envFilePath,
    MCP_LOCAL_HTTP_PORT: String(httpPort),
    MCP_LOCAL_HTTPS_PORT: String(httpsPort),
  };
}

function publishedPorts(httpPort: number, httpsPort: number): readonly string[] {
  return [`${LOCAL_HOST}:${httpPort}->80`, `${LOCAL_HOST}:${httpsPort}->443`];
}

export async function startLocalMcp(options: LocalMcpStartOptions): Promise<LocalMcpReady> {
  const privateEnv = await validateCommon(options.envFilePath, options.projectName);
  validatePorts(options.httpPort, options.httpsPort);
  if (!options.caCertificatePath) fail("MCP_LOCAL_CA_REQUIRED");
  const caCertificatePath = options.caCertificatePath;
  await validateCaCertificate(caCertificatePath);
  if (options.testDatabaseUrl !== undefined) validateTestDatabaseUrl(options.testDatabaseUrl, privateEnv);
  const run = resolveCommandRunner(options.run);
  const base = composeBase(options.envFilePath, options.projectName);
  const composeEnv = composeEnvironment(options.envFilePath, options.httpPort, options.httpsPort);
  await runChecked(run, ["bun", "--version"], "MCP_LOCAL_PREREQUISITE_FAILED", undefined, options.commandTimeoutMs);
  await runChecked(run, ["docker", "--version"], "MCP_LOCAL_PREREQUISITE_FAILED", undefined, options.commandTimeoutMs);
  await runChecked(run, ["docker", "compose", "version"], "MCP_LOCAL_PREREQUISITE_FAILED", undefined, options.commandTimeoutMs);
  await preflightProjectOwnership(run, base, options.projectName, options.commandTimeoutMs, composeEnv);
  const config = await runChecked(run, [...base, "config", "--format", "json"], "MCP_LOCAL_COMPOSE_CONFIG", composeEnv, options.commandTimeoutMs);
  assertSafePublishedPorts(config, options.httpPort, options.httpsPort);
  const probePort = options.probePort ?? isPortAvailable;
  for (const port of [options.httpPort, options.httpsPort]) {
    if (!(await probePort(port))) fail("MCP_LOCAL_PORT_OCCUPIED");
  }
  await runChecked(run, [...base, "build", "api", "web", "worker"], "MCP_LOCAL_BUILD_FAILED", composeEnv, options.commandTimeoutMs ?? COLD_BUILD_TIMEOUT_MS);
  await runChecked(run, [...base, "up", "-d", "--wait", "database", "minio", "searxng", "crawler", "migrate", "api", "web", "proxy", "worker"], "MCP_LOCAL_COMPOSE_START_FAILED", composeEnv, options.commandTimeoutMs ?? COMPOSE_START_TIMEOUT_MS);
  const healthUrl = `https://${LOCAL_RESOURCE_HOST}:${options.httpsPort}/health/ready`;
  await runChecked(run, ["curl", "--fail", "--silent", "--show-error", "--max-time", "10", "--cacert", caCertificatePath, healthUrl], "MCP_LOCAL_HEALTH_FAILED", undefined, options.commandTimeoutMs);
  return {
    projectName: options.projectName,
    resource: `https://${LOCAL_RESOURCE_HOST}:${options.httpsPort}/mcp`,
    publishedPorts: publishedPorts(options.httpPort, options.httpsPort),
    workerCount: 1,
    correlationId: crypto.randomUUID(),
  };
}

export async function stopLocalMcp(options: LocalMcpStopOptions): Promise<void> {
  const privateEnv = await validateCommon(options.envFilePath, options.projectName);
  const httpPort = Number(privateEnv.MCP_LOCAL_HTTP_PORT ?? LOCAL_HTTP_PORT);
  const httpsPort = Number(privateEnv.MCP_LOCAL_HTTPS_PORT ?? LOCAL_HTTPS_PORT);
  validatePorts(httpPort, httpsPort);
  const run = resolveCommandRunner(options.run);
  const base = composeBase(options.envFilePath, options.projectName);
  const composeEnv = composeEnvironment(options.envFilePath, httpPort, httpsPort);
  await preflightProjectOwnership(run, base, options.projectName, options.commandTimeoutMs, composeEnv);
  if (options.cleanup) {
    try {
      await options.cleanup();
    } catch {
      fail("MCP_LOCAL_CLEANUP_FAILED");
    }
  }
  await runChecked(run, [...base, "stop"], "MCP_LOCAL_STOP_FAILED", composeEnv, options.commandTimeoutMs);
  await runChecked(run, [...base, "rm", "--force"], "MCP_LOCAL_STOP_FAILED", composeEnv, options.commandTimeoutMs);
}

function parseServiceStatus(stdout: string): readonly LocalMcpServiceStatus[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return ["proxy", "worker"].map((name) => ({ name, state: stdout.includes(name) ? "running" : "missing", health: "unknown" }));
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.slice(0, 32).flatMap((row): LocalMcpServiceStatus[] => {
    if (!row || typeof row !== "object") return [];
    const value = row as { Service?: unknown; State?: unknown; Health?: unknown };
    const name = typeof value.Service === "string" && value.Service.length <= 80 ? value.Service : "unknown";
    const state = value.State === "running" ? "running" : value.State === "exited" ? "exited" : value.State ? "unknown" : "missing";
    const health = value.Health === "healthy" ? "healthy" : value.Health === "unhealthy" ? "unhealthy" : "unknown";
    return [{ name, state, health }];
  });
}

export async function inspectLocalMcp(options: LocalMcpInspectOptions): Promise<LocalMcpStatus> {
  await validateCommon(options.envFilePath, options.projectName);
  const run = resolveCommandRunner(options.run);
  const httpPort = options.httpPort ?? LOCAL_HTTP_PORT;
  const httpsPort = options.httpsPort ?? LOCAL_HTTPS_PORT;
  validatePorts(httpPort, httpsPort);
  const base = composeBase(options.envFilePath, options.projectName);
  const composeEnv = composeEnvironment(options.envFilePath, httpPort, httpsPort);
  await preflightProjectOwnership(run, base, options.projectName, options.commandTimeoutMs, composeEnv);
  const stdout = await runChecked(run, [...base, "ps", "--format", "json"], "MCP_LOCAL_STATUS_FAILED", composeEnv, options.commandTimeoutMs);
  const services = parseServiceStatus(stdout);
  const workerCount = services.filter((service) => service.name === "worker" && service.state === "running").length;
  return {
    projectName: options.projectName,
    resource: `https://${LOCAL_RESOURCE_HOST}:${httpsPort}/mcp`,
    publishedPorts: publishedPorts(httpPort, httpsPort),
    services,
    workerCount,
    correlationId: crypto.randomUUID(),
    redacted: true,
  };
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "start";
  const envFilePath = process.env.MCP_LOCAL_ENV_FILE ?? ".env.mcp-local";
  const projectName = process.env.MCP_LOCAL_COMPOSE_PROJECT ?? "noosphere-mcp-local";
  if (command === "stop") {
    await stopLocalMcp({ envFilePath, projectName });
    return;
  }
  if (command === "status") {
    const privateEnv = await validatePrivateEnvFile(envFilePath);
    const status = await inspectLocalMcp({
      envFilePath,
      projectName,
      httpPort: Number(privateEnv.MCP_LOCAL_HTTP_PORT ?? LOCAL_HTTP_PORT),
      httpsPort: Number(privateEnv.MCP_LOCAL_HTTPS_PORT ?? LOCAL_HTTPS_PORT),
    });
    console.info(JSON.stringify(status));
    return;
  }
  const privateEnv = await validatePrivateEnvFile(envFilePath);
  const startOptions = {
    envFilePath,
    projectName,
    httpPort: Number(privateEnv.MCP_LOCAL_HTTP_PORT ?? LOCAL_HTTP_PORT),
    httpsPort: Number(privateEnv.MCP_LOCAL_HTTPS_PORT ?? LOCAL_HTTPS_PORT),
    ...(process.env.MCP_LOCAL_CA_CERT === undefined ? {} : { caCertificatePath: process.env.MCP_LOCAL_CA_CERT }),
    ...(process.env.TEST_DATABASE_URL === undefined ? {} : { testDatabaseUrl: process.env.TEST_DATABASE_URL }),
  } satisfies LocalMcpStartOptions;
  const ready = await startLocalMcp(startOptions);
  console.info(JSON.stringify(ready));
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    const code = error instanceof McpLocalStartupError ? error.code : "MCP_LOCAL_START_FAILED";
    console.error(JSON.stringify({ code }));
    process.exitCode = 1;
  });
}
