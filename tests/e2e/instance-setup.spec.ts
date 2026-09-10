import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

test("a different bootstrap account cannot see instance AI or access its pages and APIs", async ({ page }) => {
  const email = `other-${crypto.randomUUID()}@example.com`;
  const password = "instance-e2e-password-12345";
  const slug = `other-${crypto.randomUUID()}`;
  execFileSync("bun", ["scripts/bootstrap-owner.ts"], { env: {
    ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL!,
    BOOTSTRAP_OWNER_EMAIL: email, BOOTSTRAP_OWNER_PASSWORD: password,
    BOOTSTRAP_OWNER_NAME: "Other workspace owner", BOOTSTRAP_CREATE_WORKSPACE: "true",
    BOOTSTRAP_WORKSPACE_SLUG: slug, BOOTSTRAP_WORKSPACE_NAME: "Other workspace",
  }, stdio: "pipe" });
  await page.goto("/login");
  await page.getByLabel("Email professionnel").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Accéder au workspace" }).click();
  await page.waitForURL(/\/w\//);
  await page.goto(`/w/${slug}/settings`);
  await expect(page.getByRole("link", { name: "IA de l’instance", exact: true })).toHaveCount(0);
  for (const path of ["/setup", "/settings/instance/ai"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "L’IA de votre instance" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Enregistrer la connexion" })).toHaveCount(0);
  }
  const api = process.env.OUTBOUND_API_URL;
  expect((await page.request.get(`${api}/api/v1/instance/ai`)).status()).toBe(403);
  const connectionId = crypto.randomUUID();
  expect((await page.request.get(`${api}/api/v1/instance/ai/chatgpt?connectionId=${connectionId}`)).status()).toBe(403);
  for (const [path, data] of [
    ["/api/v1/instance/setup/skip", {}],
    ["/api/v1/instance/ai/chatgpt", { connectionId }],
    ["/api/v1/instance/ai/test", { connectionId, model: "gpt-5.6-luna" }],
    ["/api/v1/instance/ai/default", { connectionId, model: "gpt-5.6-luna" }],
    ["/api/v1/instance/ai/connections", { provider: "codex-cli", name: "Forbidden", models: [{ model: "gpt-5.6-luna", reasoningEffort: "low" }] }],
  ] as const) expect((await page.request.post(`${api}${path}`, { data })).status(), path).toBe(403);
});


test("administrator can skip instance setup and return from workspace settings", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email professionnel").fill(process.env.BOOTSTRAP_OWNER_EMAIL ?? "owner@ignition.local");
  await page.getByLabel("Mot de passe").fill(process.env.BOOTSTRAP_OWNER_PASSWORD ?? "change-me-in-env");
  await page.getByRole("button", { name: "Accéder au workspace" }).click();
  await page.waitForURL(/\/w\//);
  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: "L’IA de votre instance" })).toBeVisible();
  await page.getByRole("button", { name: "Configurer plus tard" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  const slug = process.env.BOOTSTRAP_WORKSPACE_SLUG ?? "ignition-ai";
  await page.goto(`/w/${slug}/settings`);
  await page.getByRole("link", { name: /IA de l’instance/ }).click();
  await expect(page.getByRole("heading", { name: "L’IA de votre instance" })).toBeVisible();
  await expect(page.getByText("Vous avez choisi de configurer l’IA plus tard.")).toBeVisible();
});

test("study start without AI preserves the draft and links to instance setup", async ({ page }) => {
  test.skip(Boolean(process.env.KIMI_CODE_API_KEY || process.env.CODEX_SERVICE_HOME || process.env.OPENAI_API_KEY), "Requires a provider-free instance");
  await page.goto("/login");
  await page.getByLabel("Email professionnel").fill(process.env.BOOTSTRAP_OWNER_EMAIL ?? "owner@ignition.local");
  await page.getByLabel("Mot de passe").fill(process.env.BOOTSTRAP_OWNER_PASSWORD ?? "change-me-in-env");
  await page.getByRole("button", { name: "Accéder au workspace" }).click();
  await page.waitForURL(/\/w\//);
  const slug = process.env.BOOTSTRAP_WORKSPACE_SLUG ?? "ignition-ai";
  const created = await page.request.post(`${process.env.OUTBOUND_API_URL}/api/v1/product-research-runs`, {
    headers: { "x-workspace-slug": slug },
    data: { productUrl: "https://example.com", productName: "Setup example", description: "", geography: "France", languages: ["fr"], salesMotion: "saas", knownCompetitors: [], internalDocumentIds: [], depth: "standard", researchVersion: 2 },
  });
  expect(created.status()).toBe(201);
  const run = await created.json();
  await page.goto(`/w/${slug}/research/${run.id}`);
  await page.getByRole("button", { name: /Démarrer/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Votre brouillon est conservé" })).toBeVisible();
  await page.getByRole("link", { name: "Configurer l’IA de l’instance" }).click();
  await expect(page.getByRole("heading", { name: "L’IA de votre instance" })).toBeVisible();
});
