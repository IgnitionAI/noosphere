import { existsSync } from "node:fs";

const environmentPath = new URL("../.env", import.meta.url);
const examplePath = new URL("../.env.example", import.meta.url);
const existing = existsSync(environmentPath)
  ? await Bun.file(environmentPath).text()
  : "";
const example = await Bun.file(examplePath).text();
const values = parseEnvironment(example);
const existingValues = parseEnvironment(existing);

for (const [name, value] of existingValues) {
  if (value) values.set(name, value);
}

const generated: string[] = [];
setMissing("POSTGRES_PASSWORD", "postgres");
setMissing("S3_ACCESS_KEY_ID", "ignition-dev");
setMissing("S3_SECRET_ACCESS_KEY", randomSecret());
setMissing("SEARXNG_SECRET", randomSecret());
setMissing("CRAWLER_API_KEY", randomSecret());
setMissing("DOCLING_API_KEY", randomSecret());
setMissing("BETTER_AUTH_SECRET", randomSecret());
setMissing("BOOTSTRAP_OWNER_PASSWORD", randomSecret());

await setDevelopmentPort("DEV_POSTGRES_PORT", [5432, 55432, 55433]);
await setDevelopmentPort("DEV_MINIO_PORT", [9000, 59000, 59002]);
await setDevelopmentPort("DEV_MINIO_CONSOLE_PORT", [9001, 59001, 59003]);
await setDevelopmentPort("DEV_SEARXNG_PORT", [8080, 58080, 58081]);
await setDevelopmentPort("DEV_CRAWLER_PORT", [8000, 58000, 58001]);
await setDevelopmentPort("DEV_DOCLING_PORT", [5001, 55001, 55002]);

values.set(
  "DATABASE_URL",
  `postgres://postgres:postgres@127.0.0.1:${values.get("DEV_POSTGRES_PORT")}/ignition_outbound`,
);
values.set("S3_ENDPOINT", `http://127.0.0.1:${values.get("DEV_MINIO_PORT")}`);
values.set(
  "CRAWLER_SERVICE_URL",
  `http://127.0.0.1:${values.get("DEV_CRAWLER_PORT")}`,
);
values.set(
  "DOCLING_SERVICE_URL",
  `http://127.0.0.1:${values.get("DEV_DOCLING_PORT")}`,
);

await Bun.write(
  environmentPath,
  `${[...values].map(([name, value]) => `${name}=${value}`).join("\n")}\n`,
);

console.info(
  generated.length > 0
    ? `Development environment ready; generated: ${generated.join(", ")}`
    : "Development environment already ready",
);

function setMissing(name: string, value: string): void {
  const current = values.get(name);
  if (
    current &&
    !current.startsWith("replace-with-") &&
    !current.startsWith("change-me")
  ) {
    return;
  }
  values.set(name, value);
  generated.push(name);
}

async function setDevelopmentPort(
  name: string,
  candidates: readonly number[],
): Promise<void> {
  if (values.get(name)) return;
  for (const port of candidates) {
    if (await isPortAvailable(port)) {
      values.set(name, String(port));
      generated.push(name);
      return;
    }
  }
  throw new Error(`No available local port found for ${name}`);
}

async function isPortAvailable(port: number): Promise<boolean> {
  try {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port,
      socket: {
        data() {},
      },
    });
    server.stop(true);
    return true;
  } catch {
    return false;
  }
}

function parseEnvironment(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of source.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) result.set(match[1]!, match[2]!);
  }
  return result;
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("base64url");
}
