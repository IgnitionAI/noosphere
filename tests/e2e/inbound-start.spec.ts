import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const email = process.env.BOOTSTRAP_OWNER_EMAIL ?? "owner@ignition.local";
const password = process.env.BOOTSTRAP_OWNER_PASSWORD ?? "change-me-in-env";

test("draft strategy guides validation and stale start returns a readable refusal", async ({ page }) => {
  const url = process.env.DATABASE_URL!;
  if (!new URL(url).pathname.endsWith("_e2e")) throw new Error("Isolated E2E database required");
  const sql = postgres(url, { max: 1 });
  const workspace = randomUUID(), offer = randomUUID(), offerVersion = randomUUID(), icp = randomUUID(), icpVersion = randomUUID(), strategy = randomUUID();
  const slug = `inbound-${workspace}`;
  const snapshot = { audience: { name: "Équipes B2B", summary: "Validation du démarrage Inbound", awareness: "problem_aware" }, pillars: ["Preuve", "Méthode", "Sécurité"].map(name => ({ name, promise: "Comprendre la méthode de validation", proofTypes: ["documentation"] })), voice: { traits: ["direct", "précis"], avoid: ["promesses non sourcées"] }, formats: ["linkedin_text"], cadence: { postsPerWeek: 1, preferredDays: [1], timezone: "Europe/Paris" }, callsToAction: ["Échanger"], allowedClaimIds: [], forbiddenTopics: [] };
  try {
    const [owner] = await sql`select id from auth_users where email=${email}`;
    await sql`insert into workspaces (id,slug,name) values (${workspace},${slug},'Inbound regression')`;
    await sql`insert into workspace_members (workspace_id,user_id,role,status) values (${workspace},${owner!.id},'owner','active')`;
    await sql`insert into offers (id,workspace_id,name,category) values (${offer},${workspace},'Offre de test','service')`;
    await sql`insert into offer_versions (id,workspace_id,offer_id,version,name,category,value_proposition,target_audience,published_at) values (${offerVersion},${workspace},${offer},1,'Offre de test','service','Méthode de validation','Équipes B2B',now())`;
    await sql`insert into icps (id,workspace_id,name) values (${icp},${workspace},'ICP de test')`;
    await sql`insert into icp_versions (id,workspace_id,icp_id,version,name,confidence,criteria,buying_committee,problems,signals,exclusions,unknowns,unresolved_contradictions,blocked_findings,published_at) values (${icpVersion},${workspace},${icp},1,'ICP de test',0.9,'{}','{}','[]','[]','[]','[]','[]','[]',now())`;
    await sql`insert into editorial_strategies (id,workspace_id,name,offer_id,offer_version_id,icp_id,icp_version_id,draft,provider,model,prompt_version) values (${strategy},${workspace},'Stratégie de test',${offer},${offerVersion},${icp},${icpVersion},${sql.json(snapshot)},'fixture','fixture','test')`;
    await page.goto('/login');
    await page.getByLabel('Email professionnel').fill(email);
    await page.getByLabel('Mot de passe').fill(password);
    await page.getByRole('button',{name:'Accéder au workspace'}).click();
    await page.waitForURL(/\/w\//);
    const api = process.env.OUTBOUND_API_URL!;
    const connectionResponse = await page.request.post(`${api}/api/v1/instance/ai/connections`, { data: { name: slug, provider: "openrouter", apiKey: "isolated-inbound-fixture", models: [{ model: "controlled/inbound", reasoningEffort: "low" }] } });
    expect(connectionResponse.status()).toBe(201);
    const connection = await connectionResponse.json();
    await sql`update instance_ai_models set status='ready',tested_at=now() where connection_id=${connection.id}`;
    expect((await page.request.post(`${api}/api/v1/instance/ai/default`, { data: { connectionId: connection.id, model: "controlled/inbound" } })).status()).toBe(200);
    await page.goto(`/w/${slug}/activity?lens=inbound`);
    await expect(page.getByRole('link',{name:'Valider la stratégie',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Démarrer l’Inbound',exact:true})).toHaveCount(0);
    await expect(page.getByText('Votre stratégie est préparée : validez-la avant de démarrer l’Inbound.',{exact:true})).toBeVisible();
    await page.getByRole('link',{name:'Valider la stratégie',exact:true}).click();
    await page.getByRole('button',{name:'Activer la stratégie',exact:true}).click();
    await expect(page.getByRole('button',{name:'Publier une nouvelle version',exact:true})).toBeVisible();
    await page.goto(`/w/${slug}/activity?lens=inbound`);
    // The rendered button can become stale after a strategy is retired elsewhere.
    await sql`update editorial_strategies set status='draft',current_version=0 where id=${strategy}`;
    await page.getByRole('button',{name:'Démarrer l’Inbound',exact:true}).click();
    await expect(page.getByText('Vous devez valider la stratégie avant de démarrer l’Inbound.',{exact:true})).toBeVisible();
    await expect(page.getByText(/Minified React error/)).toHaveCount(0);
    await sql`update editorial_strategies set status='active',current_version=1 where id=${strategy}`;
    await page.reload();
    await page.getByRole('button',{name:'Démarrer l’Inbound',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Inbound actif',exact:true})).toBeVisible();
    // No workers or provider credentials are configured in this isolated suite.
    await page.reload();
    await expect(page.getByRole('heading',{name:'Inbound actif',exact:true})).toBeVisible();
  } finally { await sql.end(); }
});
