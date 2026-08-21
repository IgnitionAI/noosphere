import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  LINKEDIN_CANARY_CONFIRMATION,
  assertLinkedinCanaryAuthorization,
  evaluateLinkedinCanary,
  type LinkedinCanaryEvidence,
} from "@outbound/application/product-truth/linkedin-canary";
import { UnipileSocialPublisher } from "@outbound/infrastructure/content/unipile-social-publisher";
import { PostgresSocialProspectSignalReader } from "@outbound/infrastructure/crm/postgres-social-prospect-signal-reader";
import { createDatabase } from "@outbound/infrastructure/database/client";

type Mode = "preflight" | "publish" | "verify";

interface GroundingRow {
  workspace_id: string;
  strategy_version_id: string;
  strategy_status: string;
  idea_id: string;
  source_count: number;
  brief_id: string;
  asset_id: string;
  asset_status: string;
  asset_version_id: string;
  asset_ready: boolean;
  body: string;
}

interface AccountRow {
  provider_account_id: string;
  connected_account_id: string | null;
  status: string | null;
}

interface PublicationRow {
  id: string;
  status: string;
  provider_post_id: string | null;
  provider_url: string | null;
  provider_account_id: string | null;
  attempt_count: number;
  duplicate_provider_post_count: number;
}

interface InteractionRow {
  interaction_id: string;
  provider_interaction_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  response_provider_message_id: string | null;
  booking_id: string | null;
  booking_touch_id: string | null;
}

const mode = parseMode(process.env.NOOSPHERE_PTC_MODE ?? "preflight");
const workspaceSlug = requiredEnvironment("NOOSPHERE_PTC_WORKSPACE_SLUG");
const assetId = requiredEnvironment("NOOSPHERE_PTC_ASSET_ID");
const authorizedAccountId = requiredEnvironment("NOOSPHERE_PTC_AUTHORIZED_ACCOUNT_ID");
const authorizedContentHash = requiredEnvironment("NOOSPHERE_PTC_AUTHORIZED_CONTENT_SHA256").toLowerCase();
const runId = process.env.NOOSPHERE_PTC_RUN_ID ?? crypto.randomUUID();
const reportPath = process.env.NOOSPHERE_PTC_REPORT_PATH ?? `/tmp/noosphere-ptc-${runId}.json`;
const database = createDatabase(requiredEnvironment("DATABASE_URL"));

