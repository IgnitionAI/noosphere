export {};

const email = requiredEnvironment("BOOTSTRAP_OWNER_EMAIL");
const password = requiredEnvironment("BOOTSTRAP_OWNER_PASSWORD");
const apiUrl = process.env.OUTBOUND_API_URL ?? "http://127.0.0.1:3001";
const webUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

await waitFor(`${apiUrl}/health/ready`);
await waitFor(`${webUrl}/login`);

const signIn = await fetch(`${webUrl}/api/auth/sign-in/email`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: new URL(webUrl).origin,
  },
  body: JSON.stringify({ email, password }),
});
if (!signIn.ok) throw new Error(`Development sign-in failed: ${signIn.status}`);
const cookie = signIn.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("Development sign-in did not return a session cookie");

const workspacesResponse = await fetch(`${apiUrl}/api/v1/workspaces`, {
  headers: { cookie },
});
if (!workspacesResponse.ok) {
  throw new Error(`Workspace lookup failed: ${workspacesResponse.status}`);
}
const workspaces = (await workspacesResponse.json()) as {
  data: Array<{ id: string; slug: string; role: string }>;
};
const workspace = workspaces.data[0];
if (!workspace || workspace.role !== "owner") {
  throw new Error("Development owner workspace is unavailable");
}

const headers = {
  cookie,
  "x-workspace-slug": workspace.slug,
  "content-type": "application/json",
};
const membersResponse = await fetch(`${apiUrl}/api/v1/workspaces/${workspace.id}/members`, {
  headers,
});
if (!membersResponse.ok) {
  throw new Error(`Workspace members lookup failed: ${membersResponse.status}`);
}
const channelLimitsResponse = await fetch(`${apiUrl}/api/v1/workspaces/${workspace.id}/channel-limits`, {
  headers,
});
if (!channelLimitsResponse.ok) {
  throw new Error(`Workspace channel limits lookup failed: ${channelLimitsResponse.status}`);
}
const knowledgeSourcesResponse = await fetch(`${apiUrl}/api/v1/knowledge-sources`, { headers });
if (!knowledgeSourcesResponse.ok) {
  throw new Error(`Knowledge sources lookup failed: ${knowledgeSourcesResponse.status}`);
}
const evaluationDatasetsResponse = await fetch(`${apiUrl}/api/v1/evaluation-datasets`, { headers });
if (!evaluationDatasetsResponse.ok) {
  throw new Error(`Evaluation datasets lookup failed: ${evaluationDatasetsResponse.status}`);
}
const aiConfigurationsResponse = await fetch(`${apiUrl}/api/v1/ai-configurations`, { headers });
if (!aiConfigurationsResponse.ok) {
  throw new Error(`AI configurations lookup failed: ${aiConfigurationsResponse.status}`);
}
const consoleJobsResponse = await fetch(`${apiUrl}/api/v1/console/jobs`, { headers });
if (!consoleJobsResponse.ok) {
  throw new Error(`Operator console jobs lookup failed: ${consoleJobsResponse.status}`);
}
const calendarBookingsResponse = await fetch(`${apiUrl}/api/v1/calendar-bookings`, { headers });
if (!calendarBookingsResponse.ok) throw new Error(`Calendar bookings lookup failed: ${calendarBookingsResponse.status}`);
const calendarMeetingTypesResponse = await fetch(`${apiUrl}/api/v1/calendar-connection/meeting-types`, { headers });
if (!calendarMeetingTypesResponse.ok) throw new Error(`Calendar meeting types lookup failed: ${calendarMeetingTypesResponse.status}`);
const onboardingResponse = await fetch(`${apiUrl}/api/v1/workspaces/${workspace.id}/onboarding`, { headers });
if (!onboardingResponse.ok) throw new Error(`Workspace onboarding lookup failed: ${onboardingResponse.status}`);
const onboarding = await onboardingResponse.json() as { steps: unknown[]; currentStep: string | null };
if (onboarding.steps.length !== 7) throw new Error("Workspace onboarding must expose seven persisted steps");
const missingConversationResponse = await fetch(
  `${apiUrl}/api/v1/conversations/${crypto.randomUUID()}`,
  { headers },
);
const missingConversation = await missingConversationResponse.json() as { code?: string };
if (missingConversationResponse.status !== 404 || missingConversation.code !== "CONVERSATION_NOT_FOUND") {
  throw new Error(`Conversation detail routing failed: ${missingConversationResponse.status}`);
}
const settingsResponse = await fetch(`${apiUrl}/api/v1/workspace-ai-settings`, {
  headers,
});
if (!settingsResponse.ok) {
  throw new Error(`AI settings lookup failed: ${settingsResponse.status}`);
}
const settings = (await settingsResponse.json()) as {
  researchModels: string[];
  synthesisModels: string[];
};
const saveResponse = await fetch(`${apiUrl}/api/v1/workspace-ai-settings`, {
  method: "PUT",
  headers,
  body: JSON.stringify({
    researchModels: settings.researchModels,
    synthesisModels: settings.synthesisModels,
  }),
});
if (!saveResponse.ok) {
  throw new Error(`AI settings update failed: ${saveResponse.status}`);
}

