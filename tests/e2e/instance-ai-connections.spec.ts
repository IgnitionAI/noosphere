import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { createDatabase } from "@outbound/infrastructure/database/client";

test("administrator saves and tests a connection, chooses its default and starts a research mission", async ({ page }) => {
  let calls = 0;
  const provider = createServer(async (request, response) => {
    calls++;
    let raw = "";
    for await (const chunk of request) raw += chunk.toString();
    const body = JSON.parse(raw);
    expect(request.headers.authorization).toBe("Bearer e2e-controlled-key");
    expect(body.model).toBe("e2e-controlled-model");
    const name = body.tools[0].name;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ output: [{ type: "function_call", name, arguments: '{"ok":true}' }] }));
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("PROVIDER_TEST_PORT_MISSING");
  const database = createDatabase(process.env.TEST_DATABASE_URL!);
  try {
    await page.goto("/login");
    await page.getByLabel("Email professionnel").fill(process.env.BOOTSTRAP_OWNER_EMAIL ?? "owner@ignition.local");
    await page.getByLabel("Mot de passe").fill(process.env.BOOTSTRAP_OWNER_PASSWORD ?? "change-me-in-env");
    await page.getByRole("button", { name: "Accéder au workspace" }).click();
    await page.waitForURL(/\/w\//);
    await page.goto("/setup");
    const name = `OpenAI E2E ${crypto.randomUUID()}`;
    const form = page.getByRole("heading", { name: "Ajouter une connexion OpenAI" }).locator("..");
    await form.getByLabel("Nom de la connexion").fill(name);
    await form.getByLabel("Clé API OpenAI").fill("e2e-controlled-key");
    await form.getByLabel("Modèles autorisés").fill("e2e-controlled-model");
    await form.getByRole("button", { name: "Enregistrer la connexion" }).click();
    const section = page.getByRole("heading", { name, exact: true }).locator("..");
    await expect(section.getByText("À tester", { exact: true })).toBeVisible();
    expect(calls).toBe(0);
    expect(await page.content()).not.toContain("e2e-controlled-key");
    // Replace only this untested fixture's endpoint. Production OpenAI URLs remain fixed.
    // The browser/API flow, encrypted key, probe HTTP and default selection remain real.
    const [connection] = await database.client`select id from instance_ai_connections where name = ${name}`;
    await database.client`update instance_ai_connections set base_url = ${`http://127.0.0.1:${address.port}`} where id = ${connection!.id}`;
    await section.getByRole("button", { name: "Tester e2e-controlled-model" }).click();
    await expect(section.getByText("Test réussi", { exact: true })).toBeVisible();
    expect(calls).toBe(1);
    await section.getByRole("button", { name: "Utiliser par défaut" }).click();
    await expect(section.getByText("Par défaut", { exact: true })).toBeVisible();
    const workspaceResponse = await page.request.post(`${process.env.OUTBOUND_API_URL}/api/v1/workspaces`, { data: { name: `Connected ${crypto.randomUUID()}` } });
    expect(workspaceResponse.status()).toBe(201);
    const { slug } = await workspaceResponse.json();
    const created = await page.request.post(`${process.env.OUTBOUND_API_URL}/api/v1/product-research-runs`, { headers: { "x-workspace-slug": slug }, data: { productUrl: "https://example.com", productName: "Connected research", description: "", geography: "France", languages: ["fr"], salesMotion: "saas", knownCompetitors: [], internalDocumentIds: [], depth: "standard", researchVersion: 2 } });
    expect(created.status()).toBe(201);
    const run = await created.json();
    await page.goto(`/w/${slug}/research/${run.id}`);
    await page.getByRole("button", { name: /Démarrer/ }).click();
    await expect.poll(async () => {
      const response = await page.request.get(`${process.env.OUTBOUND_API_URL}/api/v1/product-research-runs/${run.id}`, { headers: { "x-workspace-slug": slug } });
      return (await response.json()).status;
    }).toBe("queued");
    await expect(page.getByText("Votre brouillon est conservé", { exact: false })).toHaveCount(0);
  } finally {
    await database.close();
    await new Promise<void>((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
  }
});