try {
  const grounding = await loadGrounding();
  const selectedContentHash = sha256(grounding.body);
  const account = await loadAccount(grounding.workspace_id);
  const authorization = {
    confirmation: process.env.NOOSPHERE_PTC_CONFIRM ?? "",
    authorizedAccountId,
    selectedAccountId: account.provider_account_id,
    authorizedContentHash,
    selectedContentHash,
  };
  const authorizationMatches = authorization.authorizedAccountId === authorization.selectedAccountId
    && authorization.authorizedContentHash === authorization.selectedContentHash;

  assertPreflight(grounding, account, authorizationMatches);
  await observeProviderCapability(account.provider_account_id);

  let publicationId = process.env.NOOSPHERE_PTC_PUBLICATION_ID ?? null;
  if (mode === "publish") {
    assertLinkedinCanaryAuthorization(authorization);
    publicationId = await schedulePublication();
    await waitForPublication(publicationId);
  }

  const publication = publicationId ? await loadPublication(grounding.workspace_id, publicationId) : null;
  if (publication?.provider_account_id && publication.provider_account_id !== authorizedAccountId) {
    throw new Error("LINKEDIN_CANARY_PUBLICATION_ACCOUNT_MISMATCH");
  }
  const interaction = publication ? await loadInteraction(grounding.workspace_id, publication.id) : null;
  const socialSignalEligible = interaction?.contact_id
    ? (await new PostgresSocialProspectSignalReader(database.db).read({
        workspaceId: grounding.workspace_id,
        contactId: interaction.contact_id,
        baseScore: null,
        now: new Date(),
      })).eligibleSignals.some((signal) => signal.id === interaction.interaction_id)
    : false;
  const authorizationConfirmed = process.env.NOOSPHERE_PTC_CONFIRM === LINKEDIN_CANARY_CONFIRMATION
    && authorizationMatches;
  const evidence: LinkedinCanaryEvidence = {
    execution: publication?.provider_post_id && authorizationConfirmed ? "real" : "simulated",
    authorizationConfirmed,
    strategyVersionId: grounding.strategy_version_id,
    ideaId: grounding.idea_id,
    sourceCount: grounding.source_count,
    briefId: grounding.brief_id,
    assetVersionId: grounding.asset_version_id,
    contentHash: selectedContentHash,
    accountId: publication?.provider_account_id ?? account.provider_account_id,
    publicationId: publication?.id ?? null,
    providerPostId: publication?.provider_post_id ?? null,
    providerUrl: publication?.provider_url ?? null,
    publicationAttemptCount: publication?.attempt_count ?? 0,
    duplicateProviderPostCount: publication?.duplicate_provider_post_count ?? 0,
    restartObserved: process.env.NOOSPHERE_PTC_RESTART_PROOF === publication?.id,
    interactionId: interaction?.interaction_id ?? null,
    providerInteractionId: interaction?.provider_interaction_id ?? null,
    contactId: interaction?.contact_id ?? null,
    socialSignalEligible,
    conversationId: interaction?.conversation_id ?? null,
    responseProviderMessageId: interaction?.response_provider_message_id ?? null,
    bookingId: interaction?.booking_id ?? null,
    bookingAttributionTouchId: interaction?.booking_touch_id ?? null,
  };
  const verdict = evaluateLinkedinCanary(evidence);
  const report = {
    contractId: verdict.contractId,
    runId,
    mode,
    generatedAt: new Date().toISOString(),
    workspaceId: grounding.workspace_id,
    workspaceSlug,
    assetId,
    publicationId,
    evidence,
    verdict,
    safeguards: {
      exactAccountMatched: account.provider_account_id === authorizedAccountId,
      exactContentHashMatched: selectedContentHash === authorizedContentHash,
      providerAccountStatus: account.status,
      bodyPersistedInReport: false,
      secretsPersistedInReport: false,
    },
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.info(JSON.stringify({
    event: "linkedin_product_truth_canary_evaluated",
    contractId: verdict.contractId,
    state: verdict.state,
    publicationId,
    reportPath,
  }));
  if (mode === "verify" && verdict.state !== "product_verified") process.exitCode = 2;
} finally {
  await database.close();
}

async function loadGrounding(): Promise<GroundingRow> {
  const rows = await database.client<GroundingRow[]>`
    select
      w.id as workspace_id,
      esv.id as strategy_version_id,
      es.status::text as strategy_status,
      ci.id as idea_id,
      (select count(*)::int from content_idea_sources cis where cis.workspace_id = w.id and cis.idea_id = ci.id) as source_count,
      cb.id as brief_id,
      ca.id as asset_id,
      ca.status as asset_status,
      cav.id as asset_version_id,
      cav.ready as asset_ready,
      cav.body
    from workspaces w
    join content_assets ca on ca.workspace_id = w.id and ca.id = ${assetId}
    join content_asset_versions cav on cav.workspace_id = ca.workspace_id and cav.asset_id = ca.id and cav.version = ca.latest_version
    join content_briefs cb on cb.workspace_id = cav.workspace_id and cb.id = cav.brief_id
    join content_ideas ci on ci.workspace_id = ca.workspace_id and ci.id = ca.idea_id
    join editorial_strategy_versions esv on esv.workspace_id = ci.workspace_id and esv.id = ci.strategy_version_id
    join editorial_strategies es on es.workspace_id = esv.workspace_id and es.id = esv.strategy_id
    where w.slug = ${workspaceSlug} and w.status = 'active' and w.deleted_at is null
    limit 1
  `;
  if (!rows[0]) throw new Error("LINKEDIN_CANARY_GROUNDED_ASSET_NOT_FOUND");
  return rows[0];
}

async function loadAccount(workspaceId: string): Promise<AccountRow> {
  const rows = await database.client<AccountRow[]>`
    select
      wca.provider_account_id,
      ca.id as connected_account_id,
      ca.status::text as status
    from workspace_channel_accounts wca
    left join connected_accounts ca
      on ca.workspace_id = wca.workspace_id
      and ca.provider = wca.provider
      and ca.provider_account_id = wca.provider_account_id
    where wca.workspace_id = ${workspaceId} and wca.channel = 'linkedin'
    limit 1
  `;
  if (!rows[0]) throw new Error("LINKEDIN_CANARY_ACCOUNT_NOT_SELECTED");
  return rows[0];
}

function assertPreflight(grounding: GroundingRow, account: AccountRow, authorizationMatches: boolean): void {
  if (grounding.strategy_status !== "active") throw new Error("LINKEDIN_CANARY_STRATEGY_NOT_ACTIVE");
  if (grounding.source_count < 1) throw new Error("LINKEDIN_CANARY_IDEA_NOT_SOURCED");
  if (grounding.asset_status !== "ready" || !grounding.asset_ready) throw new Error("LINKEDIN_CANARY_ASSET_NOT_READY");
  if (account.status !== "connected") throw new Error("LINKEDIN_CANARY_ACCOUNT_NOT_CONNECTED");
  if (!authorizationMatches) throw new Error("LINKEDIN_CANARY_AUTHORIZATION_MISMATCH");
}

async function observeProviderCapability(accountId: string): Promise<void> {
  const dsn = requiredEnvironment("UNIPILE_DSN");
  const apiKey = requiredEnvironment("UNIPILE_API_KEY");
  const capability = await new UnipileSocialPublisher({ dsn, apiKey }).observeCapabilities({ accountId });
  if (!capability.accountHealthy || capability.textPublishing !== "available") {
    throw new Error("LINKEDIN_CANARY_PROVIDER_CAPABILITY_UNAVAILABLE");
  }
}

async function schedulePublication(): Promise<string> {
  const apiUrl = process.env.OUTBOUND_API_URL ?? "http://127.0.0.1:3001";
  const cookie = await sessionCookie();
  const response = await fetch(`${apiUrl}/api/v1/content/assets/${assetId}/schedule`, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      "x-workspace-slug": workspaceSlug,
    },
    body: JSON.stringify({
      requestKey: `ptc-101:${runId}:publication`,
      scheduledFor: new Date(Date.now() + 5_000).toISOString(),
    }),
  });
  if (!response.ok) throw new Error(`LINKEDIN_CANARY_SCHEDULE_FAILED:${response.status}:${await safeDetail(response)}`);
  const body = await response.json() as { id?: unknown };
  if (typeof body.id !== "string") throw new Error("LINKEDIN_CANARY_PUBLICATION_ID_MISSING");
  return body.id;
}