for (const resource of ["messaging-strategies", "ai-policies"] as const) {
  const response = await fetch(`${apiUrl}/api/v1/${resource}`, { headers });
  if (!response.ok) {
    throw new Error(`Messaging supervision lookup failed for ${resource}: ${response.status}`);
  }
}

const page = await fetch(`${webUrl}/w/${workspace.slug}/settings/ai`, {
  headers: { cookie },
});
const html = await page.text();
if (!page.ok || !html.includes("Modèles Kimi du workspace")) {
  throw new Error(`AI settings page smoke test failed: ${page.status}`);
}

const messagingPage = await fetch(`${webUrl}/w/${workspace.slug}/messaging`, {
  headers: { cookie },
});
const messagingHtml = await messagingPage.text();
if (!messagingPage.ok || messagingHtml.includes("Impossible de charger la stratégie")) {
  throw new Error(`Messaging supervision page smoke test failed: ${messagingPage.status}`);
}

const membersPage = await fetch(`${webUrl}/w/${workspace.slug}/settings/members`, {
  headers: { cookie },
});
const membersHtml = await membersPage.text();
if (!membersPage.ok || !membersHtml.includes("Équipe et accès")) {
  throw new Error(`Workspace members page smoke test failed: ${membersPage.status}`);
}

const workspaceSettingsPage = await fetch(`${webUrl}/w/${workspace.slug}/settings`, {
  headers: { cookie },
});
const workspaceSettingsHtml = await workspaceSettingsPage.text();
if (!workspaceSettingsPage.ok || !workspaceSettingsHtml.includes("Configuration")) {
  throw new Error(`Workspace settings page smoke test failed: ${workspaceSettingsPage.status}`);
}

let inboundAutopilotStatus = "not_configured";
const editorialStrategyResponse = await fetch(`${apiUrl}/api/v1/content/strategy`, { headers });
if (editorialStrategyResponse.ok) {
  const autopilotResponse = await fetch(`${apiUrl}/api/v1/content/autopilot`, { headers });
  if (!autopilotResponse.ok) throw new Error(`Inbound autopilot lookup failed: ${autopilotResponse.status}`);
  const autopilot = await autopilotResponse.json() as { enabled?: boolean };
  const inboundActivityPage = await fetch(`${webUrl}/w/${workspace.slug}/activity?lens=inbound`, { headers: { cookie } });
  const inboundActivityHtml = await inboundActivityPage.text();
  const expectedStatus = autopilot.enabled ? "Inbound actif" : "Inbound en pause";
  inboundAutopilotStatus = autopilot.enabled ? "active" : "paused";
  if (!inboundActivityPage.ok || !inboundActivityHtml.includes(expectedStatus)) {
    throw new Error(`Inbound activity status is not explicit: ${inboundActivityPage.status}`);
  }
  const ideasResponse = await fetch(`${apiUrl}/api/v1/content/ideas?limit=1`, { headers });
  if (!ideasResponse.ok) throw new Error(`Inbound ideas lookup failed: ${ideasResponse.status}`);
  const ideas = await ideasResponse.json() as { data?: Array<{ id?: string }> };
  const ideaId = ideas.data?.[0]?.id;
  if (ideaId) {
    const ideaPage = await fetch(`${webUrl}/w/${workspace.slug}/content/ideas/${ideaId}`, { headers: { cookie } });
    const ideaHtml = await ideaPage.text();
    const expectedJourneyState = autopilot.enabled ? "Automatique" : "L’Inbound est en pause";
    if (
      !ideaPage.ok
      || !ideaHtml.includes("Ce que Noosphere fait")
      || !ideaHtml.includes(expectedJourneyState)
    ) {
      throw new Error(`Inbound idea journey is not explicit: ${ideaPage.status}`);
    }
  }
}

