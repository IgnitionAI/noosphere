import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { createDatabase } from "@outbound/infrastructure/database/client";

test("guided ChatGPT connection can be validated, expire and be renewed without an API key", async ({ page }) => {
  test.skip(process.env.E2E_CONTROLLED_CODEX !== "true", "Requires the isolated controlled Codex executable");
  await page.goto("/login");
  await page.getByLabel("Email professionnel").fill(process.env.BOOTSTRAP_OWNER_EMAIL ?? "owner@ignition.local");
  await page.getByLabel("Mot de passe").fill(process.env.BOOTSTRAP_OWNER_PASSWORD ?? "change-me-in-env");
  await page.getByRole("button", { name: "Accéder au workspace" }).click();
  await page.waitForURL(/\/w\//);
  await page.goto("/setup");
  if (await page.getByText("Ajouter une autre connexion IA", { exact: true }).isVisible()) await page.getByText("Ajouter une autre connexion IA", { exact: true }).click();
  const form = page.getByRole("heading", { name: "Ajouter une connexion IA" }).locator("..");
  await form.getByLabel("Fournisseur").selectOption("codex-cli");
  await expect(form.getByLabel("Clé API")).toHaveCount(0);
  const name = `ChatGPT E2E ${crypto.randomUUID()}`;
  await form.getByLabel("Nom de la connexion").fill(name);
  await form.getByText("Ajouter un modèle par son identifiant", { exact: true }).click();
  await form.getByLabel("Identifiants de modèles (avancé)").fill("controlled-codex-model");
  await form.getByRole("button", { name: "Enregistrer la connexion" }).click();
  const section = page.getByRole("heading", { name, exact: true }).locator("..");
  await expect(section.getByRole("button", { name: "Connecter ChatGPT", exact: true })).toBeVisible();
  await expect(section.getByText(/INSTANCE_CODEX_HOME|bun run|Docker Compose/)).toHaveCount(0);
  const database = createDatabase(process.env.TEST_DATABASE_URL!);
  try {
    const [connection] = await database.client`select id from instance_ai_connections where name = ${name}`;
    const id = String(connection!.id);
    const login = async () => {
      await section.getByRole("button", { name: "Connecter ChatGPT", exact: true }).click();
      await expect(section.getByRole("link", { name: "Ouvrir ChatGPT" })).toHaveAttribute("href", "https://auth.openai.com/codex/device");
      await expect(section.getByText("ABCD-12345", { exact: true })).toBeVisible();
      await expect(page.getByText("Compte ChatGPT connecté. Vous pouvez maintenant tester votre modèle.", { exact: true })).toBeVisible({ timeout: 10_000 });
    };
    await login();
    await page.reload();
    await expect(section.getByText("ChatGPT est connecté. Choisissez ci-dessous le modèle à utiliser.")).toBeVisible();
    await section.getByRole("button", { name: "Tester controlled-codex-model" }).click();
    await expect(section.getByText("Test réussi", { exact: true })).toBeVisible();
    await section.getByRole("button", { name: "Utiliser par défaut" }).click();
    await expect(section.getByText("Par défaut", { exact: true })).toBeVisible();
    const authPath = join(process.env.INSTANCE_CODEX_HOME!, id, "auth.json");
    const auth = JSON.parse(await readFile(authPath, "utf8"));
    await writeFile(authPath, JSON.stringify({ ...auth, expired: true }), { mode: 0o600 });
    await section.getByRole("button", { name: "Tester controlled-codex-model" }).click();
    await expect(section.getByText("Connectez votre compte ChatGPT pour l’utiliser dans Noosphere.")).toBeVisible();
    await login();
    await page.reload();
    await expect(section.getByText("À tester", { exact: true })).toBeVisible();
    await section.getByRole("button", { name: "Tester controlled-codex-model" }).click();
    await expect(section.getByText("Test réussi", { exact: true })).toBeVisible();
    expect(await page.content()).not.toContain("browser-fixture-access");
    expect(await page.content()).not.toContain("browser-fixture-refresh");
  } finally { await database.close(); }
});
