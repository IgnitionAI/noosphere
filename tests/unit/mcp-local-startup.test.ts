import { afterEach, expect, test } from "bun:test";
import { chmod, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import {
  McpLocalStartupError,
  inspectLocalMcp,
  runLocalMcpCommand,
  startLocalMcp,
  stopLocalMcp,
} from "../../scripts/start-local-mcp";

const envFiles: string[] = [];

const composeConfig = (ports = [
  { host_ip: "127.0.0.1", published: "18080", target: 80, protocol: "tcp" },
  { host_ip: "127.0.0.1", published: "18443", target: 443, protocol: "tcp" },
]) => JSON.stringify({
  name: "noosphere-mcp-local",
  services: {
    database: { ports: [] },
    api: {},
    web: {},
    worker: {},
    proxy: { ports },
  },
});

async function privateEnvFile(): Promise<string> {
  const path = `/tmp/mcp-local-startup-${crypto.randomUUID()}.env`;
  await Bun.write(path, "MCP_LOCAL_FIXTURE_KEY=test\nMCP_LOCAL_HTTP_PORT=18080\nMCP_LOCAL_HTTPS_PORT=18443\nPOSTGRES_DB=noosphere_mcp_local\nPOSTGRES_USER=postgres\nPOSTGRES_PASSWORD=test-password\n");
  await chmod(path, 0o600);
  envFiles.push(path);
  return path;
}

async function privateCaFile(): Promise<string> {
  const path = `/tmp/mcp-local-startup-${crypto.randomUUID()}.crt`;
  await Bun.write(path, "-----BEGIN CERTIFICATE-----\nlocal-test\n-----END CERTIFICATE-----\n");
  envFiles.push(path);
  return path;
}

const composeFiles = [
  resolve(process.cwd(), "compose.infrastructure.yml"),
  resolve(process.cwd(), "compose.production.yml"),
  resolve(process.cwd(), "compose.mcp-local.yml"),
];

afterEach(async () => {
  await Promise.all(envFiles.splice(0).map(async (path) => {
    await unlink(path).catch(() => undefined);
  }));
});

test("rejects a merged config that publishes anything except loopback Caddy", async () => {
  const envFilePath = await privateEnvFile();
  const caCertificatePath = await privateCaFile();
  const run = async (argv: readonly string[]) => {
    if (argv.includes("ls")) {
      return { exitCode: 0, stdout: "[]", stderr: "" };
    }
    if (argv.includes("config")) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          services: {
            proxy: { ports: JSON.parse(composeConfig()).services.proxy.ports },
            api: { ports: [{ host_ip: "0.0.0.0", published: "3000", target: 3000, protocol: "tcp" }] },
          },
        }),
        stderr: "",
      };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  await expect(
    startLocalMcp({
      envFilePath,
      projectName: "noosphere-mcp-local",
      httpPort: 18080,
      httpsPort: 18443,
      caCertificatePath,
      run,
    } as never),
  ).rejects.toMatchObject({ code: "MCP_LOCAL_UNSAFE_PORTS" });
});

