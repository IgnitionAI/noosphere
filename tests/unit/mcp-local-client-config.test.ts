import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMcpLocalInspectorCommand,
  writeMcpLocalClientConfig,
} from "../../scripts/write-mcp-local-client-config";
import {
  buildMcpInspectorEnvironment,
  forwardMcpInspectorRequest,
  MCP_FORWARDER_STREAM_FAILED,
  MCP_INSPECTOR_CLEANUP_FAILED,
  redactMcpInspectorDiagnostic,
  runInspector,
  type McpInspectorChild,
  type McpInspectorRuntime,
  type McpProductionSmokeConfig,
  type McpSmokeIdentity,
} from "../../scripts/smoke-mcp-production";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const outputPaths: string[] = [];

afterEach(async () => {
  await Promise.all(outputPaths.splice(0).map(async (path) => rm(path, { recursive: true, force: true })));
});

async function temporaryOutput(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mcp-local-client-config-"));
  const path = join(directory, "client.json");
  outputPaths.push(directory);
  return path;
}

function fakeFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init)) as typeof fetch;
}

describe("MCP local client configuration", () => {
  test("writes a 0600 config with credential references but no bearer value", async () => {
    const outputPath = await temporaryOutput();
    await writeMcpLocalClientConfig({
      outputPath,
      resource: "https://mcp.localhost:18443/mcp",
      caPath: "/tmp/mcp-local-root.crt",
      tokenFilePath: "/tmp/mcp-local-secrets.env",
      identities: [{
        name: "reviewer-a",
        workspaceId,
        role: "reviewer",
        scopes: ["mcp:read", "mcp:write", "mcp:approve"],
      }],
    });
    const output = await readFile(outputPath, "utf8");
    const config = JSON.parse(output) as Record<string, unknown>;
    expect(config).toMatchObject({
      resource: "https://mcp.localhost:18443/mcp",
      transport: "streamable-http",
      legacyTransport: "http",
      caPath: "/tmp/mcp-local-root.crt",
      tokenFilePath: "/tmp/mcp-local-secrets.env",
      redacted: true,
    });
    expect(output).not.toContain("Authorization");
    expect(output).not.toContain("Bearer");
    expect(output).not.toContain("oauth-token");
    expect(config).not.toHaveProperty("token");
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
  });

  test("writes atomically and keeps modern and legacy transports explicit", async () => {
    const outputPath = await temporaryOutput();
    await writeMcpLocalClientConfig({
      outputPath,
      resource: "https://mcp.localhost:18443/mcp",
      caPath: "/private/ca.pem",
      tokenFilePath: "/private/token.env",
      identities: [{ name: "viewer-a", workspaceId, role: "viewer", scopes: ["mcp:read"] }],
    });
    expect(await readFile(outputPath, "utf8")).toContain('"transport": "streamable-http"');
    expect(await readFile(outputPath, "utf8")).toContain('"legacyTransport": "http"');
    await chmod(outputPath, 0o644);
    await writeMcpLocalClientConfig({
      outputPath,
      resource: "https://mcp.localhost:18443/mcp",
      caPath: "/private/ca.pem",
      tokenFilePath: "/private/token.env",
      identities: [{ name: "viewer-a", workspaceId, role: "viewer", scopes: ["mcp:read"] }],
    });
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
  });

  test("rejects non-canonical resources and invalid or unbounded identities", async () => {
    const outputPath = await temporaryOutput();
    const options = {
      outputPath,
      resource: "https://mcp.localhost:18443/mcp",
      caPath: "/private/ca.pem",
      tokenFilePath: "/private/token.env",
      identities: [{ name: "viewer-a", workspaceId, role: "viewer" as const, scopes: ["mcp:read" as const] }],
    };
    await expect(writeMcpLocalClientConfig({ ...options, resource: "http://mcp.localhost:18443/mcp" })).rejects.toThrow("resource");
    await expect(writeMcpLocalClientConfig({ ...options, resource: "https://mcp.localhost:18443/mcp?x=1" })).rejects.toThrow("resource");
    await expect(writeMcpLocalClientConfig({ ...options, identities: [{ ...options.identities[0]!, workspaceId: "not-a-uuid" }] })).rejects.toThrow("workspaceId");
    await expect(writeMcpLocalClientConfig({ ...options, identities: [{ ...options.identities[0]!, role: "owner" as never }] })).rejects.toThrow("role");
    await expect(writeMcpLocalClientConfig({ ...options, identities: Array.from({ length: 13 }, (_, index) => ({ ...options.identities[0]!, name: `viewer-${index}` })) })).rejects.toThrow("identities");
    await expect(writeMcpLocalClientConfig({
      ...options,
      identities: [options.identities[0]!, { ...options.identities[0]! }],
    })).rejects.toThrow("duplicated");
  });

  test("passes only the minimal non-secret Inspector environment allowlist", () => {
    const source = {
      PATH: "/usr/bin",
      HOME: "/tmp/inspector-home",
      TMPDIR: "/tmp",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      TERM: "dumb",
      DATABASE_URL: "postgres://secret",
      S3_ACCESS_KEY: "s3-secret",
      NPM_TOKEN: "npm-secret",
      MCP_LOCAL_TOKEN: "oauth-secret",
      AMBIENT_SECRET: "ambient-secret",
    };
    const environment = buildMcpInspectorEnvironment(source);
    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/inspector-home",
      TMPDIR: "/tmp",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      TERM: "dumb",
      MCP_AUTO_OPEN_ENABLED: "false",
    });
    const serialized = JSON.stringify(environment);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("oauth");
  });

  test("uses the pinned Inspector 0.16.3 command without credentials", () => {
    expect(buildMcpLocalInspectorCommand({
      forwarderUrl: "http://127.0.0.1:19090/mcp",
      method: "tools/list",
    })).toEqual([
      "npx", "--yes", "@modelcontextprotocol/inspector@0.16.3", "--cli",
      "http://127.0.0.1:19090/mcp", "--transport", "http", "--method", "tools/list",
    ]);
    expect(buildMcpLocalInspectorCommand({
      forwarderUrl: "http://127.0.0.1:19090/mcp",
      method: "tools/list",
    }).join(" ")).not.toMatch(/Authorization|Bearer|oauth-token/);
  });

  test("forwarder adds bearer only to the in-memory upstream request", async () => {
    let upstreamRequest: Request | undefined;
    const response = await forwardMcpInspectorRequest(
      new Request("http://127.0.0.1:19090/mcp", { method: "POST", body: "{}" }),
      {
        endpoint: new URL("https://mcp.localhost:18443/mcp"),
        token: "oauth-token-secret",
        fetchImpl: fakeFetch((url, init) => {
          upstreamRequest = new Request(url, init);
          return Response.json({ ok: true });
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(upstreamRequest?.headers.get("authorization")).toBe("Bearer oauth-token-secret");
    expect(upstreamRequest?.headers.get("host")).toBeNull();
    expect(JSON.stringify(await response.json())).not.toContain("oauth-token-secret");
    expect(redactMcpInspectorDiagnostic("Bearer oauth-token-secret", ["oauth-token-secret"]))
      .toBe("Bearer [REDACTED]");
  });

  test("maps an upstream stream error to a bounded code without leaking its message", async () => {
    let signal: AbortSignal | undefined;
    const response = await forwardMcpInspectorRequest(
      new Request("http://127.0.0.1:19090/mcp", { method: "GET" }),
      {
        endpoint: new URL("https://mcp.localhost:18443/mcp"),
        token: "oauth-token-secret",
        fetchImpl: fakeFetch((_url, init) => {
          signal = init?.signal ?? undefined;
          const body = new ReadableStream<Uint8Array>({
            pull(controller) { controller.error(new Error("upstream secret stack detail")); },
          });
          return new Response(body);
        }),
      },
    );
    let streamError: unknown;
    try {
      await response.body!.getReader().read();
    } catch (error) {
      streamError = error;
    }
    expect(streamError).toBeInstanceOf(Error);
    if (!(streamError instanceof Error)) throw new Error("expected bounded stream error");
    expect(streamError.message).toBe(MCP_FORWARDER_STREAM_FAILED);
    expect(String(streamError)).not.toContain("upstream secret stack detail");
    expect(signal?.aborted).toBe(true);
  });

  test("forwarder drops attacker-controlled credentials, proxy, workspace, and arbitrary headers", async () => {
    let upstreamRequest: Request | undefined;
    await forwardMcpInspectorRequest(
      new Request("http://127.0.0.1:19090/mcp", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "mcp-session-id": "session-1",
          cookie: "session=secret",
          "proxy-authorization": "Basic secret",
          "x-api-key": "attacker-key",
          "x-workspace-id": "foreign-workspace",
          "x-forwarded-for": "10.0.0.1",
          "x-arbitrary": "attacker-value",
          authorization: "Bearer attacker-token",
          origin: "https://attacker.invalid",
        },
        body: "{}",
      }),
      {
        endpoint: new URL("https://mcp.localhost:18443/mcp"),
        token: "oauth-token-secret",
        fetchImpl: fakeFetch((url, init) => {
          upstreamRequest = new Request(url, init);
          return Response.json({ ok: true });
        }),
      },
    );
    expect([...upstreamRequest!.headers.keys()].sort()).toEqual([
      "accept", "authorization", "content-type", "mcp-session-id", "origin",
    ]);
    expect(upstreamRequest!.headers.get("authorization")).toBe("Bearer oauth-token-secret");
    expect(upstreamRequest!.headers.get("origin")).toBe("https://mcp.localhost:18443");
    expect(upstreamRequest!.headers.get("cookie")).toBeNull();
    expect(upstreamRequest!.headers.get("x-workspace-id")).toBeNull();
    expect(upstreamRequest!.headers.get("x-forwarded-for")).toBeNull();
  });

  test("aborts an upstream fetch at the real forwarder deadline", async () => {
    let signal: AbortSignal | undefined;
    const response = await forwardMcpInspectorRequest(
      new Request("http://127.0.0.1:19090/mcp", { method: "GET" }),
      {
        endpoint: new URL("https://mcp.localhost:18443/mcp"),
        token: "oauth-token-secret",
        timeoutMs: 10,
        fetchImpl: fakeFetch((_url, init) => new Promise<Response>((_, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })),
      },
    );
    expect(response.status).toBe(502);
    expect(signal?.aborted).toBe(true);
  });

  test("returns at the deadline even when an injected fetch ignores abort", async () => {
    const response = await Promise.race([
      forwardMcpInspectorRequest(
        new Request("http://127.0.0.1:19090/mcp", { method: "GET" }),
        {
          endpoint: new URL("https://mcp.localhost:18443/mcp"),
          token: "oauth-token-secret",
          timeoutMs: 10,
          fetchImpl: fakeFetch(() => new Promise<Response>(() => undefined)),
        },
      ),
      new Promise<Response>((resolve) => setTimeout(() => resolve(new Response("test deadline", { status: 599 })), 100)),
    ]);
    expect(response.status).toBe(502);
  });

  test("caps streamed upstream response bytes and aborts the fetch", async () => {
    let signal: AbortSignal | undefined;
    const response = await forwardMcpInspectorRequest(
      new Request("http://127.0.0.1:19090/mcp", { method: "GET" }),
      {
        endpoint: new URL("https://mcp.localhost:18443/mcp"),
        token: "oauth-token-secret",
        fetchImpl: fakeFetch((_url, init) => {
          signal = init?.signal ?? undefined;
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(1_048_576));
              controller.enqueue(new Uint8Array([1]));
              controller.close();
            },
          });
          return new Response(body);
        }),
      },
    );
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(first.value?.byteLength).toBe(1_048_576);
    await expect(reader.read()).rejects.toThrow("MCP_RESPONSE_TOO_LARGE");
    expect(signal?.aborted).toBe(true);
  });

  test("errors instead of returning truncated EOF when the response stalls after a chunk", async () => {
    let signal: AbortSignal | undefined;
    const response = await forwardMcpInspectorRequest(
      new Request("http://127.0.0.1:19090/mcp", { method: "GET" }),
      {
        endpoint: new URL("https://mcp.localhost:18443/mcp"),
        token: "oauth-token-secret",
        timeoutMs: 10,
        fetchImpl: fakeFetch((_url, init) => {
          signal = init?.signal ?? undefined;
          const body = new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(new Uint8Array([1])); },
            pull: () => new Promise<void>(() => undefined),
          });
          return new Response(body);
        }),
      },
    );
    const reader = response.body!.getReader();
    expect((await reader.read()).value?.byteLength).toBe(1);
    await expect(reader.read()).rejects.toThrow("MCP_RESPONSE_DEADLINE_EXCEEDED");
    expect(signal?.aborted).toBe(true);
  });

  test("cancels the upstream response when the Inspector client closes", async () => {
    const requestController = new AbortController();
    let signal: AbortSignal | undefined;
    let upstreamCancelled = false;
    const response = await forwardMcpInspectorRequest(
      new Request("http://127.0.0.1:19090/mcp", { method: "GET", signal: requestController.signal }),
      {
        endpoint: new URL("https://mcp.localhost:18443/mcp"),
        token: "oauth-token-secret",
        fetchImpl: fakeFetch((_url, init) => {
          signal = init?.signal ?? undefined;
          const body = new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(new Uint8Array([1])); },
            cancel() { upstreamCancelled = true; },
          });
          return new Response(body);
        }),
      },
    );
    const reader = response.body!.getReader();
    await reader.read();
    requestController.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(signal?.aborted).toBe(true);
    expect(upstreamCancelled).toBe(true);
    await reader.cancel().catch(() => undefined);
  });

  test("stops the proxy and cleans the isolated HOME when Inspector spawn throws", async () => {
    let proxyStopped = false;
    let homePath: string | undefined;
    let homeMode: number | undefined;
    let homeEntries: string[] | undefined;
    let childOptions: Record<string, unknown> | undefined;
    const runtime: McpInspectorRuntime = {
      serve: () => ({ port: 19090, stop: () => { proxyStopped = true; } }),
      createHome: async () => {
        homePath = await mkdtemp(join(tmpdir(), "mcp-inspector-home-test-"));
        await chmod(homePath, 0o700);
        homeMode = (await stat(homePath)).mode & 0o777;
        homeEntries = await readdir(homePath);
        return homePath;
      },
      removeHome: async (path) => { await rm(path, { recursive: true, force: true }); },
      spawn: (_args, options) => {
        childOptions = options as unknown as Record<string, unknown>;
        throw new Error("injected spawn failure");
      },
    };
    const config: McpProductionSmokeConfig = {
      endpoint: new URL("https://mcp.localhost:18443/mcp"),
      resource: "https://mcp.localhost:18443/mcp",
      identities: [],
      foreignProposalId: "00000000-0000-4000-8000-000000000099",
      viewerProposalId: "00000000-0000-4000-8000-000000000098",
      revokedToken: "revoked-token-123",
      timeoutMs: 100,
      rateLimitProbe: false,
      inspectorEnabled: true,
    };
    const identity: McpSmokeIdentity = {
      name: "reviewer-a",
      token: "oauth-token-secret",
      workspaceId,
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    };
    await expect(runInspector(config, identity, runtime)).rejects.toThrow("injected spawn failure");
    expect(proxyStopped).toBe(true);
    const childEnvironment = childOptions?.env as Record<string, string> | undefined;
    expect(childEnvironment?.HOME).toBe(homePath);
    expect(childEnvironment?.NPM_CONFIG_USERCONFIG).toBe("/dev/null");
    expect(childEnvironment?.NPM_CONFIG_GLOBALCONFIG).toBe("/dev/null");
    expect(childOptions?.cwd).toBe(homePath);
    expect(childOptions?.detached).toBe(true);
    expect(childOptions?.killSignal).toBe("SIGTERM");
    expect(homeMode).toBe(0o700);
    expect(homeEntries).toEqual([]);
    await expect(stat(homePath!)).rejects.toThrow();
  });

  test("does not signal an already exited Inspector child", async () => {
    let childKilled = false;
    let proxyStopped = false;
    let homePath: string | undefined;
    const child: McpInspectorChild = {
      exited: Promise.resolve(0),
      kill: () => { childKilled = true; },
    };
    const runtime: McpInspectorRuntime = {
      serve: () => ({ port: 19090, stop: () => { proxyStopped = true; } }),
      createHome: async () => {
        homePath = await mkdtemp(join(tmpdir(), "mcp-inspector-home-test-"));
        await chmod(homePath, 0o700);
        return homePath;
      },
      removeHome: async (path) => { await rm(path, { recursive: true, force: true }); },
      spawn: () => child,
    };
    const config: McpProductionSmokeConfig = {
      endpoint: new URL("https://mcp.localhost:18443/mcp"),
      resource: "https://mcp.localhost:18443/mcp",
      identities: [],
      foreignProposalId: "00000000-0000-4000-8000-000000000099",
      viewerProposalId: "00000000-0000-4000-8000-000000000098",
      revokedToken: "revoked-token-123",
      timeoutMs: 100,
      rateLimitProbe: false,
      inspectorEnabled: true,
    };
    const identity: McpSmokeIdentity = {
      name: "reviewer-a",
      token: "oauth-token-secret",
      workspaceId,
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    };
    await expect(runInspector(config, identity, runtime)).resolves.toBe("passed");
    expect(childKilled).toBe(false);
    expect(proxyStopped).toBe(true);
    await expect(stat(homePath!)).rejects.toThrow();
  });

  test("escalates pending children from scoped SIGTERM to scoped SIGKILL", async () => {
    let resolveExit!: (code: number) => void;
    const childSignals: string[] = [];
    const groupSignals: string[] = [];
    const child: McpInspectorChild = {
      pid: 4321,
      exited: new Promise((resolve) => { resolveExit = resolve; }),
      kill: () => { childSignals.push("child"); },
    };
    const runtime: McpInspectorRuntime = {
      serve: () => ({ port: 19090, stop: () => undefined }),
      createHome: async () => mkdtemp(join(tmpdir(), "mcp-inspector-home-test-")),
      removeHome: async (path) => { await rm(path, { recursive: true, force: true }); },
      spawn: () => child,
      childCleanupTimeoutMs: 10,
      isProcessGroupAlive: () => true,
      killProcessGroup: (pid, signal) => {
        expect(pid).toBe(4321);
        groupSignals.push(signal);
        if (signal === "SIGKILL") resolveExit(137);
      },
    };
    const config: McpProductionSmokeConfig = {
      endpoint: new URL("https://mcp.localhost:18443/mcp"),
      resource: "https://mcp.localhost:18443/mcp",
      identities: [],
      foreignProposalId: "00000000-0000-4000-8000-000000000099",
      viewerProposalId: "00000000-0000-4000-8000-000000000098",
      revokedToken: "revoked-token-123",
      timeoutMs: 10,
      rateLimitProbe: false,
      inspectorEnabled: true,
    };
    const identity: McpSmokeIdentity = {
      name: "reviewer-a",
      token: "oauth-token-secret",
      workspaceId,
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    };
    await expect(runInspector(config, identity, runtime)).rejects.toThrow("MCP Inspector smoke");
    expect(childSignals).toEqual(["child"]);
    expect(groupSignals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("never signals a process group for pid 1", async () => {
    const groupSignals: string[] = [];
    const child: McpInspectorChild = {
      pid: 1,
      exited: Promise.resolve(0),
      kill: () => undefined,
    };
    const runtime: McpInspectorRuntime = {
      serve: () => ({ port: 19090, stop: () => undefined }),
      createHome: async () => mkdtemp(join(tmpdir(), "mcp-inspector-home-test-")),
      removeHome: async (path) => { await rm(path, { recursive: true, force: true }); },
      spawn: () => child,
      isProcessGroupAlive: () => false,
      killProcessGroup: (_pid, signal) => { groupSignals.push(signal); },
    };
    const config: McpProductionSmokeConfig = {
      endpoint: new URL("https://mcp.localhost:18443/mcp"),
      resource: "https://mcp.localhost:18443/mcp",
      identities: [],
      foreignProposalId: "00000000-0000-4000-8000-000000000099",
      viewerProposalId: "00000000-0000-4000-8000-000000000098",
      revokedToken: "revoked-token-123",
      timeoutMs: 100,
      rateLimitProbe: false,
      inspectorEnabled: true,
    };
    const identity: McpSmokeIdentity = {
      name: "reviewer-a",
      token: "oauth-token-secret",
      workspaceId,
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    };
    await expect(runInspector(config, identity, runtime)).resolves.toBe("passed");
    expect(groupSignals).toEqual([]);
  });

  test("does not signal or kill an already exited detached child", async () => {
    const groupSignals: string[] = [];
    let childKilled = false;
    const child: McpInspectorChild = {
      pid: 4323,
      exited: Promise.resolve(0),
      kill: () => { childKilled = true; },
    };
    const runtime: McpInspectorRuntime = {
      serve: () => ({ port: 19090, stop: () => undefined }),
      createHome: async () => mkdtemp(join(tmpdir(), "mcp-inspector-home-test-")),
      removeHome: async (path) => { await rm(path, { recursive: true, force: true }); },
      spawn: () => child,
      isProcessGroupAlive: () => false,
      killProcessGroup: (_pid, signal) => { groupSignals.push(signal); },
    };
    const config: McpProductionSmokeConfig = {
      endpoint: new URL("https://mcp.localhost:18443/mcp"),
      resource: "https://mcp.localhost:18443/mcp",
      identities: [],
      foreignProposalId: "00000000-0000-4000-8000-000000000099",
      viewerProposalId: "00000000-0000-4000-8000-000000000098",
      revokedToken: "revoked-token-123",
      timeoutMs: 100,
      rateLimitProbe: false,
      inspectorEnabled: true,
    };
    const identity: McpSmokeIdentity = {
      name: "reviewer-a",
      token: "oauth-token-secret",
      workspaceId,
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    };
    await expect(runInspector(config, identity, runtime)).resolves.toBe("passed");
    expect(childKilled).toBe(false);
    expect(groupSignals).toEqual([]);
  });

  test("keeps group cleanup after direct child exit when descendants remain", async () => {
    const groupSignals: string[] = [];
    let resolveChildExit!: (code: number) => void;
    let groupAlive = true;
    let exitReads = 0;
    const child: McpInspectorChild = {
      pid: 4324,
      get exited() {
        exitReads += 1;
        return exitReads === 1
          ? Promise.resolve(0)
          : new Promise<number>((resolve) => { resolveChildExit = resolve; });
      },
      kill: () => { resolveChildExit?.(0); },
    };
    const runtime: McpInspectorRuntime = {
      serve: () => ({ port: 19090, stop: () => undefined }),
      createHome: async () => mkdtemp(join(tmpdir(), "mcp-inspector-home-test-")),
      removeHome: async (path) => { await rm(path, { recursive: true, force: true }); },
      spawn: () => child,
      childCleanupTimeoutMs: 10,
      isProcessGroupAlive: () => groupAlive,
      killProcessGroup: (_pid, signal) => {
        groupSignals.push(signal);
        if (signal === "SIGKILL") groupAlive = false;
      },
    };
    const config: McpProductionSmokeConfig = {
      endpoint: new URL("https://mcp.localhost:18443/mcp"),
      resource: "https://mcp.localhost:18443/mcp",
      identities: [],
      foreignProposalId: "00000000-0000-4000-8000-000000000099",
      viewerProposalId: "00000000-0000-4000-8000-000000000098",
      revokedToken: "revoked-token-123",
      timeoutMs: 100,
      rateLimitProbe: false,
      inspectorEnabled: true,
    };
    const identity: McpSmokeIdentity = {
      name: "reviewer-a",
      token: "oauth-token-secret",
      workspaceId,
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    };
    await expect(runInspector(config, identity, runtime)).resolves.toBe("passed");
    expect(groupSignals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(groupAlive).toBe(false);
  });

  test("stops group cleanup after a normal TERM group exit without KILL", async () => {
    const groupSignals: string[] = [];
    let resolveChildExit!: (code: number) => void;
    let groupAlive = true;
    let exitReads = 0;
    const child: McpInspectorChild = {
      pid: 4325,
      get exited() {
        exitReads += 1;
        return exitReads === 1
          ? Promise.resolve(0)
          : new Promise<number>((resolve) => { resolveChildExit = resolve; });
      },
      kill: () => undefined,
    };
    const runtime: McpInspectorRuntime = {
      serve: () => ({ port: 19090, stop: () => undefined }),
      createHome: async () => mkdtemp(join(tmpdir(), "mcp-inspector-home-test-")),
      removeHome: async (path) => { await rm(path, { recursive: true, force: true }); },
      spawn: () => child,
      childCleanupTimeoutMs: 10,
      isProcessGroupAlive: () => groupAlive,
      killProcessGroup: (_pid, signal) => {
        groupSignals.push(signal);
        if (signal === "SIGTERM") {
          groupAlive = false;
          resolveChildExit(0);
        }
      },
    };
    const config: McpProductionSmokeConfig = {
      endpoint: new URL("https://mcp.localhost:18443/mcp"),
      resource: "https://mcp.localhost:18443/mcp",
      identities: [],
      foreignProposalId: "00000000-0000-4000-8000-000000000099",
      viewerProposalId: "00000000-0000-4000-8000-000000000098",
      revokedToken: "revoked-token-123",
      timeoutMs: 100,
      rateLimitProbe: false,
      inspectorEnabled: true,
    };
    const identity: McpSmokeIdentity = {
      name: "reviewer-a",
      token: "oauth-token-secret",
      workspaceId,
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    };
    await expect(runInspector(config, identity, runtime)).resolves.toBe("passed");
    expect(groupSignals).toEqual(["SIGTERM"]);
    expect(groupAlive).toBe(false);
  });

  test("does not signal an already dead process group and completes cleanup", async () => {
    const groupSignals: string[] = [];
    let childKilled = false;
    const child: McpInspectorChild = {
      pid: 4326,
      exited: Promise.resolve(0),
      kill: () => { childKilled = true; },
    };
    const runtime: McpInspectorRuntime = {
      serve: () => ({ port: 19090, stop: () => undefined }),
      createHome: async () => mkdtemp(join(tmpdir(), "mcp-inspector-home-test-")),
      removeHome: async (path) => { await rm(path, { recursive: true, force: true }); },
      spawn: () => child,
      childCleanupTimeoutMs: 10,
      isProcessGroupAlive: () => false,
      killProcessGroup: (_pid, signal) => { groupSignals.push(signal); },
    };
    const config: McpProductionSmokeConfig = {
      endpoint: new URL("https://mcp.localhost:18443/mcp"),
      resource: "https://mcp.localhost:18443/mcp",
      identities: [],
      foreignProposalId: "00000000-0000-4000-8000-000000000099",
      viewerProposalId: "00000000-0000-4000-8000-000000000098",
      revokedToken: "revoked-token-123",
      timeoutMs: 100,
      rateLimitProbe: false,
      inspectorEnabled: true,
    };
    const identity: McpSmokeIdentity = {
      name: "reviewer-a",
      token: "oauth-token-secret",
      workspaceId,
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    };
    await expect(runInspector(config, identity, runtime)).resolves.toBe("passed");
    expect(childKilled).toBe(false);
    expect(groupSignals).toEqual([]);
  });

  test("cleans a live detached group even when child exited promise is already resolved", async () => {
    const groupSignals: string[] = [];
    let childKilled = false;
    let groupAlive = true;
    const child: McpInspectorChild = {
      pid: 4331,
      exited: Promise.resolve(0),
      kill: () => { childKilled = true; },
    };
    const runtime: McpInspectorRuntime = {
      serve: () => ({ port: 19090, stop: () => undefined }),
      createHome: async () => mkdtemp(join(tmpdir(), "mcp-inspector-home-test-")),
      removeHome: async (path) => { await rm(path, { recursive: true, force: true }); },
      spawn: () => child,
      childCleanupTimeoutMs: 10,
      isProcessGroupAlive: () => groupAlive,
      killProcessGroup: (_pid, signal) => {
        groupSignals.push(signal);
        if (signal === "SIGKILL") groupAlive = false;
      },
    };
    const config: McpProductionSmokeConfig = {
      endpoint: new URL("https://mcp.localhost:18443/mcp"),
      resource: "https://mcp.localhost:18443/mcp",
      identities: [],
      foreignProposalId: "00000000-0000-4000-8000-000000000099",
      viewerProposalId: "00000000-0000-4000-8000-000000000098",
      revokedToken: "revoked-token-123",
      timeoutMs: 100,
      rateLimitProbe: false,
      inspectorEnabled: true,
    };
    const identity: McpSmokeIdentity = {
      name: "reviewer-a",
      token: "oauth-token-secret",
      workspaceId,
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    };
    await expect(runInspector(config, identity, runtime)).resolves.toBe("passed");
    expect(childKilled).toBe(false);
    expect(groupSignals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(groupAlive).toBe(false);
  });

  test("rechecks group liveness before KILL and avoids KILL when it dies", async () => {
    const groupSignals: string[] = [];
    let groupAlive = true;
    let probes = 0;
    let exitReads = 0;
    const child: McpInspectorChild = {
      pid: 4327,
      get exited() {
        exitReads += 1;
        return exitReads === 1 ? Promise.resolve(0) : new Promise<number>(() => undefined);
      },
      kill: () => undefined,
    };
    const runtime: McpInspectorRuntime = {
      serve: () => ({ port: 19090, stop: () => undefined }),
      createHome: async () => mkdtemp(join(tmpdir(), "mcp-inspector-home-test-")),
      removeHome: async (path) => { await rm(path, { recursive: true, force: true }); },
      spawn: () => child,
      childCleanupTimeoutMs: 10,
      isProcessGroupAlive: () => {
        probes += 1;
        if (probes >= 3) groupAlive = false;
        return groupAlive;
      },
      killProcessGroup: (_pid, signal) => { groupSignals.push(signal); },
    };
    const config: McpProductionSmokeConfig = {
      endpoint: new URL("https://mcp.localhost:18443/mcp"),
      resource: "https://mcp.localhost:18443/mcp",
      identities: [],
      foreignProposalId: "00000000-0000-4000-8000-000000000099",
      viewerProposalId: "00000000-0000-4000-8000-000000000098",
      revokedToken: "revoked-token-123",
      timeoutMs: 100,
      rateLimitProbe: false,
      inspectorEnabled: true,
    };
    const identity: McpSmokeIdentity = {
      name: "reviewer-a",
      token: "oauth-token-secret",
      workspaceId,
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    };
    await expect(runInspector(config, identity, runtime)).resolves.toBe("passed");
    expect(groupSignals).toEqual(["SIGTERM"]);
  });

  test("returns bounded cleanup failure without signaling when group liveness probing throws", async () => {
    const groupSignals: string[] = [];
    let exitReads = 0;
    const child: McpInspectorChild = {
      pid: 4328,
      get exited() {
        exitReads += 1;
        return exitReads === 1 ? Promise.resolve(0) : new Promise<number>(() => undefined);
      },
      kill: () => undefined,
    };
    const runtime: McpInspectorRuntime = {
      serve: () => ({ port: 19090, stop: () => undefined }),
      createHome: async () => mkdtemp(join(tmpdir(), "mcp-inspector-home-test-")),
      removeHome: async (path) => { await rm(path, { recursive: true, force: true }); },
      spawn: () => child,
      childCleanupTimeoutMs: 10,
      isProcessGroupAlive: () => { throw new Error("probe path secret"); },
      killProcessGroup: (_pid, signal) => { groupSignals.push(signal); },
    };
    const config: McpProductionSmokeConfig = {
      endpoint: new URL("https://mcp.localhost:18443/mcp"),
      resource: "https://mcp.localhost:18443/mcp",
      identities: [],
      foreignProposalId: "00000000-0000-4000-8000-000000000099",
      viewerProposalId: "00000000-0000-4000-8000-000000000098",
      revokedToken: "revoked-token-123",
      timeoutMs: 100,
      rateLimitProbe: false,
      inspectorEnabled: true,
    };
    const identity: McpSmokeIdentity = {
      name: "reviewer-a",
      token: "oauth-token-secret",
      workspaceId,
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    };
    await expect(runInspector(config, identity, runtime)).rejects.toThrow(MCP_INSPECTOR_CLEANUP_FAILED);
    expect(groupSignals).toEqual([]);
  });

  test("does not KILL a process group after its child pid identity changes", async () => {
    const groupSignals: string[] = [];
    let currentPid = 4329;
    let groupAlive = true;
    let exitReads = 0;
    const child: McpInspectorChild = {
      get pid() { return currentPid; },
      get exited() {
        exitReads += 1;
        return exitReads === 1 ? Promise.resolve(0) : new Promise<number>(() => undefined);
      },
      kill: () => undefined,
    };
    const runtime: McpInspectorRuntime = {
      serve: () => ({ port: 19090, stop: () => undefined }),
      createHome: async () => mkdtemp(join(tmpdir(), "mcp-inspector-home-test-")),
      removeHome: async (path) => { await rm(path, { recursive: true, force: true }); },
      spawn: () => child,
      childCleanupTimeoutMs: 10,
      isProcessGroupAlive: () => groupAlive,
      killProcessGroup: (_pid, signal) => {
        groupSignals.push(signal);
        if (signal === "SIGTERM") currentPid = 4330;
      },
    };
    const config: McpProductionSmokeConfig = {
      endpoint: new URL("https://mcp.localhost:18443/mcp"),
      resource: "https://mcp.localhost:18443/mcp",
      identities: [],
      foreignProposalId: "00000000-0000-4000-8000-000000000099",
      viewerProposalId: "00000000-0000-4000-8000-000000000098",
      revokedToken: "revoked-token-123",
      timeoutMs: 100,
      rateLimitProbe: false,
      inspectorEnabled: true,
    };
    const identity: McpSmokeIdentity = {
      name: "reviewer-a",
      token: "oauth-token-secret",
      workspaceId,
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    };
    await expect(runInspector(config, identity, runtime)).rejects.toThrow(MCP_INSPECTOR_CLEANUP_FAILED);
    expect(groupSignals).toEqual(["SIGTERM"]);
  });

  test("returns bounded cleanup failure without broad signal for an invalid pid", async () => {
    const groupSignals: string[] = [];
    let exitReads = 0;
    const child: McpInspectorChild = {
      pid: 1,
      get exited() {
        exitReads += 1;
        return exitReads === 1 ? Promise.resolve(0) : new Promise<number>(() => undefined);
      },
      kill: () => undefined,
    };
    const runtime: McpInspectorRuntime = {
      serve: () => ({ port: 19090, stop: () => undefined }),
      createHome: async () => mkdtemp(join(tmpdir(), "mcp-inspector-home-test-")),
      removeHome: async (path) => { await rm(path, { recursive: true, force: true }); },
      spawn: () => child,
      childCleanupTimeoutMs: 10,
      isProcessGroupAlive: () => true,
      killProcessGroup: (_pid, signal) => { groupSignals.push(signal); },
    };
    const config: McpProductionSmokeConfig = {
      endpoint: new URL("https://mcp.localhost:18443/mcp"),
      resource: "https://mcp.localhost:18443/mcp",
      identities: [],
      foreignProposalId: "00000000-0000-4000-8000-000000000099",
      viewerProposalId: "00000000-0000-4000-8000-000000000098",
      revokedToken: "revoked-token-123",
      timeoutMs: 100,
      rateLimitProbe: false,
      inspectorEnabled: true,
    };
    const identity: McpSmokeIdentity = {
      name: "reviewer-a",
      token: "oauth-token-secret",
      workspaceId,
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    };
    await expect(runInspector(config, identity, runtime)).rejects.toThrow(MCP_INSPECTOR_CLEANUP_FAILED);
    expect(groupSignals).toEqual([]);
  });

  test("surfaces a bounded cleanup error when proxy stop fails", async () => {
    let homePath: string | undefined;
    const child: McpInspectorChild = { exited: Promise.resolve(0), kill: () => undefined };
    const runtime: McpInspectorRuntime = {
      serve: () => ({ port: 19090, stop: () => { throw new Error("proxy secret path"); } }),
      createHome: async () => {
        homePath = await mkdtemp(join(tmpdir(), "mcp-inspector-home-test-"));
        outputPaths.push(homePath);
        return homePath;
      },
      removeHome: async (path) => { await rm(path, { recursive: true, force: true }); },
      spawn: () => child,
    };
    const config: McpProductionSmokeConfig = {
      endpoint: new URL("https://mcp.localhost:18443/mcp"),
      resource: "https://mcp.localhost:18443/mcp",
      identities: [],
      foreignProposalId: "00000000-0000-4000-8000-000000000099",
      viewerProposalId: "00000000-0000-4000-8000-000000000098",
      revokedToken: "revoked-token-123",
      timeoutMs: 100,
      rateLimitProbe: false,
      inspectorEnabled: true,
    };
    const identity: McpSmokeIdentity = {
      name: "reviewer-a",
      token: "oauth-token-secret",
      workspaceId,
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    };
    await expect(runInspector(config, identity, runtime)).rejects.toThrow("MCP_INSPECTOR_CLEANUP_FAILED");
    await expect(stat(homePath!)).rejects.toThrow();
  });

  test("surfaces a bounded cleanup error when isolated HOME removal fails", async () => {
    let homePath: string | undefined;
    const child: McpInspectorChild = { exited: Promise.resolve(0), kill: () => undefined };
    const runtime: McpInspectorRuntime = {
      serve: () => ({ port: 19090, stop: () => undefined }),
      createHome: async () => {
        homePath = await mkdtemp(join(tmpdir(), "mcp-inspector-home-test-"));
        outputPaths.push(homePath);
        return homePath;
      },
      removeHome: async () => { throw new Error("home /secret/path"); },
      spawn: () => child,
    };
    const config: McpProductionSmokeConfig = {
      endpoint: new URL("https://mcp.localhost:18443/mcp"),
      resource: "https://mcp.localhost:18443/mcp",
      identities: [],
      foreignProposalId: "00000000-0000-4000-8000-000000000099",
      viewerProposalId: "00000000-0000-4000-8000-000000000098",
      revokedToken: "revoked-token-123",
      timeoutMs: 100,
      rateLimitProbe: false,
      inspectorEnabled: true,
    };
    const identity: McpSmokeIdentity = {
      name: "reviewer-a",
      token: "oauth-token-secret",
      workspaceId,
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    };
    const error = await runInspector(config, identity, runtime).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("MCP_INSPECTOR_CLEANUP_FAILED");
    expect((error as Error).message).not.toContain("secret");
    expect((error as Error).message).not.toContain(homePath!);
  });

  test("aggregates proxy and HOME cleanup failures without leaking details", async () => {
    let homePath: string | undefined;
    const child: McpInspectorChild = { exited: Promise.resolve(0), kill: () => undefined };
    const runtime: McpInspectorRuntime = {
      serve: () => ({ port: 19090, stop: () => { throw new Error("proxy detail"); } }),
      createHome: async () => {
        homePath = await mkdtemp(join(tmpdir(), "mcp-inspector-home-test-"));
        outputPaths.push(homePath);
        return homePath;
      },
      removeHome: async () => { throw new Error("home detail"); },
      spawn: () => child,
    };
    const config: McpProductionSmokeConfig = {
      endpoint: new URL("https://mcp.localhost:18443/mcp"),
      resource: "https://mcp.localhost:18443/mcp",
      identities: [],
      foreignProposalId: "00000000-0000-4000-8000-000000000099",
      viewerProposalId: "00000000-0000-4000-8000-000000000098",
      revokedToken: "revoked-token-123",
      timeoutMs: 100,
      rateLimitProbe: false,
      inspectorEnabled: true,
    };
    const identity: McpSmokeIdentity = {
      name: "reviewer-a",
      token: "oauth-token-secret",
      workspaceId,
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    };
    const error = await runInspector(config, identity, runtime).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("MCP_INSPECTOR_CLEANUP_FAILED");
    expect((error as Error).message).not.toContain("detail");
    expect((error as Error).message).not.toContain(homePath!);
  });

  test("prioritizes a primary Inspector error over cleanup failures", async () => {
    let homePath: string | undefined;
    const child: McpInspectorChild = { exited: Promise.resolve(23), kill: () => undefined };
    const runtime: McpInspectorRuntime = {
      serve: () => ({ port: 19090, stop: () => { throw new Error("proxy cleanup detail"); } }),
      createHome: async () => {
        homePath = await mkdtemp(join(tmpdir(), "mcp-inspector-home-test-"));
        outputPaths.push(homePath);
        return homePath;
      },
      removeHome: async () => { throw new Error("home cleanup detail"); },
      spawn: () => child,
    };
    const config: McpProductionSmokeConfig = {
      endpoint: new URL("https://mcp.localhost:18443/mcp"),
      resource: "https://mcp.localhost:18443/mcp",
      identities: [],
      foreignProposalId: "00000000-0000-4000-8000-000000000099",
      viewerProposalId: "00000000-0000-4000-8000-000000000098",
      revokedToken: "revoked-token-123",
      timeoutMs: 100,
      rateLimitProbe: false,
      inspectorEnabled: true,
    };
    const identity: McpSmokeIdentity = {
      name: "reviewer-a",
      token: "oauth-token-secret",
      workspaceId,
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    };
    const error = await runInspector(config, identity, runtime).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("MCP Inspector smoke failed (23)");
    expect((error as Error).message).not.toContain("cleanup detail");
    expect((error as Error).message).not.toContain(homePath!);
  });

  test("returns a bounded cleanup error when SIGKILL cannot reap the child", async () => {
    const groupSignals: string[] = [];
    let homePath: string | undefined;
    let exitReads = 0;
    const child: McpInspectorChild = {
      pid: 4322,
      get exited() {
        exitReads += 1;
        return exitReads === 1 ? Promise.resolve(0) : new Promise<number>(() => undefined);
      },
      kill: () => undefined,
    };
    const runtime: McpInspectorRuntime = {
      serve: () => ({ port: 19090, stop: () => undefined }),
      createHome: async () => {
        homePath = await mkdtemp(join(tmpdir(), "mcp-inspector-home-test-"));
        outputPaths.push(homePath);
        return homePath;
      },
      removeHome: async (path) => { await rm(path, { recursive: true, force: true }); },
      spawn: () => child,
      childCleanupTimeoutMs: 5,
      isProcessGroupAlive: () => true,
      killProcessGroup: (_pid, signal) => { groupSignals.push(signal); },
    };
    const config: McpProductionSmokeConfig = {
      endpoint: new URL("https://mcp.localhost:18443/mcp"),
      resource: "https://mcp.localhost:18443/mcp",
      identities: [],
      foreignProposalId: "00000000-0000-4000-8000-000000000099",
      viewerProposalId: "00000000-0000-4000-8000-000000000098",
      revokedToken: "revoked-token-123",
      timeoutMs: 5,
      rateLimitProbe: false,
      inspectorEnabled: true,
    };
    const identity: McpSmokeIdentity = {
      name: "reviewer-a",
      token: "oauth-token-secret",
      workspaceId,
      role: "reviewer",
      scopes: ["mcp:read", "mcp:write", "mcp:approve"],
    };
    await expect(runInspector(config, identity, runtime)).rejects.toThrow("MCP_INSPECTOR_CLEANUP_FAILED");
    expect(groupSignals).toEqual(["SIGTERM", "SIGKILL"]);
    await expect(stat(homePath!)).rejects.toThrow();
  });

  test("cleans temporary files after write and rename failures", async () => {
    const parent = await mkdtemp(join(tmpdir(), "mcp-local-client-failure-"));
    outputPaths.push(parent);
    const options = {
      outputPath: join(parent, "missing", "client.json"),
      resource: "https://mcp.localhost:18443/mcp",
      caPath: "/private/ca.pem",
      tokenFilePath: "/private/token.env",
      identities: [{ name: "viewer-a", workspaceId, role: "viewer" as const, scopes: ["mcp:read" as const] }],
    };
    await expect(writeMcpLocalClientConfig(options)).rejects.toThrow();
    expect(await readdir(parent)).toEqual([]);

    const target = join(parent, "existing.json");
    await mkdir(target);
    await expect(writeMcpLocalClientConfig({ ...options, outputPath: target })).rejects.toThrow();
    expect((await readdir(parent)).filter((name) => name.startsWith("existing.json.tmp-")).length).toBe(0);
  });
});
