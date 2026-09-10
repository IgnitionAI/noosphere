import { loginInstanceCodex } from "@outbound/infrastructure/ai/instance-codex-login";
import type { InstanceAiDeviceFlow } from "@outbound/application/ai/instance-ai-connections";
import { isAbsolute, join } from "node:path";
import { mkdir, lstat, readFile, stat } from "node:fs/promises";
import type { InstanceAiAuthenticationReader, InstanceAiConnectionView } from "@outbound/application/ai/instance-ai-connections";

type Environment = Readonly<Record<string, string | undefined>>;
export function instanceCodexHome(environment: Environment, connectionId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(connectionId)) throw new Error("INVALID_CONNECTION_ID");
  const root = environment.INSTANCE_CODEX_HOME?.trim();
  if (!root || !isAbsolute(root)) throw new Error("INSTANCE_CODEX_HOME_REQUIRED");
  return join(root, connectionId);
}
export async function prepareInstanceCodexHome(environment: Environment, connectionId: string): Promise<string> {
  const home = instanceCodexHome(environment, connectionId);
  await mkdir(home, { recursive: true, mode: 0o700 });
  const directory = await lstat(home);
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077)) throw new Error("INSTANCE_CODEX_HOME_NOT_PRIVATE");
  return home;
}
export class InstanceCodexAuthenticationReader implements InstanceAiAuthenticationReader {
  private readonly flows = new Map<string, InstanceAiDeviceFlow>();
  constructor(private readonly environment: Environment) {}
  deviceFlow(connection: InstanceAiConnectionView): InstanceAiDeviceFlow {
    return this.flows.get(connection.id) ?? { state: "idle" };
  }
  async begin(connection: InstanceAiConnectionView): Promise<InstanceAiDeviceFlow> {
    const existing = this.flows.get(connection.id);
    if (existing?.state === "starting" || existing?.state === "waiting") return existing;
    const pending: InstanceAiDeviceFlow = { state: "starting" };
    this.flows.set(connection.id, pending);
    let output = "";
    void loginInstanceCodex(connection.id, this.environment, chunk => {
      output = (output + chunk).slice(-32_768);
      const prompt = parseCodexDevicePrompt(output);
      if (prompt) this.flows.set(connection.id, { state: "waiting", ...prompt });
    }).then(() => this.flows.set(connection.id, { state: "connected" }), () => this.flows.set(connection.id, { state: "failed" }));
    return pending;
  }
  async status(connection: InstanceAiConnectionView) {
    if (connection.provider !== "codex-cli") return null;
    if (connection.authenticationInProgress) return { state: "in_progress" as const };
    let home: string;
    try { home = instanceCodexHome(this.environment, connection.id); } catch { return { state: "unavailable" as const }; }
    try {
      const file = join(home, "auth.json");
      const info = await stat(file);
      const value: unknown = JSON.parse(await readFile(file, "utf8"));
      if (!value || typeof value !== "object" || !("tokens" in value) || !value.tokens || typeof value.tokens !== "object"
        || !("access_token" in value.tokens) || typeof value.tokens.access_token !== "string"
        || ("auth_mode" in value && value.auth_mode !== "chatgpt")) return { state: "action_required" as const };
      const expired = connection.models.some((model) => model.errorCode === "AI_PROVIDER_AUTHENTICATION_FAILED" && model.testedAt && model.testedAt.getTime() >= info.mtimeMs);
      return { state: expired ? "expired" as const : "connected" as const };
    } catch { return { state: "action_required" as const }; }
  }
}

/** Never forward raw CLI output or arbitrary links to the browser. */
export function parseCodexDevicePrompt(output: string): { verificationUrl: string; userCode: string } | null {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  const urls: readonly string[] = clean.match(/https:\/\/[^\s<>]+/g) ?? [];
  const verificationUrl = "https://auth.openai.com/codex/device";
  if (!urls.includes(verificationUrl)) return null;
  const userCode = clean.match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/)?.[0];
  return userCode ? { verificationUrl, userCode } : null;
}
