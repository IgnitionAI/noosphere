import { expect, test } from "bun:test";
import {
  inspectLocalMcp,
  startLocalMcp,
  stopLocalMcp,
} from "../../scripts/start-local-mcp";

const testWithDocker = process.env.MCP_LOCAL_INTEGRATION_DOCKER === "1"
  && Boolean(process.env.MCP_LOCAL_ENV_FILE)
  && Boolean(process.env.MCP_LOCAL_CA_CERT)
  && Boolean(process.env.TEST_DATABASE_URL)
  ? test
  : test.skip;

testWithDocker("starts the explicitly opted-in local Docker project with one worker", async () => {
  const envFilePath = process.env.MCP_LOCAL_ENV_FILE!;
  const caCertificatePath = process.env.MCP_LOCAL_CA_CERT!;
  const testDatabaseUrl = process.env.TEST_DATABASE_URL!;
  const projectName = process.env.MCP_LOCAL_COMPOSE_PROJECT ?? "noosphere-mcp-local";
  const httpPort = Number(process.env.MCP_LOCAL_HTTP_PORT ?? 18080);
  const httpsPort = Number(process.env.MCP_LOCAL_HTTPS_PORT ?? 18443);
  try {
    const ready = await startLocalMcp({
      envFilePath,
      projectName,
      httpPort,
      httpsPort,
      caCertificatePath,
      testDatabaseUrl,
    });
    expect(ready.workerCount).toBe(1);
    expect(ready.resource).toBe(`https://mcp.localhost:${httpsPort}/mcp`);
    const status = await inspectLocalMcp({
      envFilePath,
      projectName,
      httpPort,
      httpsPort,
    });
    expect(status.workerCount).toBe(1);
  } finally {
    await stopLocalMcp({ envFilePath, projectName }).catch(() => undefined);
  }
});
