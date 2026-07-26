export {};

const email = requiredEnvironment("BOOTSTRAP_OWNER_EMAIL");
const password = requiredEnvironment("BOOTSTRAP_OWNER_PASSWORD");
const apiUrl = process.env.OUTBOUND_API_URL ?? "http://127.0.0.1:3001";
const webUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

await waitFor(`${apiUrl}/health/ready`);
await waitFor(`${webUrl}/login`);

const signIn = await fetch(`${webUrl}/api/auth/sign-in/email`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: new URL(webUrl).origin,
  },
  body: JSON.stringify({ email, password }),
});
if (!signIn.ok) throw new Error(`Development sign-in failed: ${signIn.status}`);
const cookie = signIn.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("Development sign-in did not return a session cookie");

const workspacesResponse = await fetch(`${apiUrl}/api/v1/workspaces`, {
  headers: { cookie },
});
if (!workspacesResponse.ok) {
  throw new Error(`Workspace lookup failed: ${workspacesResponse.status}`);
}
const workspaces = (await workspacesResponse.json()) as {
  data: Array<{ slug: string; role: string }>;
};
const workspace = workspaces.data[0];
if (!workspace || workspace.role !== "owner") {
  throw new Error("Development owner workspace is unavailable");
}

const headers = {
  cookie,
  "x-workspace-slug": workspace.slug,
  "content-type": "application/json",
};
const settingsResponse = await fetch(`${apiUrl}/api/v1/workspace-ai-settings`, {
  headers,
});
if (!settingsResponse.ok) {
  throw new Error(`AI settings lookup failed: ${settingsResponse.status}`);
}
const settings = (await settingsResponse.json()) as {
  researchModels: string[];
  synthesisModels: string[];
};
const saveResponse = await fetch(`${apiUrl}/api/v1/workspace-ai-settings`, {
  method: "PUT",
  headers,
  body: JSON.stringify({
    researchModels: settings.researchModels,
    synthesisModels: settings.synthesisModels,
  }),
});
if (!saveResponse.ok) {
  throw new Error(`AI settings update failed: ${saveResponse.status}`);
}

const page = await fetch(`${webUrl}/w/${workspace.slug}/settings/ai`, {
  headers: { cookie },
});
const html = await page.text();
if (!page.ok || !html.includes("Modèles Kimi du workspace")) {
  throw new Error(`AI settings page smoke test failed: ${page.status}`);
}

console.info(
  JSON.stringify({
    event: "development_smoke_passed",
    workspaceSlug: workspace.slug,
    api: "ready",
    web: "ready",
    aiSettings: "read_write",
  }),
);

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await fetch(url).catch(() => null);
    if (response?.ok) return;
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
