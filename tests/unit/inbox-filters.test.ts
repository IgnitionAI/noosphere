import { describe, expect, test } from "bun:test";
import {
  buildInboxChannelHref,
  buildInboxScopeHref,
  matchesInboxPeriod,
  matchesInboxReadState,
  matchesInboxScope,
} from "../../apps/web/lib/inbox-filters";

describe("inbox filters", () => {
  test("separates campaign conversations from personal LinkedIn threads", () => {
    expect(matchesInboxScope(prospect({ campaignId: null }), "outside_campaign")).toBe(true);
    expect(matchesInboxScope(prospect({ campaignId: "campaign-1" }), "outside_campaign")).toBe(false);
    expect(matchesInboxScope(prospect({ campaignId: "campaign-1" }), "campaign")).toBe(true);
    expect(matchesInboxScope(prospect({ icpMatches: [{}] }), "campaign")).toBe(false);
    expect(matchesInboxScope(prospect({ activityCampaignId: "campaign-2", icpMatches: [] }), "campaign")).toBe(true);
    expect(matchesInboxScope(prospect({ activityCampaignId: "campaign-2", campaignId: null }), "outside_campaign")).toBe(false);
  });

  test("filters unread conversations and activity periods", () => {
    const now = new Date("2026-08-04T12:00:00.000Z");
    const recent = prospect({ occurredAt: "2026-08-03T12:01:00.000Z", unreadCount: 2 });
    const old = prospect({ occurredAt: "2026-06-01T12:00:00.000Z", unreadCount: 0 });
    expect(matchesInboxReadState(recent, "unread")).toBe(true);
    expect(matchesInboxReadState(old, "unread")).toBe(false);
    expect(matchesInboxPeriod(recent, "7d", now)).toBe(true);
    expect(matchesInboxPeriod(old, "30d", now)).toBe(false);
  });

  test("keeps every active filter when switching channel tabs", () => {
    expect(buildInboxChannelHref("ignition-ai", {
      search: "martin",
      channel: "email",
      view: "replies",
      scope: "outside_campaign",
      period: "7d",
      read: "unread",
    }, "linkedin")).toBe(
      "/w/ignition-ai/inbox?search=martin&view=replies&scope=outside_campaign&period=7d&read=unread&channel=linkedin",
    );
  });

  test("keeps every active filter when switching campaign scope", () => {
    expect(buildInboxScopeHref("ignition-ai", {
      search: "martin",
      channel: "linkedin",
      view: "replies",
      scope: "campaign",
      period: "7d",
      read: "unread",
    }, "outside_campaign")).toBe(
      "/w/ignition-ai/inbox?search=martin&channel=linkedin&view=replies&period=7d&read=unread&scope=outside_campaign",
    );
  });
});

function prospect(input: {
  campaignId?: string | null;
  activityCampaignId?: string | null;
  icpMatches?: unknown[];
  occurredAt?: string;
  unreadCount?: number;
}) {
  return {
    conversation: input.campaignId === undefined && input.unreadCount === undefined
      ? null
      : { campaignId: input.campaignId ?? null, unreadCount: input.unreadCount ?? 0 },
    icpMatches: input.icpMatches ?? [],
    latestActivity: input.occurredAt || input.activityCampaignId
      ? { occurredAt: input.occurredAt ?? "2026-08-04T12:00:00.000Z", campaignId: input.activityCampaignId ?? null }
      : null,
  } as never;
}
