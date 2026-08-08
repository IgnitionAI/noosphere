import { describe, expect, test } from "bun:test";
import { retryDelayMs, transitionOutreachAction } from "@outbound/domain/campaigns/outreach-action";

describe("OutreachAction", () => {
  test("transitions due/send/sent and makes cancellation idempotent", () => {
    expect(transitionOutreachAction("planned", "due")).toEqual({ status: "due", changed: true });
    expect(transitionOutreachAction("due", "send")).toEqual({ status: "sending", changed: true });
    expect(transitionOutreachAction("sending", "sent")).toEqual({ status: "sent", changed: true });
    expect(transitionOutreachAction("cancelled", "cancel")).toEqual({ status: "cancelled", changed: false });
    expect(() => transitionOutreachAction("sent", "cancel")).toThrow("OUTREACH_ACTION_ALREADY_SENT");
  });

  test("bounds retry backoff", () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(5)).toBe(480_000);
    expect(retryDelayMs(20)).toBe(900_000);
  });
});
