import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createDatabase } from "@outbound/infrastructure/database/client";

for (const changeModel of [false, true]) {
test(`an interrupted mission resumes from its checkpoint; change model: ${changeModel}`, async ({ page }) => {
  const database = createDatabase(process.env.TEST_DATABASE_URL!);
  try {
    await page.goto("/login");
    await page.getByLabel("Email professionnel").fill(process.env.BOOTSTRAP_OWNER_EMAIL ?? "owner@ignition.local");
    await page.getByLabel("Mot de passe").fill(process.env.BOOTSTRAP_OWNER_PASSWORD ?? "change-me-in-env");
    await page.getByRole("button", { name: "Accéder au workspace" }).click();
    await page.waitForURL(/\/w\//);
    const response = await page.request.post(`${process.env.OUTBOUND_API_URL}/api/v1/workspaces`, { data: { name: `Mission ${crypto.randomUUID()}` } });
    expect(response.status()).toBe(201);
    const workspace = await response.json();
    const [row] = await database.client`select id from workspaces where slug = ${workspace.slug}`;
    function fixture(mode: string, runId?: string) {
      const output = execFileSync("bun", ["tests/fixtures/ai-mission-browser.ts", mode, row!.id, ...(runId ? [runId] : [])], { encoding: "utf8", timeout: 20000, env: process.env });
      return JSON.parse(output.split("\n").find((line) => line.startsWith("RESULT:"))!.slice(7)) as { runId: string };
    }
    const { runId } = fixture("pause");
    // New process and healthy controlled provider still cannot resume without the UI action.
    fixture("verify-paused", runId);
    await page.goto(`/w/${workspace.slug}/settings/console`);
    await page.getByRole("link", { name: "Ouvrir la recherche", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/research/${runId}$`));
    await expect(page.getByRole("heading", { name: "Quota du fournisseur IA épuisé" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reprendre", exact: true })).toBeVisible();
    fixture("change-model", runId);
    await page.getByRole("button", { name: changeModel ? "Reprendre avec le modèle configuré" : "Reprendre", exact: true }).click();
    await expect.poll(async () => {
      const [run] = await database.client`select status from product_research_runs where id = ${runId}`;
      return run?.status;
    }).toBe("running");
    fixture(changeModel ? "finish-new-model" : "finish", runId);
    await page.reload();
    await expect(page.getByRole("button", { name: "Reprendre", exact: true })).toHaveCount(0);
    const [completed] = await database.client`select count(*)::int as count from research_stage_runs where run_id = ${runId} and stage = 'product_truth' and status = 'completed'`;
    expect(completed?.count).toBe(1);
  } finally { await database.close(); }
});

}
