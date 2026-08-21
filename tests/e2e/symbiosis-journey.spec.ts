import { expect, test } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { createDatabase } from "@outbound/infrastructure/database/client";
import {
  attributionTouches,
  calendarBookings,
  calendarConnections,
  connectedAccounts,
  contactIdentities,
  contacts,
  conversations,
  socialContentItems,
  socialInteractions,
  workspaces,
} from "@outbound/infrastructure/database/schema";

const workspaceSlug = process.env.BOOTSTRAP_WORKSPACE_SLUG ?? "ignition-ai";
const email = process.env.BOOTSTRAP_OWNER_EMAIL ?? "owner@ignition.local";
const password = process.env.BOOTSTRAP_OWNER_PASSWORD ?? "change-me-in-env";
// Browser journeys exercise the API runtime, which always reads DATABASE_URL.
// TEST_DATABASE_URL is reserved for the integration-test harness and may point
// at a distinct database in CI.
const databaseUrl = process.env.DATABASE_URL;

test("Symbiose renders a proved journey and keeps an unresolved reaction inert", async ({ page }) => {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the Symbiose browser proof");
  const fixture = await seedSymbiosisFixture(databaseUrl);
  try {
    const mutationRequests: string[] = [];
    page.on("request", (request) => {
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) mutationRequests.push(`${request.method()} ${request.url()}`);
    });
    await page.goto("/login");
    await page.getByLabel("Email professionnel").fill(email);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: "Accéder au workspace" }).click();
    await expect(page.getByRole("heading", { name: "Aujourd’hui" })).toBeVisible({ timeout: 20_000 });
    mutationRequests.length = 0;

    await page.goto(`/w/${workspaceSlug}/activity?lens=symbiosis`);
    await expect(page.getByRole("heading", { name: "Transformer les signaux" })).toBeVisible();
    await expect(page.getByText("Données partielles")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Signaux prioritaires" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Parcours attribué" })).toBeVisible();
    await expect(page.getByText("Ada Lovelace a commenté un post")).toBeVisible();
    await expect(page.getByText(/Aucun message automatique/)).toBeVisible();
    await expect(page.getByText("Inférence", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Voir toutes les preuves" })).toHaveAttribute("href", new RegExp(`/w/${workspaceSlug}/attribution\\?interactionId=`));

    await page.goto(`/w/${workspaceSlug}/prospects/${fixture.contactId}`);
    await expect(page.getByRole("heading", { name: "Signaux sociaux prouvés" })).toBeVisible();
    await expect(page.getByText("+8 social")).toBeVisible();
    await expect(page.getByText(/Une conversation LinkedIn est déjà ouverte/)).toBeVisible();
    await expect(page.getByText(/Une réaction seule ne modifie jamais le score/)).toBeVisible();

    await page.goto(`/w/${workspaceSlug}/inbox?source=inbound&conversation=${fixture.conversationId}`);
    await expect(page.getByRole("combobox", { name: "Source" })).toHaveValue("inbound");
    await expect(page.getByText("Source Inbound")).toBeVisible();
    const socialRegion = page.getByRole("region", { name: "Interactions sociales prouvées" });
    await expect(socialRegion).toBeVisible();
    await expect(socialRegion.getByText("Le lien entre preuve et revenu m’intéresse.")).toBeVisible();
    await expect(page.getByText(/Aucune réponse automatique hors campagne/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Envoyer moi-même" })).toBeVisible();

    await page.goto(`/w/${workspaceSlug}/appointments?view=all&source=inbound`);
    await expect(page.getByRole("heading", { name: "Appels" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Source" })).toHaveValue("inbound");
    await expect(page.getByText("Source Inbound", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Parcours social attribué · inférence, pas causalité").first()).toBeVisible();
    await page.getByText("Parcours social attribué · inférence, pas causalité").first().click();
    await expect(page.getByText(/Même contact LinkedIn vérifié, puis appel réservé/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Voir la preuve" }).first()).toHaveAttribute("href", new RegExp(`/w/${workspaceSlug}/attribution\\?interactionId=`));
    expect(mutationRequests).toEqual([]);
  } finally {
    await fixture.cleanup();
  }
});

async function seedSymbiosisFixture(url: string) {
  const database = createDatabase(url);
  const workspace = (await database.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, workspaceSlug)).limit(1))[0];
  if (!workspace) {
    await database.close();
    throw new Error(`Workspace ${workspaceSlug} is missing`);
  }
  const now = new Date();
  const accountId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const identityId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const bookingId = crypto.randomUUID();
  const postId = crypto.randomUUID();
  const resolvedInteractionId = crypto.randomUUID();
  const unresolvedInteractionId = crypto.randomUUID();
  await database.db.insert(connectedAccounts).values({ id: accountId, workspaceId: workspace.id, provider: "unipile", providerAccountId: `e2e-linkedin-${accountId}`, displayName: "LinkedIn E2E Symbiose", status: "connected", capabilities: { linkedin: true }, encryptedSecret: "e2e-fixture" });
  await database.db.insert(contacts).values({ id: contactId, workspaceId: workspace.id, firstName: "Ada", lastName: "Lovelace", source: "provider" });
  await database.db.insert(contactIdentities).values({ id: identityId, workspaceId: workspace.id, contactId, type: "linkedin", value: `https://linkedin.com/in/e2e-${contactId}`, normalizedValue: `linkedin.com/in/e2e-${contactId}`, verificationStatus: "verified", source: "provider" });
  await database.db.insert(conversations).values({ id: conversationId, workspaceId: workspace.id, contactId, connectedAccountId: accountId, provider: "unipile", providerAccountId: `e2e-linkedin-${accountId}`, providerThreadId: `thread-${conversationId}`, channel: "linkedin", origin: "outside_campaign", automationMode: "human", status: "open", lastMessageAt: new Date(now.getTime() + 60_000) });
  await database.db.insert(calendarConnections).values({ id: connectionId, workspaceId: workspace.id, provider: "calcom", bookingUrl: "https://cal.com/noosphere-e2e", status: "active", isDefault: false });
  await database.db.insert(calendarBookings).values({ id: bookingId, workspaceId: workspace.id, connectionId, providerBookingId: `booking-${bookingId}`, contactId, status: "accepted", attendeeName: "Ada Lovelace", startAt: new Date(now.getTime() + 48 * 60 * 60_000) });
  await database.db.insert(socialContentItems).values({ id: postId, workspaceId: workspace.id, connectedAccountId: accountId, providerAccountId: `e2e-linkedin-${accountId}`, origin: "internal", providerPostId: `post-${postId}`, socialId: `urn:li:activity:${postId}`, authorProviderId: "owner-e2e", text: "Comment prouver la valeur métier d’un système IA sans inventer de causalité", url: `https://linkedin.com/feed/update/${postId}`, status: "observed", firstSeenAt: now, lastSeenAt: now });
  await database.db.insert(socialInteractions).values([
    { id: resolvedInteractionId, workspaceId: workspace.id, socialContentId: postId, connectedAccountId: accountId, providerAccountId: `e2e-linkedin-${accountId}`, syncKind: "comments", scopeKey: "post", type: "comment", providerInteractionId: `comment-${resolvedInteractionId}`, direction: "incoming", actorProviderId: `actor-${contactId}`, actorName: "Ada Lovelace", actorProfileUrl: `https://linkedin.com/in/e2e-${contactId}`, body: "Le lien entre preuve et revenu m’intéresse.", status: "observed", firstSeenAt: now, lastSeenAt: now, lastScanToken: crypto.randomUUID() },
    { id: unresolvedInteractionId, workspaceId: workspace.id, socialContentId: postId, connectedAccountId: accountId, providerAccountId: `e2e-linkedin-${accountId}`, syncKind: "reactions", scopeKey: "post", type: "reaction", providerInteractionId: `reaction-${unresolvedInteractionId}`, direction: "incoming", actorProviderId: "actor-unknown", actorName: "Profil LinkedIn inconnu", reaction: "like", status: "observed", firstSeenAt: new Date(now.getTime() - 60_000), lastSeenAt: new Date(now.getTime() - 60_000), lastScanToken: crypto.randomUUID() },
  ]);
  const base = { workspaceId: workspace.id, socialContentId: postId, publicationId: null, modelVersion: "attribution-v1", status: "active", occurredAt: now } as const;
  await database.db.insert(attributionTouches).values([
    { ...base, id: crypto.randomUUID(), socialInteractionId: resolvedInteractionId, contactId, kind: "identity", certainty: "evidence", rule: "linkedin_profile_url_exact_v1", confidence: "0.9500", proofType: "contact_identity", proofRef: `contact_identity:${identityId}`, proofHref: `/prospects/${contactId}`, logicalKey: "identity" },
    { ...base, id: crypto.randomUUID(), socialInteractionId: resolvedInteractionId, contactId, conversationId, kind: "conversation", certainty: "evidence", rule: "crm_contact_conversation_fk_v1", confidence: "1.0000", proofType: "crm_foreign_key", proofRef: `conversation:${conversationId}:contact:${contactId}`, proofHref: `/inbox?conversation=${conversationId}`, logicalKey: `conversation:${conversationId}` },
    { ...base, id: crypto.randomUUID(), socialInteractionId: resolvedInteractionId, contactId, bookingId, kind: "booking", certainty: "inference", rule: "same_verified_contact_after_touch_90d_v1", confidence: "0.6000", proofType: "contact_time_correlation", proofRef: `contact:${contactId}:booking:${bookingId}`, proofHref: `/appointments?booking=${bookingId}`, logicalKey: `booking:${bookingId}` },
    { ...base, id: crypto.randomUUID(), socialInteractionId: unresolvedInteractionId, kind: "identity", certainty: "unknown", rule: "no_exact_linkedin_identity_v1", confidence: "0.0000", proofType: "none", proofRef: null, proofHref: `/content/calendar?interaction=${unresolvedInteractionId}`, logicalKey: "identity" },
  ]);
  return {
    contactId,
    conversationId,
    async cleanup() {
      await database.db.delete(attributionTouches).where(and(eq(attributionTouches.workspaceId, workspace.id), inArray(attributionTouches.socialInteractionId, [resolvedInteractionId, unresolvedInteractionId])));
      await database.db.delete(calendarBookings).where(and(eq(calendarBookings.workspaceId, workspace.id), eq(calendarBookings.id, bookingId)));
      await database.db.delete(calendarConnections).where(and(eq(calendarConnections.workspaceId, workspace.id), eq(calendarConnections.id, connectionId)));
      await database.db.delete(conversations).where(and(eq(conversations.workspaceId, workspace.id), eq(conversations.id, conversationId)));
      await database.db.delete(contactIdentities).where(and(eq(contactIdentities.workspaceId, workspace.id), eq(contactIdentities.id, identityId)));
      await database.db.delete(contacts).where(and(eq(contacts.workspaceId, workspace.id), eq(contacts.id, contactId)));
      await database.db.delete(socialInteractions).where(and(eq(socialInteractions.workspaceId, workspace.id), inArray(socialInteractions.id, [resolvedInteractionId, unresolvedInteractionId])));
      await database.db.delete(socialContentItems).where(and(eq(socialContentItems.workspaceId, workspace.id), eq(socialContentItems.id, postId)));
      await database.db.delete(connectedAccounts).where(and(eq(connectedAccounts.workspaceId, workspace.id), eq(connectedAccounts.id, accountId)));
      await database.close();
    },
  };
}
