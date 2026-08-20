import { expect, test } from "@playwright/test";

const workspaceSlug = process.env.BOOTSTRAP_WORKSPACE_SLUG ?? "ignition-ai";
const email = process.env.BOOTSTRAP_OWNER_EMAIL ?? "owner@ignition.local";
const password = process.env.BOOTSTRAP_OWNER_PASSWORD ?? "change-me-in-env";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email professionnel").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Accéder au workspace" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/?$`));
  await expect(page.getByRole("heading", { name: "Aujourd’hui" })).toBeVisible();
});

test("the five destinations and Noosphere Axis remain GET-only", async ({ page, isMobile }) => {
  const mutationRequests: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) mutationRequests.push(`${request.method()} ${request.url()}`);
  });

  const navigation = page.getByRole("navigation", { name: isMobile ? "Navigation mobile" : "Navigation principale" });
  for (const label of ["Aujourd’hui", "Activité", "Prospects", isMobile ? "Messages" : "Conversations", "Appels"]) {
    await expect(navigation.getByRole("link", { name: label, exact: true })).toBeVisible();
  }

  await page.getByRole("tab", { name: "Inbound" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/activity\\?lens=inbound`));
  await expect(page.getByRole("heading", { name: "Créer la demande" })).toBeVisible();

  await page.getByRole("tab", { name: "Symbiose" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/activity\\?lens=symbiosis`));
  await expect(page.getByRole("heading", { name: "Relier contenu et revenu" })).toBeVisible();

  await page.getByRole("tab", { name: "Outbound" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/activity\\?lens=outbound`));
  await expect(page.getByRole("heading", { name: "Capter la demande" })).toBeVisible();

  expect(mutationRequests).toEqual([]);
});

test("browser back restores the previous lens without losing URL state", async ({ page }) => {
  await page.getByRole("tab", { name: "Inbound" }).click();
  await expect(page).toHaveURL(new RegExp("lens=inbound"));
  await page.getByRole("tab", { name: "Outbound" }).click();
  await expect(page).toHaveURL(new RegExp("lens=outbound"));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp("lens=inbound"));
  await expect(page.getByRole("tab", { name: "Inbound" })).toHaveAttribute("aria-selected", "true");
});
