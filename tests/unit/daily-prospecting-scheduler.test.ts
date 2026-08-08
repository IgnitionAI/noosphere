import { describe, expect, test } from "bun:test";
import { firstDailyOccurrence, nextDailyOccurrence } from "@outbound/infrastructure/campaigns/daily-prospecting-scheduler";

describe("daily prospecting schedule", () => {
  test("runs at 06:00 in the workspace timezone and advances to the following day", () => {
    expect(
      nextDailyOccurrence(new Date("2026-08-04T03:00:00.000Z"), "06:00", "Europe/Paris").toISOString(),
    ).toBe("2026-08-04T04:00:00.000Z");
    expect(
      nextDailyOccurrence(new Date("2026-08-04T05:00:00.000Z"), "06:00", "Europe/Paris").toISOString(),
    ).toBe("2026-08-05T04:00:00.000Z");
  });

  test("keeps 06:00 local time across a daylight-saving transition", () => {
    expect(
      nextDailyOccurrence(new Date("2026-10-24T05:00:00.000Z"), "06:00", "Europe/Paris").toISOString(),
    ).toBe("2026-10-25T05:00:00.000Z");
  });

  test("catches up the current local day when a workspace is first seen after 06:00", () => {
    const now = new Date("2026-08-04T10:00:00.000Z");
    expect(firstDailyOccurrence(now, "06:00", "Europe/Paris").getTime()).toBeLessThan(now.getTime());
    expect(
      firstDailyOccurrence(
        new Date("2026-08-04T03:00:00.000Z"),
        "06:00",
        "Europe/Paris",
      ).toISOString(),
    ).toBe("2026-08-04T04:00:00.000Z");
  });
});