test("uses one worker and reports a canonical local resource", async () => {
  const envFilePath = await privateEnvFile();
  const caCertificatePath = await privateCaFile();
  const commands: string[][] = [];
  const run = async (argv: readonly string[]) => {
    commands.push([...argv]);
    if (argv.includes("ls")) {
      return { exitCode: 0, stdout: "[]", stderr: "" };
    }
    if (argv.includes("config")) {
      return {
        exitCode: 0,
        stdout: composeConfig(),
        stderr: "",
      };
    }
    if (argv[0] === "curl") {
      return { exitCode: 0, stdout: '{"status":"ready"}', stderr: "" };
    }
    if (argv.includes("ps")) {
      return { exitCode: 0, stdout: "proxy\nworker", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const ready = await startLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    httpPort: 18080,
    httpsPort: 18443,
    caCertificatePath,
    run,
  } as never);
  expect(ready.resource).toBe("https://mcp.localhost:18443/mcp");
  expect(ready.publishedPorts).toEqual(["127.0.0.1:18080->80", "127.0.0.1:18443->443"]);
  expect(ready.workerCount).toBe(1);
  expect(commands.some((argv) => argv.includes("config"))).toBe(true);
  expect(commands.some((argv) => argv.includes("build"))).toBe(true);
  expect(commands.some((argv) => argv.includes("up") && argv.includes("worker"))).toBe(true);
  expect(commands.some((argv) => argv[0] === "curl" && argv.includes("https://mcp.localhost:18443/health/ready"))).toBe(true);
  const health = commands.find((argv) => argv[0] === "curl");
  expect(health).toContain("--cacert");
  expect(health).toContain(caCertificatePath);
  expect(health).not.toContain("-k");
  const up = commands.find((argv) => argv.includes("up"));
  expect(up?.filter((argument) => argument === "worker")).toHaveLength(1);
});

test("fails closed when the private env file is not mode 0600", async () => {
  const path = `/tmp/mcp-local-startup-${crypto.randomUUID()}.env`;
  await Bun.write(path, "MCP_LOCAL_FIXTURE_KEY=test\n");
  await chmod(path, 0o644);
  envFiles.push(path);
  await expect(startLocalMcp({
    envFilePath: path,
    projectName: "noosphere-mcp-local",
    httpPort: 18080,
    httpsPort: 18443,
    run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  })).rejects.toMatchObject({ code: "MCP_LOCAL_ENV_INSECURE" });
});

test("stops only the named project without a volume deletion flag", async () => {
  const envFilePath = await privateEnvFile();
  const commands: string[][] = [];
  await stopLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    run: async (argv: readonly string[]) => {
      commands.push([...argv]);
      if (argv.includes("ls")) {
        return { exitCode: 0, stdout: "[]", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  expect(commands.length).toBeGreaterThan(0);
  expect(commands.every((argv) => !argv.includes("-v") && !argv.includes("--volumes"))).toBe(true);
  expect(commands.every((argv) => argv.includes("noosphere-mcp-local"))).toBe(true);
});

test("inspects a bounded redacted service status", async () => {
  const envFilePath = await privateEnvFile();
  const status = await inspectLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    run: async (argv: readonly string[]) => {
      if (argv.includes("ls")) {
        return { exitCode: 0, stdout: "[]", stderr: "" };
      }
      expect(argv).toContain("ps");
      return {
        exitCode: 0,
        stdout: JSON.stringify([
          { Service: "proxy", State: "running", Health: "healthy" },
          { Service: "worker", State: "running", Health: "none" },
        ]),
        stderr: "",
      };
    },
  });
  expect(status.projectName).toBe("noosphere-mcp-local");
  expect(status.workerCount).toBe(1);
  expect(status.redacted).toBe(true);
  expect(JSON.stringify(status)).not.toContain("stderr");
});

test("rejects malformed Compose JSON instead of accepting a text summary", async () => {
  const envFilePath = await privateEnvFile();
  const caCertificatePath = await privateCaFile();
  const commands: string[][] = [];
  await expect(startLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    httpPort: 18080,
    httpsPort: 18443,
    caCertificatePath,
    run: async (argv: readonly string[]) => {
      commands.push([...argv]);
      if (argv.includes("ls")) return { exitCode: 0, stdout: "[]", stderr: "" };
      if (argv.includes("config")) return { exitCode: 0, stdout: "proxy 127.0.0.1:18080->80", stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  } as never)).rejects.toMatchObject({ code: "MCP_LOCAL_COMPOSE_CONFIG" });
  expect(commands.some((argv) => argv.includes("build"))).toBe(false);
});

test("rejects a valid JSON config with an extra published service port", async () => {
  const envFilePath = await privateEnvFile();
  const caCertificatePath = await privateCaFile();
  await expect(startLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    httpPort: 18080,
    httpsPort: 18443,
    caCertificatePath,
    run: async (argv: readonly string[]) => {
      if (argv.includes("ls")) return { exitCode: 0, stdout: "[]", stderr: "" };
      if (argv.includes("config")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ services: { ...JSON.parse(composeConfig()).services, api: { ports: [{ host_ip: "127.0.0.1", published: "3000", target: 3000, protocol: "tcp" }] } } }),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  } as never)).rejects.toMatchObject({ code: "MCP_LOCAL_UNSAFE_PORTS" });
});

