import { expect, test } from "bun:test";
import { assertCampaignDraft, transitionCampaign } from "@outbound/domain/campaigns/campaign";

test("campaign lifecycle transitions are idempotent", () => {
  expect(transitionCampaign("draft", "activate")).toEqual({ status: "active", changed: true });
  expect(transitionCampaign("active", "activate")).toEqual({ status: "active", changed: false });
  expect(transitionCampaign("active", "pause")).toEqual({ status: "paused", changed: true });
  expect(transitionCampaign("paused", "pause")).toEqual({ status: "paused", changed: false });
  expect(transitionCampaign("paused", "resume")).toEqual({ status: "active", changed: true });
  expect(transitionCampaign("active", "archive")).toEqual({ status: "archived", changed: true });
  expect(transitionCampaign("archived", "archive")).toEqual({ status: "archived", changed: false });
});

test("campaign references are editable only while draft", () => {
  expect(() => assertCampaignDraft("active")).toThrow("CAMPAIGN_SNAPSHOT_IMMUTABLE");
  expect(() => assertCampaignDraft("paused")).toThrow("CAMPAIGN_SNAPSHOT_IMMUTABLE");
  expect(() => assertCampaignDraft("draft")).not.toThrow();
});
