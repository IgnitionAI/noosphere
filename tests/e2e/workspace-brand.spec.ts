import { expect, test } from "@playwright/test";

test("brand edits survive direction generation and logo import failures", async ({ page }) => {
  const slug = process.env.BOOTSTRAP_WORKSPACE_SLUG ?? "ignition-ai";
  await page.goto("/login");
  await page.getByLabel("Email professionnel").fill(process.env.BOOTSTRAP_OWNER_EMAIL ?? "owner@ignition.local");
  await page.getByLabel("Mot de passe").fill(process.env.BOOTSTRAP_OWNER_PASSWORD ?? "change-me-in-env");
  await page.getByRole("button", { name: "Accéder au workspace" }).click();
  await page.waitForURL(/\/w\//);
  await page.goto(`/w/${slug}/settings/brand`);
  await page.getByLabel("Nom de marque", { exact: true }).fill("IgnitionAI");
  await page.getByLabel("Signature", { exact: true }).fill("Votre IA en production");
  await page.getByLabel("Décrivez l’univers").fill("Un cabinet de conseil en intelligence artificielle.");
  await page.getByRole("button", { name: "Créer la direction", exact: true }).click();
  // This test instance intentionally has no live AI provider or asset storage.
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByLabel("Nom de marque", { exact: true })).toHaveValue("IgnitionAI");
  await expect(page.getByLabel("Signature", { exact: true })).toHaveValue("Votre IA en production");
  await page.getByLabel("Nom de marque", { exact: true }).fill("Autre marque");
  await page.locator('input[type="file"]').setInputFiles({
    name: "logo.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"),
  });
  await page.getByRole("button", { name: "Importer", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByLabel("Nom de marque", { exact: true })).toHaveValue("Autre marque");
});