test("rejects non-array published ports in an otherwise valid JSON root", async () => {
  const envFilePath = await privateEnvFile();
  const caCertificatePath = await privateCaFile();
  await expect(startLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    httpPort: 18080,
    httpsPort: 18443,
    caCertificatePath,
    run: async (argv: readonly string[]) => {
      if (argv.includes("ls")) return { exitCode: 0, stdout: "[]", stderr: "" };
      if (argv.includes("config")) return { exitCode: 0, stdout: JSON.stringify({ services: { proxy: { ports: {} } } }), stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  } as never)).rejects.toMatchObject({ code: "MCP_LOCAL_UNSAFE_PORTS" });
});

test("rejects a wrong loopback mapping even when the JSON shape is valid", async () => {
  const envFilePath = await privateEnvFile();
  const caCertificatePath = await privateCaFile();
  await expect(startLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    httpPort: 18080,
    httpsPort: 18443,
    caCertificatePath,
    run: async (argv: readonly string[]) => {
      if (argv.includes("ls")) return { exitCode: 0, stdout: "[]", stderr: "" };
      if (argv.includes("config")) return { exitCode: 0, stdout: composeConfig([{ host_ip: "127.0.0.1", published: "18081", target: 80, protocol: "tcp" }, { host_ip: "127.0.0.1", published: "18443", target: 443, protocol: "tcp" }]), stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  } as never)).rejects.toMatchObject({ code: "MCP_LOCAL_UNSAFE_PORTS" });
});

test("rejects an existing project with unrelated Compose config files before build", async () => {
  const envFilePath = await privateEnvFile();
  const caCertificatePath = await privateCaFile();
  const commands: string[][] = [];
  await expect(startLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    httpPort: 18080,
    httpsPort: 18443,
    caCertificatePath,
    run: async (argv: readonly string[]) => {
      commands.push([...argv]);
      if (argv.includes("ls")) {
        return { exitCode: 0, stdout: JSON.stringify([{ Name: "noosphere-mcp-local", ConfigFiles: "/tmp/unrelated.yml" }]), stderr: "" };
      }
      return { exitCode: 0, stdout: composeConfig(), stderr: "" };
    },
  } as never)).rejects.toMatchObject({ code: "MCP_LOCAL_PROJECT_UNSAFE" });
  expect(commands.some((argv) => argv.includes("build"))).toBe(false);
});

test("rejects duplicate Compose config files as a non-owned project", async () => {
  const envFilePath = await privateEnvFile();
  const caCertificatePath = await privateCaFile();
  const commands: string[][] = [];
  await expect(startLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    httpPort: 18080,
    httpsPort: 18443,
    caCertificatePath,
    run: async (argv: readonly string[]) => {
      commands.push([...argv]);
      if (argv.includes("ls")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ Name: "noosphere-mcp-local", ConfigFiles: [composeFiles[0], composeFiles[1], composeFiles[1]].join(",") }]),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  } as never)).rejects.toMatchObject({ code: "MCP_LOCAL_PROJECT_UNSAFE" });
  expect(commands.some((argv) => argv.includes("build"))).toBe(false);
});

