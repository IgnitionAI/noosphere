import { expect, test } from "@playwright/test";
import { createDatabase } from "@outbound/infrastructure/database/client";

test("workspaces inherit or customize authorized models and explain withdrawn defaults", async ({ page }) => {
  const database = createDatabase(process.env.TEST_DATABASE_URL!);
  const api = process.env.OUTBOUND_API_URL;
  try {
    await page.goto("/login");
    await page.getByLabel("Email professionnel").fill(process.env.BOOTSTRAP_OWNER_EMAIL ?? "owner@ignition.local");
    await page.getByLabel("Mot de passe").fill(process.env.BOOTSTRAP_OWNER_PASSWORD ?? "change-me-in-env");
    await page.getByRole("button", { name: "Accéder au workspace" }).click();
    await page.waitForURL(/\/w\//);
    async function ready(model: string) {
      const response = await page.request.post(`${api}/api/v1/instance/ai/connections`, { data: { name: model, provider: "openrouter", apiKey: "workspace-secret-never-visible", models: [{ model, reasoningEffort: "low" }] } });
      expect(response.status()).toBe(201);
      const connection = await response.json();
      // Readiness is controlled fixture data here; real probe flows have separate browser tests.
      await database.client`update instance_ai_models set status = 'ready', tested_at = now() where connection_id = ${connection.id}`;
      return { connectionId: connection.id, provider: "openrouter", model, reasoningEffort: "low" };
    }
    const a = await ready(`vendor/a-${crypto.randomUUID()}`), b = await ready(`vendor/b-${crypto.randomUUID()}`);
    async function defaultTo(route: typeof a) {
      expect((await page.request.post(`${api}/api/v1/instance/ai/default`, { data: { connectionId: route.connectionId, model: route.model, fallback: null } })).status()).toBe(200);
    }
    await defaultTo(a);
    await page.goto("/setup");
    const fallbackOption = JSON.stringify({ connectionId: b.connectionId, model: b.model });
    await page.getByLabel("Modèle de secours", { exact: true }).selectOption(fallbackOption);
    await page.getByRole("button", { name: "Enregistrer le secours" }).click();
    await page.reload();
    await expect(page.getByLabel("Modèle de secours", { exact: true })).toHaveValue(fallbackOption);
    await database.client`update instance_ai_models set status = 'failed' where connection_id = ${b.connectionId}`;
    await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: "Le modèle de secours enregistré n’est plus disponible" })).toBeVisible();
    await expect(page.getByLabel("Modèle de secours", { exact: true })).toHaveValue(fallbackOption);
    await database.client`update instance_ai_models set status = 'ready' where connection_id = ${b.connectionId}`;
    async function workspace() {
      const response = await page.request.post(`${api}/api/v1/workspaces`, { data: { name: `Inheritance ${crypto.randomUUID()}` } });
      expect(response.status()).toBe(201);
      return (await response.json()).slug as string;
    }
    const one = await workspace(), two = await workspace();
    const settings = await page.request.get(`${api}/api/v1/workspace-ai-settings`, { headers: { "x-workspace-slug": one } });
    expect(settings.status()).toBe(200);
    expect((await settings.json()).effectiveDefaultRoutes).toMatchObject([a, b]);
    await page.goto(`/w/${one}/settings/ai`);
    await expect(page.getByLabel("Modèle du workspace", { exact: true })).toHaveValue("");
    await expect(page.getByText(`Modèle effectif : ${a.model} → ${b.model}`, { exact: true })).toBeVisible();
    await page.goto(`/w/${two}/settings/ai`);
    const option = JSON.stringify([a.connectionId, a.provider, a.model, a.reasoningEffort]);
    await page.getByLabel("Modèle du workspace", { exact: true }).selectOption(option);
    await page.getByRole("button", { name: "Enregistrer les modèles" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Modèles du workspace enregistrés" })).toBeVisible();
    await defaultTo(b);
    await page.reload();
    await expect(page.getByLabel("Modèle du workspace", { exact: true })).toHaveValue(option);
    await expect(page.getByText("Choix du workspace", { exact: true })).toBeVisible();
    await page.goto(`/w/${one}/settings/ai`);
    await expect(page.getByText(`Modèle effectif : ${b.model}`, { exact: true })).toBeVisible();
    await page.goto(`/w/${two}/settings/ai`);
    await page.getByLabel("Modèle du workspace", { exact: true }).selectOption("");
    await page.getByLabel("Rédaction", { exact: true }).selectOption(option);
    await page.getByRole("button", { name: "Enregistrer les modèles" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Modèles du workspace enregistrés" })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Modèle du workspace", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Rédaction", { exact: true })).toHaveValue(option);
    expect(await page.content()).not.toContain("workspace-secret-never-visible");
    await database.client`update instance_ai_models set status = 'failed' where connection_id = ${b.connectionId}`;
    await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: "Le modèle hérité n’est plus disponible" })).toBeVisible();
    await database.client`delete from instance_ai_models where connection_id = ${a.connectionId}`;
    await page.reload();
    await expect(page.getByText("Ce choix reste enregistré, mais ce modèle ne peut plus être appelé.", { exact: false })).toBeVisible();
  } finally { await database.close(); }
});
