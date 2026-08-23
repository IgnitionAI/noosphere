import { describe, expect, test } from "bun:test";
import type { ResearchRunSummary } from "../../apps/web/lib/api";
import { loadProductReadingPageState } from "../../apps/web/app/w/[workspaceSlug]/strategy/product-reading/product-reading-state";

describe("product reading page state", () => {
  test("keeps the ICP form available when an empty workspace has no research history", async () => {
    const state = await loadProductReadingPageState(async () => []);

    expect(state).toEqual({ runs: [], historyUnavailable: false });
  });

  test("degrades only the history when its upstream read fails", async () => {
    const state = await loadProductReadingPageState(async () => {
      throw new Error("temporary upstream failure");
    });

    expect(state).toEqual({ runs: [], historyUnavailable: true });
  });

  test("preserves loaded research history", async () => {
    const run = { id: "run-fixture" } as ResearchRunSummary;
    const state = await loadProductReadingPageState(async () => [run]);

    expect(state).toEqual({ runs: [run], historyUnavailable: false });
  });
});