test("rejects a project missing one expected Compose config file before status", async () => {
  const envFilePath = await privateEnvFile();
  const commands: string[][] = [];
  await expect(inspectLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    run: async (argv: readonly string[]) => {
      commands.push([...argv]);
      if (argv.includes("ls")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ Name: "noosphere-mcp-local", ConfigFiles: composeFiles.slice(0, 2) }]),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  })).rejects.toMatchObject({ code: "MCP_LOCAL_PROJECT_UNSAFE" });
  expect(commands.some((argv) => argv.includes("ps"))).toBe(false);
});

test("rejects incoherent Compose labels before stopping an existing project", async () => {
  const envFilePath = await privateEnvFile();
  const commands: string[][] = [];
  await expect(stopLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    run: async (argv: readonly string[]) => {
      commands.push([...argv]);
      if (argv.includes("ls")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ Name: "noosphere-mcp-local", ConfigFiles: composeFiles.join(",") }]),
          stderr: "",
        };
      }
      if (argv.includes("-aq")) return { exitCode: 0, stdout: "abcdef012345\n", stderr: "" };
      if (argv.includes("inspect")) {
        return {
          exitCode: 0,
          stdout: `${JSON.stringify({ "com.docker.compose.project": "another-project", "com.docker.compose.service": "proxy" })}\n`,
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  })).rejects.toMatchObject({ code: "MCP_LOCAL_PROJECT_UNSAFE" });
  expect(commands.some((argv) => argv.includes("stop"))).toBe(false);
  expect(commands.some((argv) => argv.includes("rm"))).toBe(false);
});

test("rejects an unexpected Compose service label before startup mutation", async () => {
  const envFilePath = await privateEnvFile();
  const caCertificatePath = await privateCaFile();
  const commands: string[][] = [];
  await expect(startLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    httpPort: 18080,
    httpsPort: 18443,
    caCertificatePath,
    run: async (argv: readonly string[]) => {
      commands.push([...argv]);
      if (argv.includes("ls")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ Name: "noosphere-mcp-local", ConfigFiles: composeFiles.join(",") }]),
          stderr: "",
        };
      }
      if (argv.includes("-aq")) return { exitCode: 0, stdout: "abcdef012345\n", stderr: "" };
      if (argv.includes("inspect")) {
        return {
          exitCode: 0,
          stdout: `${JSON.stringify({ "com.docker.compose.project": "noosphere-mcp-local", "com.docker.compose.service": "unexpected" })}\n`,
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  } as never)).rejects.toMatchObject({ code: "MCP_LOCAL_PROJECT_UNSAFE" });
  expect(commands.some((argv) => argv.includes("build"))).toBe(false);
});

test("fails before build when either loopback port is occupied", async () => {
  const envFilePath = await privateEnvFile();
  const caCertificatePath = await privateCaFile();
  const commands: string[][] = [];
  await expect(startLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    httpPort: 18080,
    httpsPort: 18443,
    caCertificatePath,
    probePort: () => false,
    run: async (argv: readonly string[]) => {
      commands.push([...argv]);
      if (argv.includes("ls")) return { exitCode: 0, stdout: "[]", stderr: "" };
      if (argv.includes("config")) return { exitCode: 0, stdout: composeConfig(), stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  } as never)).rejects.toMatchObject({ code: "MCP_LOCAL_PORT_OCCUPIED" });
  expect(commands.some((argv) => argv.includes("build"))).toBe(false);
  expect(commands.some((argv) => argv.includes("up"))).toBe(false);
});

test("fails explicitly when a checkout has no local CA certificate", async () => {
  const envFilePath = await privateEnvFile();
  const commands: string[][] = [];
  const caCertificatePath = `/tmp/mcp-local-missing-ca-${crypto.randomUUID()}.crt`;
  await expect(startLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    httpPort: 18080,
    httpsPort: 18443,
    caCertificatePath,
    run: async (argv: readonly string[]) => {
      commands.push([...argv]);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  } as never)).rejects.toMatchObject({ code: "MCP_LOCAL_CA_MISSING" });
  expect(commands).toHaveLength(0);
});

