import { and, desc, eq, isNull, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { ExternalEffectFacts, ExternalEffectFactsReader, ExternalEffectFactsReaderInput } from "@outbound/application/mcp/external-effect-policy";
import type { McpGovernedEffectKind } from "@outbound/application/mcp/mcp-governed-effects";
import type { DatabaseExecutor } from "@outbound/infrastructure/database/client";
import { suppressionFingerprint } from "@outbound/infrastructure/crm/suppression-fingerprint";
import {
  campaigns, campaignEnrollments, calendarConnections, calendarMeetingTypes, connectedAccounts, contactIdentities, contactSuppressions,
  contacts, contentAssets, contentAssetVersions, contentIdeas, contentPublications, conversations, editorialStrategies, editorialStrategyVersions, messages, mcpEffectProposals, meetingProposals,
  workspaceChannelAccounts,
} from "@outbound/infrastructure/database/schema";

type EffectCapability = "messaging" | "content" | "campaign";

/** A capability is valid only when the exact effect capability is confirmed. */
export function connectedAccountCapability(value: unknown, effect: EffectCapability, channel?: string): boolean {
  const root = objectValue(value);
  if (!root || (channel !== undefined && !["email", "linkedin", "whatsapp"].includes(channel))) return false;
  const operationKeys: Record<EffectCapability, readonly string[]> = {
    messaging: ["messaging", "sending"],
    content: ["publishing", "posting", "sending"],
    campaign: ["sending", "messaging"],
  };
  const channelValue = channel === undefined ? undefined : root[channel];
  if (channelValue === true) return true;
  const channelDetail = objectValue(channelValue);
  if (channelDetail) {
    const keys = operationKeys[effect];
    const explicit = keys.find((key) => Object.prototype.hasOwnProperty.call(channelDetail, key));
    if (explicit) return channelDetail[explicit] === true;
    if (channelDetail.enabled === true) return true;
  }
  const candidate = root[effect];
  if (candidate === true) return true;
  const detail = objectValue(candidate);
  if (!detail || channel === undefined) return false;
  return detail[channel] === true;
}

/** Parse only documented quota shapes; malformed or absent quota is unavailable. */
export function quotaAvailability(value: unknown, channel?: string): boolean {
  const root = objectValue(value);
  if (!root) return false;
  const candidates: unknown[] = [];
  if (channel !== undefined) {
    if (root[channel] !== undefined) candidates.push(root[channel]);
    const daily = objectValue(root.daily);
    if (daily?.[channel] !== undefined) candidates.push(daily[channel]);
  }
  if (root.daily !== undefined) candidates.push(root.daily);
  candidates.push(root);
  for (const candidate of candidates) {
    if (typeof candidate === "number" || typeof candidate === "string") {
      const limit = typeof candidate === "number" ? candidate : Number(candidate);
      if (Number.isFinite(limit)) return limit > 0;
      continue;
    }
    const quota = objectValue(candidate);
    if (!quota) continue;
    if (quota.exceeded === true) return false;
    const remaining = typeof quota.remaining === "number" ? quota.remaining : typeof quota.remaining === "string" ? Number(quota.remaining) : null;
    if (remaining !== null) return Number.isFinite(remaining) && remaining > 0;
    const limit = typeof quota.limit === "number" ? quota.limit : typeof quota.limit === "string" ? Number(quota.limit) : null;
    if (limit !== null) return Number.isFinite(limit) && limit > 0;
    if (quota.exceeded === false) return true;
  }
  return false;
}

/** Read-only projection of local, authoritative facts used by the governed effect policy. */
export class PostgresExternalEffectFactsReader implements ExternalEffectFactsReader {
  constructor(private readonly database: DatabaseExecutor, private readonly now: () => Date = () => new Date()) {}

  async read(input: ExternalEffectFactsReaderInput): Promise<ExternalEffectFacts | null> {
    if (input.context.workspaceId !== input.proposal.workspaceId) return null;
    try {
      const rows = await this.database.select({
        kind: mcpEffectProposals.kind, aggregateId: mcpEffectProposals.aggregateId, workspaceId: mcpEffectProposals.workspaceId,
        intentSnapshot: mcpEffectProposals.intentSnapshot, sourceSnapshot: mcpEffectProposals.sourceSnapshot,
        version: mcpEffectProposals.version, revision: mcpEffectProposals.revision, sourceVersion: mcpEffectProposals.sourceVersion,
      }).from(mcpEffectProposals).where(and(eq(mcpEffectProposals.workspaceId, input.context.workspaceId), eq(mcpEffectProposals.id, input.proposal.proposalId))).limit(1);
      const proposal = rows[0];
      if (!proposal || proposal.workspaceId !== input.context.workspaceId || proposal.kind !== input.proposal.kind || !isKind(proposal.kind)) return null;
      const persisted = versionsFor(proposal.revision, proposal.sourceVersion, proposal.version, jsonNumber(proposal.sourceSnapshot, "factsVersion"));
      switch (proposal.kind) {
        case "conversation_reply": return this.readConversation(input.context.workspaceId, proposal.aggregateId, persisted);
        case "content_publication": return this.readPublication(input.context.workspaceId, proposal.aggregateId, proposal.intentSnapshot, proposal.sourceSnapshot, persisted);
        case "meeting_proposal": return this.readMeeting(input.context.workspaceId, proposal.aggregateId, slotPosition(proposal.sourceSnapshot) ?? slotPosition(proposal.intentSnapshot), persisted);
        case "campaign_activation": return this.readCampaign(input.context.workspaceId, proposal.aggregateId, persisted);
      }
    } catch { return null; }
  }

  async readFacts(input: ExternalEffectFactsReaderInput): Promise<ExternalEffectFacts | null> { return this.read(input); }

  private async readConversation(workspaceId: string, aggregateId: string, persisted: Versions): Promise<ExternalEffectFacts | null> {
    const rows = await this.database.select().from(conversations).where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.id, aggregateId))).limit(1);
    const conversation = rows[0];
    if (!conversation) return null;
    const contactRows = await this.database.select({ id: contacts.id, status: contacts.status, revision: contacts.revision, anonymizedAt: contacts.anonymizedAt, updatedAt: contacts.updatedAt })
      .from(contacts).where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, conversation.contactId))).limit(1);
    const contact = contactRows[0];
    if (!contact || contact.anonymizedAt) return null;
    const identities = await this.database.select({ type: contactIdentities.type, normalizedValue: contactIdentities.normalizedValue }).from(contactIdentities)
      .where(and(eq(contactIdentities.workspaceId, workspaceId), eq(contactIdentities.contactId, contact.id)));
    const identityClauses = identities.flatMap((identity) => {
      const fingerprint = suppressionFingerprint({ workspaceId, identityType: identity.type, normalizedValue: identity.normalizedValue });
      return [
        and(eq(contactSuppressions.identityType, identity.type), eq(contactSuppressions.normalizedValue, identity.normalizedValue)),
        and(eq(contactSuppressions.identityType, identity.type), eq(contactSuppressions.identityFingerprint, fingerprint)),
      ];
    });
    const target = or(eq(contactSuppressions.contactId, contact.id), ...(identityClauses.length ? identityClauses : [eq(contactSuppressions.contactId, "00000000-0000-0000-0000-000000000000")]));
    const suppressionRows = await this.database.select({ id: contactSuppressions.id }).from(contactSuppressions).where(and(
      eq(contactSuppressions.workspaceId, workspaceId), or(eq(contactSuppressions.channel, "global"), eq(contactSuppressions.channel, conversation.channel)), isNull(contactSuppressions.liftedAt), target,
    )).limit(1);
    const humanRows = await this.database.select({ receivedAt: messages.receivedAt, createdAt: messages.createdAt }).from(messages).where(and(
      eq(messages.workspaceId, workspaceId), eq(messages.conversationId, conversation.id), eq(messages.direction, "inbound"),
    )).orderBy(desc(messages.receivedAt), desc(messages.createdAt)).limit(1);
    const humanReplyAt = humanRows[0] ? (humanRows[0].receivedAt ?? humanRows[0].createdAt).toISOString() : null;
    const account = await this.account(workspaceId, { id: conversation.connectedAccountId, providerAccountId: conversation.providerAccountId }, "messaging", conversation.channel);
    // A contact's denormalized status is not channel-aware. Only an active,
    // matching suppression row is authoritative so lifted/channel-specific
    // rows do not accidentally block every outbound channel.
    const suppressed = suppressionRows.length > 0;
    const versions = versionsFor(persisted.revision, persisted.sourceVersion, persisted.factsVersion, contact.revision);
    return {
      kind: "conversation_reply", aggregateId, revision: versions.revision, sourceVersion: versions.sourceVersion, factsVersion: versions.factsVersion,
      sourceId: `conversation:${aggregateId}`, sourceUpdatedAt: maxDate(conversation.updatedAt, contact.updatedAt).toISOString(), evaluatedAt: this.now().toISOString(),
      status: conversation.status, conversationStatus: conversation.status, contactPresent: true, suppressed, ...(suppressed ? { suppressionStatus: "suppressed" as const } : {}),
      humanReplyAt, hasHumanReply: humanReplyAt !== null, adapterAvailable: account.adapterAvailable, accountHealthy: account.healthy, quotaAvailable: account.quotaAvailable,
      account: { healthy: account.healthy, adapterAvailable: account.adapterAvailable },
    };
  }

  private async readPublication(workspaceId: string, aggregateId: string, intentSnapshot: unknown, sourceSnapshot: unknown, persisted: Versions): Promise<ExternalEffectFacts | null> {
    const explicitPublicationId = jsonString(sourceSnapshot, "publicationId") ?? jsonString(intentSnapshot, "publicationId");
    const explicitAssetId = jsonString(sourceSnapshot, "assetId") ?? jsonString(intentSnapshot, "assetId");
    let publication = explicitPublicationId
      ? (await this.database.select().from(contentPublications).where(and(eq(contentPublications.workspaceId, workspaceId), eq(contentPublications.id, explicitPublicationId))).limit(1))[0]
      : undefined;
    if (!publication && explicitAssetId) {
      const candidates = await this.database.select().from(contentPublications).where(and(eq(contentPublications.workspaceId, workspaceId), eq(contentPublications.assetId, explicitAssetId)))
        .orderBy(desc(contentPublications.updatedAt), desc(contentPublications.createdAt), desc(contentPublications.id)).limit(1);
      publication = candidates[0];
    }
    if (!publication && !explicitAssetId && !explicitPublicationId) {
      publication = (await this.database.select().from(contentPublications).where(and(eq(contentPublications.workspaceId, workspaceId), eq(contentPublications.id, aggregateId))).limit(1))[0];
    }
    if (!publication) return null;
    const versions = await this.database.select({ id: contentAssetVersions.id, version: contentAssetVersions.version, ready: contentAssetVersions.ready, createdAt: contentAssetVersions.createdAt }).from(contentAssetVersions)
      .where(and(eq(contentAssetVersions.workspaceId, workspaceId), eq(contentAssetVersions.id, publication.assetVersionId))).limit(1);
    const assetVersion = versions[0];
    if (!assetVersion) return null;
    const asset = (await this.database.select({ status: contentAssets.status, latestVersion: contentAssets.latestVersion, revision: contentAssets.revision, ideaId: contentAssets.ideaId, updatedAt: contentAssets.updatedAt }).from(contentAssets)
      .where(and(eq(contentAssets.workspaceId, workspaceId), eq(contentAssets.id, publication.assetId))).limit(1))[0];
    if (!asset) return null;
    const grounding = (await this.database.select({ strategyVersionId: contentIdeas.strategyVersionId, strategyVersion: editorialStrategyVersions.version, strategyStatus: editorialStrategies.status, strategyDeletedAt: editorialStrategies.deletedAt, strategyUpdatedAt: editorialStrategies.updatedAt })
      .from(contentIdeas)
      .innerJoin(editorialStrategyVersions, and(eq(editorialStrategyVersions.workspaceId, contentIdeas.workspaceId), eq(editorialStrategyVersions.id, contentIdeas.strategyVersionId)))
      .innerJoin(editorialStrategies, and(eq(editorialStrategies.workspaceId, editorialStrategyVersions.workspaceId), eq(editorialStrategies.id, editorialStrategyVersions.strategyId)))
      .where(and(eq(contentIdeas.workspaceId, workspaceId), eq(contentIdeas.id, asset.ideaId))).limit(1))[0];
    if (!grounding) return null;
    const accountBinding = contentAccountBinding(publication.accountSnapshot);
    // The publication's account snapshot is the immutable authority. Never
    // fall back to the mutable publication provider or an account id alone.
    if (!accountBinding) return null;
    const account = await this.account(workspaceId, accountBinding, "content", publication.network);
    const policyVersion = jsonString(publication.policySnapshot, "policyVersion") ?? jsonString(publication.policySnapshot, "version") ?? "local";
    const current = versionsFor(persisted.revision, persisted.sourceVersion, persisted.factsVersion, assetVersion.version);
    return {
      kind: "content_publication", aggregateId, revision: current.revision, sourceVersion: current.sourceVersion, factsVersion: current.factsVersion,
      sourceId: `content-publication:${publication.id}`, sourceUpdatedAt: maxDate(publication.updatedAt, asset.updatedAt, grounding.strategyUpdatedAt).toISOString(), evaluatedAt: this.now().toISOString(), status: publication.status,
      assetId: publication.assetId, publicationId: publication.id, assetVersionId: publication.assetVersionId, contentVersion: assetVersion.version, policyVersion, scheduledFor: publication.scheduledFor.toISOString(),
      assetReady: assetVersion.ready && asset.status === "ready" && asset.latestVersion >= assetVersion.version, assetStatus: asset.status,
      strategyActive: grounding.strategyStatus === "active", strategyDeleted: grounding.strategyDeletedAt !== null, strategyVersionId: grounding.strategyVersionId, strategyVersion: grounding.strategyVersion,
      cancelled: publication.status === "cancelled" || publication.cancelledAt !== null, cancelledAt: publication.cancelledAt?.toISOString() ?? null,
      adapterAvailable: account.adapterAvailable, accountHealthy: account.healthy, quotaAvailable: account.quotaAvailable, account: { healthy: account.healthy, adapterAvailable: account.adapterAvailable },
    };
  }

  private async readMeeting(workspaceId: string, aggregateId: string, position: number | null, persisted: Versions): Promise<ExternalEffectFacts | null> {
    const rows = await this.database.select().from(meetingProposals).where(and(eq(meetingProposals.workspaceId, workspaceId), eq(meetingProposals.id, aggregateId))).limit(1);
    const proposal = rows[0];
    if (!proposal || position === null) return null;
    const slot = offeredSlot(proposal.slots, position);
    if (!slot) return null;
    const connectionRows = await this.database.select({ id: calendarConnections.id, provider: calendarConnections.provider, status: calendarConnections.status, isDefault: calendarConnections.isDefault, eventTypeId: calendarConnections.eventTypeId, lastVerifiedAt: calendarConnections.lastVerifiedAt, lastErrorCode: calendarConnections.lastErrorCode })
      .from(calendarConnections).where(and(eq(calendarConnections.workspaceId, workspaceId), eq(calendarConnections.provider, "calcom"), eq(calendarConnections.status, "active"), eq(calendarConnections.isDefault, true))).limit(2);
    const connection = connectionRows.length === 1 ? connectionRows[0] : undefined;
    const meetingTypes = connection ? await this.database.select({ providerEventTypeId: calendarMeetingTypes.providerEventTypeId }).from(calendarMeetingTypes)
      .where(and(eq(calendarMeetingTypes.workspaceId, workspaceId), eq(calendarMeetingTypes.connectionId, connection.id), eq(calendarMeetingTypes.active, true), eq(calendarMeetingTypes.isDefault, true))).limit(2) : [];
    const available = proposal.status === "offered" && connection !== undefined && connection.eventTypeId !== null && connection.lastVerifiedAt !== null && connection.lastErrorCode === null
      && meetingTypes.length === 1 && meetingTypes[0]!.providerEventTypeId === connection.eventTypeId;
    const current = versionsFor(persisted.revision, persisted.sourceVersion, persisted.factsVersion, proposal.revision, proposal.sourceVersion);
    return {
      kind: "meeting_proposal", aggregateId, revision: current.revision, sourceVersion: current.sourceVersion, factsVersion: current.factsVersion,
      sourceId: `meeting-proposal:${aggregateId}`, sourceUpdatedAt: proposal.updatedAt.toISOString(), evaluatedAt: this.now().toISOString(), status: proposal.status,
      slotPosition: position, slotStart: slot.start, slotEnd: slot.end, timeZone: proposal.timeZone, expiresAt: proposal.expiresAt.toISOString(),
      cancelled: proposal.status === "cancelled", cancelledAt: proposal.status === "cancelled" ? proposal.updatedAt.toISOString() : null,
      adapterAvailable: available, accountHealthy: available, quotaAvailable: available,
    };
  }

  private async readCampaign(workspaceId: string, aggregateId: string, persisted: Versions): Promise<ExternalEffectFacts | null> {
    const rows = await this.database.select().from(campaigns).where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, aggregateId))).limit(1);
    const campaign = rows[0];
    if (!campaign) return null;
    const selected = await this.database.select({ provider: workspaceChannelAccounts.provider, providerAccountId: workspaceChannelAccounts.providerAccountId }).from(workspaceChannelAccounts)
      .where(and(eq(workspaceChannelAccounts.workspaceId, workspaceId), eq(workspaceChannelAccounts.channel, campaign.channel))).limit(2);
    const selectedAccount = selected.length === 1 ? selected[0] : undefined;
    const account = selectedAccount ? await this.account(workspaceId, { provider: selectedAccount.provider, providerAccountId: selectedAccount.providerAccountId }, "campaign", campaign.channel) : unavailableAccount();
    const policy = objectValue(campaign.autopilotPolicy);
    const policyVersion = typeof policy?.policyVersion === "string" ? policy.policyVersion : campaign.aiPolicyVersionId ?? "local";
    const scheduleWindow = objectSchedule(policy?.scheduleWindow);
    if (!scheduleWindow) return null;
    const enrollments = await this.database.select({ id: campaignEnrollments.id, status: campaignEnrollments.status, sequenceVersionId: campaignEnrollments.sequenceVersionId, enrolledAt: campaignEnrollments.enrolledAt, completedAt: campaignEnrollments.completedAt, createdAt: campaignEnrollments.createdAt }).from(campaignEnrollments)
      .where(and(eq(campaignEnrollments.workspaceId, workspaceId), eq(campaignEnrollments.campaignId, aggregateId)));
    const enrollmentFingerprint = enrollmentDigest(enrollments.map((entry) => ({ id: entry.id, status: entry.status, sequenceVersionId: entry.sequenceVersionId, enrolledAt: entry.enrolledAt, completedAt: entry.completedAt, createdAt: entry.createdAt })));
    // Enrollment changes are a content digest, not a numeric facts version.
    // factsVersion remains the persisted/source-native version from the proposal.
    const current = versionsFor(persisted.revision, persisted.sourceVersion, persisted.factsVersion);
    const accountHealth = { status: account.healthy ? "healthy" : "unhealthy", checkedAt: (account.checkedAt ?? campaign.updatedAt).toISOString() } as const;
    return {
      kind: "campaign_activation", aggregateId, revision: current.revision, sourceVersion: current.sourceVersion, factsVersion: current.factsVersion,
      sourceId: `campaign:${aggregateId}`, sourceUpdatedAt: campaign.updatedAt.toISOString(), evaluatedAt: this.now().toISOString(), status: campaign.status,
      policyVersion, policyVersionSupported: true, automationStage: campaign.automationStage, enrollmentFingerprint, campaignActive: campaign.status === "active",
      enrollmentActive: enrollments.length === 0 || enrollments.some((entry) => entry.status === "active"), scheduleWindow, accountHealth,
      // Campaign activation has no proven external adapter yet; remain frozen
      // until a concrete campaign adapter is wired and observed healthy.
      account: { healthy: account.healthy, adapterAvailable: false }, adapterAvailable: false, accountHealthy: account.healthy, quotaAvailable: account.quotaAvailable,
    };
  }

  private async account(workspaceId: string, binding: { id?: string | null; providerAccountId?: string | null; provider?: string }, effect: EffectCapability, channel?: string): Promise<AccountFacts> {
    const conditions = [eq(connectedAccounts.workspaceId, workspaceId)];
    if (binding.id) conditions.push(eq(connectedAccounts.id, binding.id));
    if (binding.providerAccountId) conditions.push(eq(connectedAccounts.providerAccountId, binding.providerAccountId));
    if (binding.provider) conditions.push(eq(connectedAccounts.provider, binding.provider));
    if (!binding.id && !binding.providerAccountId) return unavailableAccount();
    const rows = await this.database.select({ status: connectedAccounts.status, quotas: connectedAccounts.quotas, capabilities: connectedAccounts.capabilities, lastCheckedAt: connectedAccounts.lastCheckedAt, updatedAt: connectedAccounts.updatedAt })
      .from(connectedAccounts).where(and(...conditions)).limit(2);
    if (rows.length !== 1) return unavailableAccount();
    const row = rows[0]!;
    const healthy = row.status === "connected";
    return { healthy, adapterAvailable: healthy && connectedAccountCapability(row.capabilities, effect, channel), quotaAvailable: healthy && quotaAvailability(row.quotas, channel), checkedAt: row.lastCheckedAt ?? row.updatedAt, updatedAt: row.updatedAt };
  }
}

