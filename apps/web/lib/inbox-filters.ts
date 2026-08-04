import type { ProspectViewSummary } from "./api";

export type InboxScope = "all" | "campaign" | "outside_campaign";
export type InboxPeriod = "all" | "today" | "7d" | "30d" | "90d";
export type InboxReadState = "all" | "unread";

type InboxFilterableProspect = Pick<
  ProspectViewSummary,
  "conversation" | "icpMatches" | "latestActivity"
>;

export interface InboxFilterQuery {
  readonly search?: string;
  readonly channel?: string;
  readonly view?: string;
  readonly scope?: string;
  readonly period?: string;
  readonly read?: string;
}

export function inboxScope(value: string | undefined): InboxScope {
  return value === "campaign" || value === "outside_campaign" ? value : "all";
}

export function inboxPeriod(value: string | undefined): InboxPeriod {
  return value === "today" || value === "7d" || value === "30d" || value === "90d"
    ? value
    : "all";
}

export function inboxReadState(value: string | undefined): InboxReadState {
  return value === "unread" ? "unread" : "all";
}

export function matchesInboxScope(
  prospect: InboxFilterableProspect,
  scope: InboxScope,
): boolean {
  if (scope === "all") return true;
  const belongsToCampaign = (
    prospect.conversation?.campaignId !== null
    && prospect.conversation?.campaignId !== undefined
  ) || prospect.icpMatches.length > 0;
  return scope === "campaign"
    ? belongsToCampaign
    : Boolean(prospect.conversation && prospect.conversation.campaignId === null);
}

export function matchesInboxPeriod(
  prospect: InboxFilterableProspect,
  period: InboxPeriod,
  now = new Date(),
): boolean {
  if (period === "all") return true;
  const occurredAt = prospect.latestActivity?.occurredAt;
  if (!occurredAt) return false;
  const activityDate = new Date(occurredAt);
  if (!Number.isFinite(activityDate.getTime())) return false;
  if (period === "today") {
    return parisDateKey(activityDate) === parisDateKey(now);
  }
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  return activityDate.getTime() >= now.getTime() - days * 24 * 60 * 60_000;
}

export function matchesInboxReadState(
  prospect: InboxFilterableProspect,
  readState: InboxReadState,
): boolean {
  return readState === "all" || (prospect.conversation?.unreadCount ?? 0) > 0;
}

export function buildInboxHref(workspaceSlug: string, query: InboxFilterQuery): string {
  const params = inboxParams(query);
  return `/w/${workspaceSlug}/inbox${params.size ? `?${params.toString()}` : ""}`;
}

export function buildInboxChannelHref(
  workspaceSlug: string,
  query: InboxFilterQuery,
  channel: "linkedin" | "email" | "whatsapp" | null,
): string {
  const params = inboxParams(query);
  params.delete("channel");
  if (channel) params.set("channel", channel);
  return `/w/${workspaceSlug}/inbox${params.size ? `?${params.toString()}` : ""}`;
}

function inboxParams(query: InboxFilterQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.channel) params.set("channel", query.channel);
  if (query.view && query.view !== "all") params.set("view", query.view);
  if (query.scope && query.scope !== "all") params.set("scope", query.scope);
  if (query.period && query.period !== "all") params.set("period", query.period);
  if (query.read && query.read !== "all") params.set("read", query.read);
  return params;
}

function parisDateKey(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}