async function waitForPublication(publicationId: string): Promise<void> {
  const deadline = Date.now() + positiveIntegerEnvironment("NOOSPHERE_PTC_PUBLISH_TIMEOUT_MS", 10 * 60_000);
  while (Date.now() < deadline) {
    const row = await loadPublicationById(publicationId);
    if (["published", "unknown", "failed", "cancelled"].includes(row?.status ?? "")) return;
    await Bun.sleep(2_000);
  }
  throw new Error("LINKEDIN_CANARY_PUBLICATION_TIMEOUT");
}

async function loadPublication(workspaceId: string, publicationId: string): Promise<PublicationRow | null> {
  const rows = await database.client<PublicationRow[]>`
    select
      p.id,
      p.status,
      coalesce(p.provider_post_id, (select sci.provider_post_id from social_content_items sci where sci.workspace_id = p.workspace_id and sci.publication_id = p.id order by sci.last_seen_at desc limit 1)) as provider_post_id,
      coalesce(p.provider_url, (select sci.url from social_content_items sci where sci.workspace_id = p.workspace_id and sci.publication_id = p.id and sci.url is not null order by sci.last_seen_at desc limit 1)) as provider_url,
      p.account_snapshot->>'providerAccountId' as provider_account_id,
      (select count(*)::int from content_publication_attempts a where a.workspace_id = p.workspace_id and a.publication_id = p.id) as attempt_count,
      greatest((select count(distinct sci.provider_post_id)::int - 1 from social_content_items sci where sci.workspace_id = p.workspace_id and sci.publication_id = p.id), 0) as duplicate_provider_post_count
    from content_publications p
    where p.workspace_id = ${workspaceId} and p.id = ${publicationId}
    limit 1
  `;
  if (!rows[0]) throw new Error("LINKEDIN_CANARY_PUBLICATION_NOT_FOUND");
  return rows[0];
}

