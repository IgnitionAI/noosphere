import { stopLocalMcp } from "./start-local-mcp";

export { stopLocalMcp } from "./start-local-mcp";
export type { LocalMcpStopOptions } from "./start-local-mcp";

if (import.meta.main) {
  await stopLocalMcp({
    envFilePath: process.env.MCP_LOCAL_ENV_FILE ?? ".env.mcp-local",
    projectName: process.env.MCP_LOCAL_COMPOSE_PROJECT ?? "noosphere-mcp-local",
  });
}
