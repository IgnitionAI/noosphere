import { appShell, initUI, initPretext, openDrawer } from "./core.js";
import { dashboardPage, approvalsPage, componentsPage, loginPage } from "./pages-overview.js";
import { prospectsPage, prospectDetailPage, prospectDetailDrawer, companiesPage } from "./pages-crm.js";
import { campaignsPage, campaignBuilderPage, campaignDetailPage, sequencesPage } from "./pages-campaigns.js";
import { inboxPage, pipelinePage } from "./pages-revenue.js";
import { knowledgePage, aiStudioPage, analyticsPage } from "./pages-intelligence.js";
import { integrationsPage, settingsPage, onboardingPage } from "./pages-admin.js";
import { offersPage, icpsPage, discoverPage, companyDetailPage } from "./pages-gtm.js";

const pages = {
  dashboard: [dashboardPage, {}],
  approvals: [approvalsPage, {}],
  prospects: [prospectsPage, {}],
  "prospect-detail": [prospectDetailPage, {}],
  companies: [companiesPage, {}],
  "company-detail": [companyDetailPage, {}],
  discover: [discoverPage, {}],
  offers: [offersPage, {}],
  icps: [icpsPage, {}],
  campaigns: [campaignsPage, {}],
  "campaign-builder": [campaignBuilderPage, {}],
  "campaign-detail": [campaignDetailPage, {}],
  sequences: [sequencesPage, {}],
  inbox: [inboxPage, { fullBleed:true }],
  pipeline: [pipelinePage, {}],
  knowledge: [knowledgePage, {}],
  "ai-studio": [aiStudioPage, {}],
  analytics: [analyticsPage, {}],
  integrations: [integrationsPage, {}],
  settings: [settingsPage, {}],
  components: [componentsPage, {}],
  login: [loginPage, { bare:true }],
  onboarding: [onboardingPage, { bare:true }]
};

const root = document.querySelector("#app");
const page = document.body.dataset.page || "dashboard";
const [render, options] = pages[page] || pages.dashboard;
root.innerHTML = appShell(page, render(), options);

initUI();
initPretext();

if (page === "prospects") {
  document.querySelectorAll("[data-prospect]").forEach(row => row.addEventListener("click", event => {
    if (event.target.closest("input,button,a")) return;
    openDrawer(prospectDetailDrawer(Number(row.dataset.prospect)));
  }));
}

if (page === "login" || page === "onboarding") {
  window.lucide?.createIcons();
}