async function loadPublicationById(publicationId: string): Promise<Pick<PublicationRow, "status"> | null> {
  const rows = await database.client<Array<Pick<PublicationRow, "status">>>`
    select status from content_publications where id = ${publicationId} limit 1
  `;
  return rows[0] ?? null;
}

async function loadInteraction(workspaceId: string, publicationId: string): Promise<InteractionRow | null> {
  const rows = await database.client<InteractionRow[]>`
    select
      si.id as interaction_id,
      si.provider_interaction_id,
      identity_touch.contact_id,
      conversation_touch.conversation_id,
      response.provider_message_id as response_provider_message_id,
      booking_touch.booking_id,
      booking_touch.id as booking_touch_id
    from social_content_items sci
    join social_interactions si
      on si.workspace_id = sci.workspace_id
      and si.social_content_id = sci.id
      and si.status = 'observed'
      and si.direction = 'incoming'
      and si.type in ('comment', 'reply', 'mention')
    left join attribution_touches identity_touch
      on identity_touch.workspace_id = si.workspace_id
      and identity_touch.social_interaction_id = si.id
      and identity_touch.kind = 'identity'
      and identity_touch.status = 'active'
      and identity_touch.certainty = 'evidence'
    left join attribution_touches conversation_touch
      on conversation_touch.workspace_id = si.workspace_id
      and conversation_touch.social_interaction_id = si.id
      and conversation_touch.kind = 'conversation'
      and conversation_touch.status = 'active'
      and conversation_touch.certainty = 'evidence'
    left join lateral (
      select m.provider_message_id
      from messages m
      where m.workspace_id = si.workspace_id
        and m.conversation_id = conversation_touch.conversation_id
        and m.direction = 'outbound'
      order by coalesce(m.sent_at, m.created_at) desc
      limit 1
    ) response on true
    left join attribution_touches booking_touch
      on booking_touch.workspace_id = si.workspace_id
      and booking_touch.social_interaction_id = si.id
      and booking_touch.kind = 'booking'
      and booking_touch.status = 'active'
      and booking_touch.certainty in ('evidence', 'inference')
    where sci.workspace_id = ${workspaceId} and sci.publication_id = ${publicationId}
    order by coalesce(si.occurred_at, si.first_seen_at) desc
    limit 1
  `;
  return rows[0] ?? null;
}

async function sessionCookie(): Promise<string> {
  const supplied = process.env.NOOSPHERE_PTC_SESSION_COOKIE?.trim();
  if (supplied) return supplied;
  const webUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const response = await fetch(`${webUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: new URL(webUrl).origin },
    body: JSON.stringify({
      email: requiredEnvironment("BOOTSTRAP_OWNER_EMAIL"),
      password: requiredEnvironment("BOOTSTRAP_OWNER_PASSWORD"),
    }),
  });
  if (!response.ok) throw new Error(`LINKEDIN_CANARY_SIGN_IN_FAILED:${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("LINKEDIN_CANARY_SESSION_COOKIE_MISSING");
  return cookie;
}

function parseMode(value: string): Mode {
  if (value === "preflight" || value === "publish" || value === "verify") return value;
  throw new Error("NOOSPHERE_PTC_MODE must be preflight, publish or verify");
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function sha256(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

async function safeDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.replace(/[\r\n]+/g, " ").slice(0, 300);
}
