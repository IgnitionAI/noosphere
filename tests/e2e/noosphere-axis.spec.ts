import { expect, test } from "@playwright/test";

const workspaceSlug = process.env.BOOTSTRAP_WORKSPACE_SLUG ?? "ignition-ai";
const email = process.env.BOOTSTRAP_OWNER_EMAIL ?? "owner@ignition.local";
const password = process.env.BOOTSTRAP_OWNER_PASSWORD ?? "change-me-in-env";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email professionnel").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Accéder au workspace" }).click();
  await expect(page.getByRole("heading", { name: "Votre acquisition, en pilote automatique." })).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/?$`), { timeout: 20_000 });
});

test("the three product destinations remain GET-only", async ({ page }) => {
  const mutationRequests: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) mutationRequests.push(`${request.method()} ${request.url()}`);
  });

  const navigation = page.viewportSize()?.width === 390
    ? page.getByRole("navigation", { name: "Navigation mobile" })
    : page.getByRole("navigation", { name: "Navigation principale" });
  for (const label of ["Accueil", "Messages", "Appels"]) {
    await expect(navigation.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(navigation.getByRole("link", { name: "Activité", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Prospects", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);

  await navigation.getByRole("link", { name: "Messages", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/inbox`));
  await expect(page.getByRole("heading", { name: "Messages", exact: true })).toBeVisible();

  await navigation.getByRole("link", { name: "Appels", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/appointments`));
  await expect(page.getByRole("heading", { name: "Appels", exact: true })).toBeVisible();

  await navigation.getByRole("link", { name: "Accueil", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/?$`));
  await expect(page.getByRole("heading", { name: "Votre acquisition, en pilote automatique." })).toBeVisible();

  expect(mutationRequests).toEqual([]);
});

test("browser back restores the previous product destination", async ({ page }) => {
  const navigation = page.viewportSize()?.width === 390
    ? page.getByRole("navigation", { name: "Navigation mobile" })
    : page.getByRole("navigation", { name: "Navigation principale" });
  await navigation.getByRole("link", { name: "Messages", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/inbox`));
  await navigation.getByRole("link", { name: "Appels", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/appointments`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/inbox`));
  await expect(page.getByRole("heading", { name: "Messages", exact: true })).toBeVisible();
});

test("Inbound exposes its grounded editorial strategy without a provider mutation", async ({ page }) => {
  await page.goto(`/w/${workspaceSlug}/content/strategy`);
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/content/strategy`));
  await expect(page.getByRole("heading", { name: "Stratégie LinkedIn" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Aucune stratégie dérivée|Piliers éditoriaux/ })).toBeVisible();
  if (await page.getByRole("button", { name: "2 / jour" }).count()) {
    await expect(page.getByRole("button", { name: "2 / jour" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Créneau 1")).toHaveValue("09:00");
    await expect(page.getByLabel("Créneau 2")).toHaveValue("17:00");
  }
});

test("workspace surfaces keep one clear heading and never overflow the viewport", async ({ page }) => {
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) mutations.push(`${request.method()} ${request.url()}`);
  });
  const routes = [
    "",
    "/activity?lens=inbound",
    "/activity?lens=symbiosis",
    "/activity?lens=outbound",
    "/inbox",
    "/appointments",
    "/campaigns",
    "/prospects",
    "/pipeline",
    "/content/strategy",
    "/content/ideas",
    "/content/calendar",
    "/settings",
    "/settings/channels",
    "/settings/automation",
    "/settings/calendar",
    "/settings/members",
    "/offers",
    "/icps",
    "/knowledge",
    "/analytics",
    "/attribution",
    "/companies",
    "/sequences",
    "/suppressions",
    "/imports",
  ];
  for (const route of routes) {
    await page.goto(`/w/${workspaceSlug}${route}`);
    await expect(page.locator("h1")).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${route || "/"} overflows horizontally`).toBeLessThanOrEqual(1);
  }
  expect(mutations).toEqual([]);
});

test("the Inbound idea radar is explicit, durable and never presented as a publisher", async ({ page }) => {
  await page.goto(`/w/${workspaceSlug}/content/ideas`);
  await expect(page.getByRole("heading", { name: "Idées sourcées" })).toBeVisible();
  await expect(page.getByText("Ce radar ne rédige et ne publie rien.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Relancer la recherche" })).toBeVisible();
});

test("the LinkedIn publication calendar exposes durable state without a provider mutation", async ({ page }) => {
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) mutations.push(`${request.method()} ${request.url()}`);
  });
  await page.goto(`/w/${workspaceSlug}/content/calendar`);
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/content/calendar`));
  await expect(page.getByRole("heading", { name: "Publications LinkedIn" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Posts observés sur le compte" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Synchronisation LinkedIn" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Commentaires, réponses et réactions" })).toBeVisible();
  await expect(page.getByText("Une réaction seule ne déclenche aucun message.")).toBeVisible();
  await page.getByRole("link", { name: "Parcours attribués" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/attribution`));
  await expect(page.getByRole("heading", { name: "Parcours attribués" })).toBeVisible();
  expect(mutations).toEqual([]);
});

test("Outbound surfaces preserve prospect and conversation filters in the URL", async ({ page }) => {
  const navigation = page.viewportSize()?.width === 390
    ? page.getByRole("navigation", { name: "Navigation mobile" })
    : page.getByRole("navigation", { name: "Navigation principale" });

  await page.goto(`/w/${workspaceSlug}/prospects`);
  await expect(page.getByRole("heading", { name: "Prospects", exact: true })).toBeVisible();
  await page.locator('select[name="campaignScope"]').selectOption("outside_campaign");
  await page.getByLabel("Statut du contact").selectOption("active");
  await page.getByLabel("Période prospect").selectOption("30d");
  await page.getByRole("button", { name: "Filtrer" }).click();
  await expect(page).toHaveURL(/campaignScope=outside_campaign/);
  await expect(page).toHaveURL(/status=active/);
  await expect(page).toHaveURL(/period=30d/);

  await navigation.getByRole("link", { name: "Messages", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Messages", exact: true, level: 1 })).toBeVisible();
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