test("caps command output before any startup mutation", async () => {
  const envFilePath = await privateEnvFile();
  const caCertificatePath = await privateCaFile();
  await expect(startLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    httpPort: 18080,
    httpsPort: 18443,
    caCertificatePath,
    run: async (argv: readonly string[]) => {
      if (argv.includes("ls")) return { exitCode: 0, stdout: "[]", stderr: "" };
      if (argv.includes("config")) return { exitCode: 0, stdout: "x".repeat(64 * 1024 + 1), stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  } as never)).rejects.toMatchObject({ code: "MCP_LOCAL_OUTPUT_TOO_LARGE" });
});

test("times out a hanging command with a stable code", async () => {
  const envFilePath = await privateEnvFile();
  const caCertificatePath = await privateCaFile();
  await expect(startLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    httpPort: 18080,
    httpsPort: 18443,
    caCertificatePath,
    commandTimeoutMs: 5,
    run: async (argv: readonly string[]) => {
      if (argv.includes("ls")) return { exitCode: 0, stdout: "[]", stderr: "" };
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  } as never)).rejects.toMatchObject({ code: "MCP_LOCAL_COMMAND_TIMEOUT" });
});

test("runs scoped cleanup before stop and rm without volume deletion", async () => {
  const envFilePath = await privateEnvFile();
  const events: string[] = [];
  await stopLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    cleanup: async () => events.push("cleanup"),
    run: async (argv: readonly string[]) => {
      if (argv.includes("ls")) return { exitCode: 0, stdout: "[]", stderr: "" };
      events.push(argv.includes("stop") ? "stop" : "rm");
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  } as never);
  expect(events).toEqual(["cleanup", "stop", "rm"]);
});

test("runLocalMcpCommand never exposes unbounded child output", async () => {
  await expect(runLocalMcpCommand(["bun", "-e", "process.stdout.write('x'.repeat(65537))"]))
    .rejects.toMatchObject({ code: "MCP_LOCAL_OUTPUT_TOO_LARGE" });
});

test("kills a timed out subprocess and prevents its delayed side effect", async () => {
  const marker = `/tmp/mcp-local-timeout-${crypto.randomUUID()}`;
  await expect(runLocalMcpCommand([
    "bun",
    "-e",
    `setTimeout(() => Bun.write(${JSON.stringify(marker)}, 'late'), 100); setInterval(() => undefined, 1000)`,
  ], { timeoutMs: 10 } as never)).rejects.toMatchObject({ code: "MCP_LOCAL_COMMAND_TIMEOUT" });
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(await Bun.file(marker).exists()).toBe(false);
  await unlink(marker).catch(() => undefined);
});

test("projects child output as metadata instead of exposing stdout or stderr", async () => {
  const result = await runLocalMcpCommand(["bun", "-e", "process.stdout.write('secret-value')"]);
  expect(result).not.toHaveProperty("stdout");
  expect(result).not.toHaveProperty("stderr");
  expect(result.stdoutBytes).toBeGreaterThan(0);
});

test("does not inherit ambient Compose or proxy variables into child processes", async () => {
  const marker = `/tmp/mcp-local-env-${crypto.randomUUID()}`;
  const original = {
    APP_ENV_FILE: process.env.APP_ENV_FILE,
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
    HTTP_BIND: process.env.HTTP_BIND,
  };
  process.env.APP_ENV_FILE = "/tmp/host-evil.env";
  process.env.POSTGRES_PASSWORD = "host-evil-password";
  process.env.HTTP_BIND = "0.0.0.0";
  try {
    await runLocalMcpCommand([
      "bun",
      "-e",
      `if (process.env.APP_ENV_FILE || process.env.POSTGRES_PASSWORD || process.env.HTTP_BIND) await Bun.write(${JSON.stringify(marker)}, 'leaked')`,
    ]);
    expect(await Bun.file(marker).exists()).toBe(false);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await unlink(marker).catch(() => undefined);
  }
});

