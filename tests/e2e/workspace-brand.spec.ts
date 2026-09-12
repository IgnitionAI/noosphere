import { expect, test } from "@playwright/test";

test("brand edits survive direction generation and logo import failures", async ({ page }) => {
  const failedRequests: string[] = [];
  await page.route("**/settings/brand", async route => {
    const request = route.request();
    if (request.method() === "POST" && request.postData()?.includes('"useLogo":')) {
      failedRequests.push("direction");
      await route.abort("failed");
    } else if (request.method() === "POST" && request.headers()["content-type"]?.startsWith("multipart/form-data")) {
      failedRequests.push("logo");
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });
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
  // Fail only the subsequent direction/upload request; the preceding save uses the real API.
  await expect(page.locator("fieldset").getByRole("alert")).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByLabel("Nom de marque", { exact: true })).toHaveValue("IgnitionAI");
  await expect(page.getByLabel("Signature", { exact: true })).toHaveValue("Votre IA en production");
  await page.getByLabel("Nom de marque", { exact: true }).fill("Autre marque");
  await page.locator('input[type="file"]').setInputFiles({
    name: "logo.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"),
  });
  await page.getByRole("button", { name: "Importer", exact: true }).click();
  await expect(page.locator("fieldset").getByRole("alert")).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByLabel("Nom de marque", { exact: true })).toHaveValue("Autre marque");
  expect(failedRequests).toEqual(["direction", "logo"]);
});