interface AccountFacts { readonly healthy: boolean; readonly adapterAvailable: boolean; readonly quotaAvailable: boolean; readonly checkedAt: Date | null; readonly updatedAt: Date; }
interface Versions { readonly revision: number; readonly sourceVersion: number; readonly factsVersion: number; }
function unavailableAccount(): AccountFacts { return { healthy: false, adapterAvailable: false, quotaAvailable: false, checkedAt: null, updatedAt: new Date(0) }; }
function contentAccountBinding(value: unknown): { provider: string; providerAccountId: string } | null {
  const snapshot = objectValue(value);
  // Content publication currently supports only the native Unipile adapter.
  // Unknown/absent providers fail closed instead of borrowing another account.
  if (!snapshot || snapshot.provider !== "unipile" || typeof snapshot.providerAccountId !== "string" || snapshot.providerAccountId.length === 0) return null;
  return { provider: snapshot.provider, providerAccountId: snapshot.providerAccountId };
}

export function enrollmentDigest(value: readonly { readonly id: string }[]): string {
  const ordered = [...value].sort((left, right) => left.id.localeCompare(right.id));
  return createHash("sha256").update(canonicalJson(ordered)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function isKind(value: string): value is McpGovernedEffectKind { return value === "conversation_reply" || value === "content_publication" || value === "meeting_proposal" || value === "campaign_activation"; }
function maxDate(...values: Array<Date | null | undefined>): Date { return values.filter((value): value is Date => value instanceof Date).reduce((max, value) => value > max ? value : max, new Date(0)); }
function versionsFor(revision: number, sourceVersion: number, factsVersion: number, ...nativeVersions: Array<number | null | undefined>): Versions { const valid = nativeVersions.filter((value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0); return { revision: Math.max(1, revision), sourceVersion: Math.max(1, sourceVersion), factsVersion: Math.max(1, factsVersion, ...valid) }; }
function objectValue(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function jsonString(value: unknown, key: string): string | null { const candidate = objectValue(value)?.[key]; return typeof candidate === "string" && candidate.length > 0 ? candidate : null; }
function jsonNumber(value: unknown, key: string): number | undefined { const candidate = objectValue(value)?.[key]; return typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate > 0 ? candidate : undefined; }
function objectSchedule(value: unknown): { start: string; end: string; timeZone?: string } | null { const candidate = objectValue(value); if (!candidate || typeof candidate.start !== "string" || typeof candidate.end !== "string") return null; return { start: candidate.start, end: candidate.end, ...(typeof candidate.timeZone === "string" ? { timeZone: candidate.timeZone } : {}) }; }
function offeredSlot(value: unknown, position: number): { start: string; end: string } | null { const list = Array.isArray(value) ? value : []; const candidate = objectValue(list[position - 1]); if (!candidate) return null; const start = typeof candidate.start === "string" ? candidate.start : typeof candidate.slotStart === "string" ? candidate.slotStart : null; const end = typeof candidate.end === "string" ? candidate.end : typeof candidate.slotEnd === "string" ? candidate.slotEnd : null; return start && end ? { start, end } : null; }
function slotPosition(value: unknown): number | null { const position = objectValue(value)?.slotPosition; return typeof position === "number" && Number.isSafeInteger(position) && position > 0 ? position : null; }
