export {};

const email = requiredEnvironment("BOOTSTRAP_OWNER_EMAIL");
const password = requiredEnvironment("BOOTSTRAP_OWNER_PASSWORD");
const apiUrl = process.env.OUTBOUND_API_URL ?? "http://127.0.0.1:3001";
const webUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

const signIn = await fetch(`${webUrl}/api/auth/sign-in/email`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: new URL(webUrl).origin,
  },
  body: JSON.stringify({ email, password }),
});
if (!signIn.ok) throw new Error(`sign-in failed: ${signIn.status}`);
const cookie = signIn.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("no session cookie");

const workspacesResponse = await fetch(`${apiUrl}/api/v1/workspaces`, {
  headers: { cookie },
});
const workspaces = (await workspacesResponse.json()) as {
  data: Array<{ slug: string; role: string }>;
};
const workspace = workspaces.data[0];
if (!workspace) throw new Error("no workspace");

const headers = {
  cookie,
  "x-workspace-slug": workspace.slug,
  "content-type": "application/json",
};

const created = await fetch(`${apiUrl}/api/v1/product-research-runs`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    productUrl: "https://ignitionrag.com/",
    productName: "IgnitionRAG",
    description:
      "Plateforme de recherche et d'assistants IA sur les documents privés d'une organisation, avec gouvernance, sécurité et déploiement maîtrisé.",
    geography: "France",
    languages: ["fr", "en"],
    salesMotion: "hybrid",
    knownCompetitors: [],
    internalDocumentIds: [],
    depth: process.env.ICP_E2E_DEPTH ?? "quick",
    audienceGoal: "end_customers",
    buyerConstraints:
      "Prioriser les organisations avec des corpus propriétaires, des recherches documentaires récurrentes et sans équipe IA interne. Exclure ESN, agences, intégrateurs, revendeurs et équipes qui veulent construire elles-mêmes.",
    researchVersion: 2,
  }),
});
if (created.status !== 201 && created.status !== 200) {
  throw new Error(`create run failed: ${created.status} ${await created.text()}`);
}
const run = (await created.json()) as { id: string };
console.info(JSON.stringify({ event: "run_created", id: run.id }));

const started = await fetch(
  `${apiUrl}/api/v1/product-research-runs/${run.id}/actions/start`,
  { method: "POST", headers },
);
if (!started.ok) throw new Error(`start failed: ${started.status}`);
console.info(JSON.stringify({ event: "run_started" }));

const deadline = Date.now() + 45 * 60 * 1000;
let last = "";
while (Date.now() < deadline) {
  const response = await fetch(
    `${apiUrl}/api/v1/product-research-runs/${run.id}`,
    { headers },
  );
  const body = (await response.json()) as {
    status: string;
    activeStage: string | null;
    stages: Array<{
      stage: string;
      status: string;
      attempts: number;
      lastErrorCode: string | null;
    }>;
  };
  const summary = `${body.status} ${body.activeStage ?? "-"}`;
  if (summary !== last) {
    console.info(JSON.stringify({ event: "progress", ...body, stages: undefined }));
    for (const stage of body.stages) {
      console.info(
        JSON.stringify({
          stage: stage.stage,
          status: stage.status,
          attempts: stage.attempts,
          lastErrorCode: stage.lastErrorCode,
        }),
      );
    }
    last = summary;
  }
  if (["completed", "failed", "awaiting_review"].includes(body.status)) break;
  await Bun.sleep(5000);
}

const finalResponse = await fetch(
  `${apiUrl}/api/v1/product-research-runs/${run.id}`,
  { headers },
);
const finalBody = (await finalResponse.json()) as { status: string };
console.info(JSON.stringify({ event: "final", status: finalBody.status }));

if (finalBody.status === "completed" || finalBody.status === "awaiting_review") {
  const report = await fetch(
    `${apiUrl}/api/v1/product-research-runs/${run.id}/report`,
    { headers },
  );
  console.info(
    JSON.stringify({ event: "report_status", status: report.status }),
  );
  if (report.ok) {
    const body = (await report.json()) as Record<string, unknown>;
    console.info(JSON.stringify({ event: "report_keys", keys: Object.keys(body) }));
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