test("requires an explicit local CA path instead of silently choosing a default", async () => {
  const envFilePath = await privateEnvFile();
  const commands: string[][] = [];
  await expect(startLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    httpPort: 18080,
    httpsPort: 18443,
    run: async (argv: readonly string[]) => {
      commands.push([...argv]);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  })).rejects.toMatchObject({ code: "MCP_LOCAL_CA_REQUIRED" });
  expect(commands).toHaveLength(0);
});

test("rejects a non-local dedicated TEST_DATABASE_URL before Compose", async () => {
  const envFilePath = await privateEnvFile();
  const caCertificatePath = await privateCaFile();
  const commands: string[][] = [];
  await expect(startLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    httpPort: 18080,
    httpsPort: 18443,
    caCertificatePath,
    testDatabaseUrl: "postgres://postgres:test-password@shared.example/noosphere_mcp_local",
    run: async (argv: readonly string[]) => {
      commands.push([...argv]);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  })).rejects.toMatchObject({ code: "MCP_LOCAL_DATABASE_UNSAFE" });
  expect(commands).toHaveLength(0);
});

test("rejects a dedicated database URL whose credentials disagree with the private Compose env", async () => {
  const envFilePath = await privateEnvFile();
  const caCertificatePath = await privateCaFile();
  await expect(startLocalMcp({
    envFilePath,
    projectName: "noosphere-mcp-local",
    httpPort: 18080,
    httpsPort: 18443,
    caCertificatePath,
    testDatabaseUrl: "postgres://wrong:test-password@127.0.0.1:5432/noosphere_mcp_local",
    run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  })).rejects.toMatchObject({ code: "MCP_LOCAL_DATABASE_MISMATCH" });
});

test("does not pass ambient Compose or proxy variables to the controlled runner", async () => {
  const envFilePath = await privateEnvFile();
  const caCertificatePath = await privateCaFile();
  const original = {
    APP_ENV_FILE: process.env.APP_ENV_FILE,
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
    HTTP_BIND: process.env.HTTP_BIND,
    HTTPS_BIND: process.env.HTTPS_BIND,
  };
  process.env.APP_ENV_FILE = "/tmp/host-evil.env";
  process.env.POSTGRES_PASSWORD = "host-evil-password";
  process.env.HTTP_BIND = "0.0.0.0";
  process.env.HTTPS_BIND = "0.0.0.0";
  const contexts: Array<{ env?: Readonly<Record<string, string>> }> = [];
  const run = async (argv: readonly string[], context?: { env?: Readonly<Record<string, string>> }) => {
    contexts.push(context ?? {});
    if (argv.includes("ls")) return { exitCode: 0, stdout: "[]", stderr: "" };
    if (argv.includes("config")) return { exitCode: 0, stdout: composeConfig(), stderr: "" };
    if (argv[0] === "curl") return { exitCode: 0, stdout: "ready", stderr: "" };
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  try {
    await startLocalMcp({ envFilePath, projectName: "noosphere-mcp-local", httpPort: 18080, httpsPort: 18443, caCertificatePath, run });
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const composeContexts = contexts.filter(({ env }) => env?.APP_ENV_FILE === envFilePath);
  expect(composeContexts.length).toBeGreaterThan(0);
  for (const { env } of composeContexts) {
    expect(env).toMatchObject({ APP_ENV_FILE: envFilePath, MCP_LOCAL_HTTP_PORT: "18080", MCP_LOCAL_HTTPS_PORT: "18443" });
    expect(env).not.toHaveProperty("POSTGRES_PASSWORD");
    expect(env).not.toHaveProperty("HTTP_BIND");
    expect(env).not.toHaveProperty("HTTPS_BIND");
  }
});

test("preserves timeout and output errors as stable startup codes", () => {
  expect(new McpLocalStartupError("MCP_LOCAL_COMMAND_TIMEOUT").code).toBe("MCP_LOCAL_COMMAND_TIMEOUT");
});
