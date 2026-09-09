import { expect, test } from "@playwright/test";
import { createDatabase } from "@outbound/infrastructure/database/client";

test("console resumes a paused task only after its pinned connection is ready", async ({ page }) => {
  const database = createDatabase(process.env.TEST_DATABASE_URL!);
  const api = process.env.OUTBOUND_API_URL!;
  try {
    await page.goto("/login");
    await page.getByLabel("Email professionnel").fill(process.env.BOOTSTRAP_OWNER_EMAIL ?? "owner@ignition.local");
    await page.getByLabel("Mot de passe").fill(process.env.BOOTSTRAP_OWNER_PASSWORD ?? "change-me-in-env");
    await page.getByRole("button", { name: "Accéder au workspace" }).click();
    await page.waitForURL(/\/w\//);
    const connectionResponse = await page.request.post(`${api}/api/v1/instance/ai/connections`, { data: { name: "Resume fixture", provider: "openrouter", apiKey: "resume-secret-never-visible", models: [{ model: "controlled/original", reasoningEffort: "low" }] } });
    expect(connectionResponse.status()).toBe(201);
    const connection = await connectionResponse.json();
    // Controlled connection proof; no external provider call in this browser scenario.
    await database.client`update instance_ai_models set status = 'ready', tested_at = now() where connection_id = ${connection.id}`;
    expect((await page.request.post(`${api}/api/v1/instance/ai/default`, { data: { connectionId: connection.id, model: "controlled/original" } })).status()).toBe(200);
    const response = await page.request.post(`${api}/api/v1/workspaces`, { data: { name: `Resume ${crypto.randomUUID()}` } });
    expect(response.status()).toBe(201);
    const workspace = await response.json();
    const [row] = await database.client`select id from workspaces where slug = ${workspace.slug}`;
    const id = crypto.randomUUID();
    await database.client`insert into jobs(id, workspace_id, type, payload, idempotency_key, correlation_id, status, max_attempts, available_at, ai_pause_capability, last_error_code) values (${id}, ${row!.id}, 'content.generate', '{}'::jsonb, ${id}, ${id}, 'paused', 5, now(), 'message_generation', 'AI_PROVIDER_QUOTA_EXHAUSTED')`;
    await database.client`update instance_ai_models set status = 'failed' where connection_id = ${connection.id}`;
    await page.goto(`/w/${workspace.slug}/settings/console`);
    await expect(page.getByText("1 intervention nécessaire", { exact: true })).toBeVisible();
    await expect(page.getByText("En pause", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reprendre", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Le modèle choisi pour cette tâche n’est pas disponible" })).toBeVisible();
    const [paused] = await database.client`select status from jobs where id = ${id}`;
    expect(paused?.status).toBe("paused");
    await database.client`update instance_ai_models set status = 'ready' where connection_id = ${connection.id}`;
    await page.getByRole("button", { name: "Reprendre", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Traitement remis en file");
    const [resumed] = await database.client`select status, ai_policy from jobs where id = ${id}`;
    expect(resumed?.status).toBe("pending");
    expect(resumed?.ai_policy.defaultRoutes[0].model).toBe("controlled/original");
    const eventId = crypto.randomUUID();
    const fallback = { correlationId: id, primary: { provider: "openai-api", model: "primary" }, selected: { provider: "openrouter", model: "controlled/original" }, reason: "AI_PROVIDER_QUOTA_EXHAUSTED" };
    await database.client`insert into outbox_events(id, workspace_id, aggregate_type, aggregate_id, event_type, payload, available_at) values (${eventId}, ${row!.id}, 'job', ${id}, 'AiFallbackUsed', ${JSON.stringify(fallback)}::jsonb, now())`;
    await page.goto(`/w/${workspace.slug}/settings/console?correlationId=${id}`);
    await expect(page.getByText("Secours IA : openrouter / controlled/original · quota épuisé · principal : openai-api / primary", { exact: true })).toBeVisible();
    expect(await page.content()).not.toContain("resume-secret-never-visible");
  } finally { await database.close(); }
});
