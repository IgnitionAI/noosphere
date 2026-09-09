import { expect, test } from "@playwright/test";
import { createDatabase } from "@outbound/infrastructure/database/client";

test("legacy research choices survive a settings save until explicitly replaced", async ({ page }) => {
  const database = createDatabase(process.env.TEST_DATABASE_URL!);
  try {
    await page.goto("/login");
    await page.getByLabel("Email professionnel").fill(process.env.BOOTSTRAP_OWNER_EMAIL ?? "owner@ignition.local");
    await page.getByLabel("Mot de passe").fill(process.env.BOOTSTRAP_OWNER_PASSWORD ?? "change-me-in-env");
    await page.getByRole("button", { name: "Accéder au workspace" }).click();
    await page.waitForURL(/\/w\//);
    const response = await page.request.post(`${process.env.OUTBOUND_API_URL!}/api/v1/workspaces`, { data: { name: `Legacy ${crypto.randomUUID()}` } });
    expect(response.status()).toBe(201);
    const workspace = await response.json();
    const [row] = await database.client`select w.id, m.user_id from workspaces w join workspace_members m on m.workspace_id = w.id where w.slug = ${workspace.slug} and m.role = 'owner'`;
    const route = (model: string) => ({ provider: "kimi-code", model, reasoningEffort: "low" });
    const tiers = { principal: [route("legacy-principal")], executor: [route("legacy-executor")] };
    await database.client`insert into workspace_ai_settings(workspace_id, research_models, synthesis_models, model_routing, updated_by) values (${row!.id}, '["legacy-principal"]', '["legacy-executor"]', ${JSON.stringify({ researchTierRoutes: tiers })}::jsonb, ${row!.user_id})`;
    await page.goto(`/w/${workspace.slug}/settings/ai`);
    await expect(page.getByRole("heading", { name: "Modèles de recherche conservés" })).toBeVisible();
    await expect(page.getByText("Recherche : legacy-principal. Synthèse : legacy-executor.")).toBeVisible();
    await page.getByRole("button", { name: "Enregistrer les modèles", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("enregistrés");
    const [preserved] = await database.client`select model_routing from workspace_ai_settings where workspace_id = ${row!.id}`;
    expect(preserved?.model_routing.researchTierRoutes).toEqual(tiers);
    await page.getByRole("checkbox", { name: "Remplacer ces choix par le modèle de recherche défini ci-dessous" }).check();
    await page.getByRole("button", { name: "Enregistrer les modèles", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Modèles de recherche conservés" })).toHaveCount(0);
    const [replaced] = await database.client`select model_routing from workspace_ai_settings where workspace_id = ${row!.id}`;
    expect(replaced?.model_routing.researchTierRoutes).toBeUndefined();
  } finally { await database.close(); }
});
