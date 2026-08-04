import { describe, expect, test } from "bun:test";
import { campaignsHref } from "../../apps/web/app/w/[workspaceSlug]/research/[runId]/report/report-links";

describe("ICP report campaigns CTA", () => {
  test("links a report with operational ICP versions to its generated campaigns", () => {
    expect(
      campaignsHref("ignition-ai", [
        { id: "version-1", version: 1, runId: "run-1" },
        { id: "version-2", version: 2, runId: "run-1" },
      ]),
    ).toBe("/w/ignition-ai/campaigns?runId=run-1");
  });

  test("does not expose a campaigns CTA before an ICP version exists", () => {
    expect(campaignsHref("ignition-ai", [])).toBeNull();
  });
});
