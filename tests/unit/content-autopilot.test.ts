import { describe, expect, test } from "bun:test";
import { ContentAutopilotReconciler, nextCadenceSlots, resolveContentAutopilotCadence, type ContentAutopilotRepository } from "@outbound/application/content/content-autopilot";
import type { ContentGenerationRepository } from "@outbound/application/content/content-generation";
import type { ContentPublicationApplication } from "@outbound/application/content/content-publications";

describe("AUT-101 daily LinkedIn editorial loop", () => {
  test("resolves the operational cadence independently from the editorial strategy cadence", () => {
    expect(resolveContentAutopilotCadence({
      strategyCadence: { postsPerWeek: 3, preferredDays: [1, 3, 5], timezone: "Europe/Paris" },
      publicationTimes: ["17:00", "09:00", "09:00"],
      publicationDays: [7, 1, 2, 3, 4, 5, 6],
      timezone: "Europe/Paris",
    })).toEqual({
      postsPerWeek: 14,
      preferredDays: [1, 2, 3, 4, 5, 6, 7],
      publicationTimes: ["09:00", "17:00"],
      timezone: "Europe/Paris",
    });
  });

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

  test("supports two configurable publication slots per day without duplicating an occupied slot", () => {
    const timezone = "Europe/Paris";
    const slots = nextCadenceSlots({
      now: new Date("2026-08-20T05:00:00.000Z"),
      cadence: {
        postsPerWeek: 14,
        preferredDays: [1, 2, 3, 4, 5, 6, 7],
        publicationTimes: ["09:00", "17:00"],
        timezone,
      },
      occupied: [new Date("2026-08-20T07:00:00.000Z")],
      count: 4,
    });

    expect(slots.map((date) => localKey(date, timezone))).toEqual([
      "2026-08-20 17:00",
      "2026-08-21 09:00",
      "2026-08-21 17:00",
      "2026-08-22 09:00",
    ]);
  });

  test("starts one generation at a time while publishing ready assets independently", async () => {
    const generated: string[] = [];
    const published: string[] = [];
    const deferred: string[] = [];
    const repository = {
      async listEnabled() { return [{ workspaceId: "workspace-1", strategyVersionId: "strategy-1", cadence: { postsPerWeek: 3, preferredDays: [1, 3, 5], timezone: "Europe/Paris" } }]; },
      async listGenerationCandidates() { return [{ ideaId: "idea-1" }, { ideaId: "idea-2" }]; },
      async listRepairCandidates() { return []; },
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

    expect(await reconciler.reconcile()).toBe(2);
    expect(generated).toEqual(["idea-1"]);
    expect(published).toEqual(["asset-good"]);
    expect(deferred).toEqual(["asset-bad"]);
  });

  test("repairs one blocked asset before starting any new content", async () => {
    const generated: unknown[] = [];
    const repository = {
      async listEnabled() { return [{ workspaceId: "workspace-1", strategyVersionId: "strategy-1", cadence: { postsPerWeek: 3, preferredDays: [1, 3, 5], timezone: "Europe/Paris" } }]; },
      async listGenerationCandidates() { return [{ ideaId: "idea-new" }]; },
      async listRepairCandidates() {
        return [
          { assetId: "asset-blocked", attempt: 1, blockers: ["ungrounded_statement", "generic_language"] },
          { assetId: "asset-blocked-2", attempt: 1, blockers: ["repetition"] },
        ];
      },
      async listPublicationCandidates() { return []; },
      async listOccupiedPublicationTimes() { return []; },
      async recordDeferred() {},
    } as unknown as ContentAutopilotRepository;
    const generation = {
      async createGeneration(input: unknown) { generated.push(input); return {} as never; },
    } as unknown as ContentGenerationRepository;
    const publications = { async schedule() { return {} as never; } } as unknown as ContentPublicationApplication;
    const reconciler = new ContentAutopilotReconciler(repository, generation, publications, { now: () => new Date("2026-08-20T10:00:00.000Z") });

    expect(await reconciler.reconcile()).toBe(1);
    expect(generated).toEqual([expect.objectContaining({
      workspaceId: "workspace-1",
      userId: null,
      assetId: "asset-blocked",
      operation: "asset.improve",
      requestKey: "autopilot:repair:asset-blocked:linkedin-editorial-v2:v1",
      instruction: expect.stringContaining("ungrounded_statement"),
    })]);
  });
});

function localKey(date: Date, timezone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
