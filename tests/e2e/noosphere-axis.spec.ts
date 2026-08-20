import { expect, test } from "@playwright/test";

const workspaceSlug = process.env.BOOTSTRAP_WORKSPACE_SLUG ?? "ignition-ai";
const email = process.env.BOOTSTRAP_OWNER_EMAIL ?? "owner@ignition.local";
const password = process.env.BOOTSTRAP_OWNER_PASSWORD ?? "change-me-in-env";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email professionnel").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Accéder au workspace" }).click();
  await expect(page.getByRole("heading", { name: "Aujourd’hui" })).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/?$`), { timeout: 20_000 });
});

test("the five destinations and Noosphere Axis remain GET-only", async ({ page }) => {
  const mutationRequests: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) mutationRequests.push(`${request.method()} ${request.url()}`);
  });

  const navigation = page.viewportSize()?.width === 390
    ? page.getByRole("navigation", { name: "Navigation mobile" })
    : page.getByRole("navigation", { name: "Navigation principale" });
  for (const label of ["Aujourd’hui", "Activité", "Prospects", "Conversations", "Appels"]) {
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

test("Inbound exposes its grounded editorial strategy without a provider mutation", async ({ page }) => {
  await page.getByRole("tab", { name: "Inbound" }).click();
  await page.getByRole("link", { name: "Préparer la stratégie" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/content/strategy`));
  await expect(page.getByRole("heading", { name: "Stratégie LinkedIn" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aucune stratégie dérivée" })).toBeVisible();
});

test("the Inbound idea radar is explicit, durable and never presented as a publisher", async ({ page }) => {
  await page.goto(`/w/${workspaceSlug}/content/ideas`);
  await expect(page.getByRole("heading", { name: "Idées sourcées" })).toBeVisible();
  await expect(page.getByText("Ce radar ne rédige et ne publie rien.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Relancer la recherche" })).toBeVisible();
});

test("Outbound surfaces preserve prospect and conversation filters in the URL", async ({ page }) => {
  const navigation = page.viewportSize()?.width === 390
    ? page.getByRole("navigation", { name: "Navigation mobile" })
    : page.getByRole("navigation", { name: "Navigation principale" });

  await navigation.getByRole("link", { name: "Prospects", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Prospects", exact: true })).toBeVisible();
  await page.locator('select[name="campaignScope"]').selectOption("outside_campaign");
  await page.getByLabel("Statut du contact").selectOption("active");
  await page.getByLabel("Période prospect").selectOption("30d");
  await page.getByRole("button", { name: "Filtrer" }).click();
  await expect(page).toHaveURL(/campaignScope=outside_campaign/);
  await expect(page).toHaveURL(/status=active/);
  await expect(page).toHaveURL(/period=30d/);

  await navigation.getByRole("link", { name: "Conversations", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Conversations", exact: true, level: 1 })).toBeVisible();
  await page.getByLabel("Canal", { exact: true }).selectOption("linkedin");
  await page.getByLabel("Origine", { exact: true }).selectOption("outside_campaign");
  await page.getByLabel("Période", { exact: true }).selectOption("7d");
  await page.getByRole("button", { name: "Filtrer" }).click();
  await expect(page).toHaveURL(/channel=linkedin/);
  await expect(page).toHaveURL(/scope=outside_campaign/);
  await expect(page).toHaveURL(/period=7d/);

  await navigation.getByRole("link", { name: "Appels", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Appels", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/scope=outside_campaign/);

  await page.goto(`/w/${workspaceSlug}/settings`);
  await expect(page.getByRole("heading", { name: "Configuration", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lancement guidé", exact: true })).toBeVisible();
});
