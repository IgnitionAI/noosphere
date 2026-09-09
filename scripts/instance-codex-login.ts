import { chmod, mkdir, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { createInstanceAiRepository } from "@outbound/infrastructure/ai/instance-ai-runtime";
import { prepareInstanceCodexHome } from "@outbound/infrastructure/ai/instance-codex-home";
import { isolatedCodexEnvironment } from "@outbound/infrastructure/ai/codex-process-runner";

export async function loginInstanceCodex(connectionId: string, environment: Readonly<Record<string, string | undefined>>) {
  if (!environment.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  const database = createDatabase(environment.DATABASE_URL);
  try {
    const repository = createInstanceAiRepository(database.db, environment);
    const connection = (await repository.list()).find((item) => item.id === connectionId);
    if (!connection || connection.provider !== "codex-cli") throw new Error("CODEX_CONNECTION_NOT_FOUND");
    const home = await prepareInstanceCodexHome(environment, connectionId);
    const sessionId = await repository.beginCodexAuthentication(connection.id);
    const staging = join(home, `login-${sessionId}`);
    await mkdir(staging, { mode: 0o700 });
    const authPath = join(staging, "auth.json");
    try {
      // Each attempt writes its own credentials. A superseded device flow cannot
      // replace the live account even if it finishes after a newer login.
      const child = Bun.spawn([environment.CODEX_BINARY_PATH ?? "codex", "-c", 'cli_auth_credentials_store="file"', "login", "--device-auth"], {
        cwd: staging, env: { ...isolatedCodexEnvironment(staging) }, stdin: "inherit", stdout: "inherit", stderr: "inherit",
      });
      if (await child.exited !== 0) throw new Error("CODEX_LOGIN_INCOMPLETE");
      const auth = JSON.parse(await readFile(authPath, "utf8"));
      if (auth.auth_mode !== "chatgpt" || typeof auth.tokens?.access_token !== "string") throw new Error("CODEX_REQUIRES_CHATGPT_LOGIN");
      await chmod(authPath, 0o600);
      const published = await repository.finishCodexAuthentication(connection.id, sessionId, () => rename(authPath, join(home, "auth.json")));
      if (!published) throw new Error("CODEX_LOGIN_SUPERSEDED");
    } finally {
      // Failure clears only this attempt; it cannot cancel a newer login.
      await repository.finishCodexAuthentication(connection.id, sessionId, async () => {});
      await unlink(authPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    }
  } finally { await database.close(); }
}
if (import.meta.main) {
  const id = process.argv[2];
  if (!id) throw new Error("Usage: bun run instance:codex:login <connection-id>");
  await loginInstanceCodex(id, process.env);
  console.log("Connexion ChatGPT enregistrée. Revenez au setup et testez votre modèle.");
}
