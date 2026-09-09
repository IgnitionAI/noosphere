import { expect, test } from "@playwright/test";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { execFileSync } from "node:child_process";

test("first administrator reaches setup before creating a workspace", async ({ page }) => {
  const database = createDatabase(process.env.TEST_DATABASE_URL!);
  const email = `setup-${crypto.randomUUID()}@example.com`;
  const password = "instance-e2e-password-12345";
  try {
    execFileSync("bun", ["scripts/bootstrap-owner.ts"], { env: {
      ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL!,
      BOOTSTRAP_OWNER_EMAIL: email, BOOTSTRAP_OWNER_PASSWORD: password,
      BOOTSTRAP_OWNER_NAME: "Initial administrator", BOOTSTRAP_CREATE_WORKSPACE: "false",
    }, stdio: "pipe" });
    await database.client`delete from instance_setup`;
  } finally { await database.close(); }
  await page.goto("/login");
  await page.getByLabel("Email professionnel").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Accéder au workspace" }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByRole("button", { name: "Configurer plus tard" }).click();
  await expect(page.getByRole("heading", { name: "Créez votre workspace" })).toBeVisible();
  const workspaceName = `Explore ${crypto.randomUUID()}`;
  await page.getByLabel("Nom du workspace").fill(workspaceName);
  await page.getByRole("button", { name: "Créer le workspace" }).click();
  await expect(page.getByRole("heading", { name: `Rendez ${workspaceName} opérationnel` })).toBeVisible();
  await page.getByRole("link", { name: "Ouvrir l’app" }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/strategy\/product-reading/);
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