const inboxPage = await fetch(`${webUrl}/w/${workspace.slug}/inbox`, {
  headers: { cookie },
});
const inboxHtml = await inboxPage.text();
const hasUnifiedInboxControls = [
  "Messages",
  "LinkedIn",
  "Email",
  "WhatsApp",
  "Campagne et hors campagne",
].every((marker) => inboxHtml.includes(marker));
if (!inboxPage.ok || !hasUnifiedInboxControls) {
  throw new Error(`Unified inbox page smoke test failed: ${inboxPage.status}`);
}

const prospectFilterResponse = await fetch(
  `${apiUrl}/api/v1/prospects?limit=10&campaignScope=outside_campaign`,
  { headers },
);
if (!prospectFilterResponse.ok) {
  throw new Error(`Prospect campaign-scope API smoke test failed: ${prospectFilterResponse.status}`);
}
const prospectFilterBody = await prospectFilterResponse.json() as {
  filters?: { campaigns?: unknown[] };
};
if (!Array.isArray(prospectFilterBody.filters?.campaigns)) {
  throw new Error("Prospect campaign filter options are unavailable");
}
const prospectsPage = await fetch(`${webUrl}/w/${workspace.slug}/prospects`, {
  headers: { cookie },
});
const prospectsHtml = await prospectsPage.text();
if (
  !prospectsPage.ok
  || !prospectsHtml.includes("Toutes les campagnes")
  || !prospectsHtml.includes("Hors campagne")
) {
  throw new Error(`Prospect campaign filters smoke test failed: ${prospectsPage.status}`);
}

const productReadingPage = await fetch(`${webUrl}/w/${workspace.slug}/strategy/product-reading`, {
  headers: { cookie },
});
const productReadingHtml = await productReadingPage.text();
if (
  !productReadingPage.ok ||
  !productReadingHtml.includes("Lancer mon ICP") ||
  !productReadingHtml.includes("Options avancées")
) {
  throw new Error(`Simple ICP launch page smoke test failed: ${productReadingPage.status}`);
}

const knowledgePage = await fetch(`${webUrl}/w/${workspace.slug}/knowledge`, {
  headers: { cookie },
});
const knowledgeHtml = await knowledgePage.text();
if (!knowledgePage.ok || !knowledgeHtml.includes("Sources de connaissance")) {
  throw new Error(`Knowledge page smoke test failed: ${knowledgePage.status}`);
}

const aiStudioPage = await fetch(`${webUrl}/w/${workspace.slug}/ai-studio`, {
  headers: { cookie },
});
const aiStudioHtml = await aiStudioPage.text();
if (!aiStudioPage.ok || !aiStudioHtml.includes("AI Studio")) {
  throw new Error(`AI Studio page smoke test failed: ${aiStudioPage.status}`);
}

const operatorConsolePage = await fetch(`${webUrl}/w/${workspace.slug}/settings/console`, { headers: { cookie } });
const operatorConsoleHtml = await operatorConsolePage.text();
if (!operatorConsolePage.ok || !operatorConsoleHtml.includes("Console opérateur")) {
  throw new Error(`Operator console page smoke test failed: ${operatorConsolePage.status}`);
}

const calendarSettingsPage = await fetch(`${webUrl}/w/${workspace.slug}/settings/calendar`, { headers: { cookie } });
const calendarSettingsHtml = await calendarSettingsPage.text();
if (!calendarSettingsPage.ok || !calendarSettingsHtml.includes("Agenda du Setter IA")) throw new Error(`Calendar settings page smoke test failed: ${calendarSettingsPage.status}`);

const onboardingPage = await fetch(`${webUrl}/onboarding?workspace=${workspace.slug}`, { headers: { cookie } });
const onboardingHtml = await onboardingPage.text();
if (!onboardingPage.ok || !onboardingHtml.includes("Configuration guidée") || !onboardingHtml.includes("7 étapes")) throw new Error(`Workspace onboarding page smoke test failed: ${onboardingPage.status}`);

console.info(
  JSON.stringify({
    event: "development_smoke_passed",
    workspaceSlug: workspace.slug,
    api: "ready",
    web: "ready",
    aiSettings: "read_write",
    messagingSupervision: "readable",
    workspaceMembers: "readable",
    workspaceDataSettings: "readable",
    knowledgeSources: "readable",
    aiStudio: "readable",
    operatorConsole: "readable",
    unifiedInbox: "readable",
    prospectCampaignFilters: "readable",
    inboundAutopilotStatus,
    simpleIcpLaunch: "readable",
    calendarProduct: "readable",
    workspaceOnboarding: "resumable",
  }),
);

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await fetch(url).catch(() => null);
    if (response?.ok) return;
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
