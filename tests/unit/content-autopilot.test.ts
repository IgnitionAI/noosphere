import { describe, expect, test } from "bun:test";
import { ContentAutopilotReconciler, nextCadenceSlots, type ContentAutopilotRepository } from "@outbound/application/content/content-autopilot";
import type { ContentGenerationRepository } from "@outbound/application/content/content-generation";
import type { ContentPublicationApplication } from "@outbound/application/content/content-publications";

describe("AUT-101 daily LinkedIn editorial loop", () => {
  test("respects preferred days, occupied days and the weekly cadence", () => {
    const timezone = "Europe/Paris";
    const slots = nextCadenceSlots({
      now: new Date("2026-08-20T10:00:00.000Z"),
      cadence: { postsPerWeek: 2, preferredDays: [1, 3, 5], timezone },
      occupied: [new Date("2026-08-21T07:00:00.000Z")],
      count: 3,
    });
    expect(slots).toHaveLength(3);
    expect(slots.map((date) => localKey(date, timezone))).toEqual([
      "2026-08-24 09:00",
      "2026-08-26 09:00",
      "2026-08-31 09:00",
    ]);
  });

  test("chains generation and publication while isolating one unavailable asset", async () => {
    const generated: string[] = [];
    const published: string[] = [];
    const deferred: string[] = [];
    const repository = {
      async listEnabled() { return [{ workspaceId: "workspace-1", strategyVersionId: "strategy-1", cadence: { postsPerWeek: 3, preferredDays: [1, 3, 5], timezone: "Europe/Paris" } }]; },
      async listGenerationCandidates() { return [{ ideaId: "idea-1" }, { ideaId: "idea-2" }]; },
      async listPublicationCandidates() { return [{ assetId: "asset-bad", assetVersionId: "version-bad", publicationSequence: 1 }, { assetId: "asset-good", assetVersionId: "version-good", publicationSequence: 1 }]; },
      async listOccupiedPublicationTimes() { return []; },
      async recordDeferred(input: { assetId: string }) { deferred.push(input.assetId); },
    } as unknown as ContentAutopilotRepository;
    const generation = {
      async createGeneration(input: { ideaId?: string }) { generated.push(input.ideaId!); return {} as never; },
    } as unknown as ContentGenerationRepository;
    const publications = {
      async schedule(input: { assetId: string }) {
        if (input.assetId === "asset-bad") throw new Error("CONTENT_PUBLICATION_ACCOUNT_UNAVAILABLE");
        published.push(input.assetId);
        return {} as never;
      },
    } as unknown as ContentPublicationApplication;
    const reconciler = new ContentAutopilotReconciler(repository, generation, publications, { now: () => new Date("2026-08-20T10:00:00.000Z") });

    expect(await reconciler.reconcile()).toBe(3);
    expect(generated).toEqual(["idea-1", "idea-2"]);
    expect(published).toEqual(["asset-good"]);
    expect(deferred).toEqual(["asset-bad"]);
  });
});

function localKey(date: Date, timezone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
