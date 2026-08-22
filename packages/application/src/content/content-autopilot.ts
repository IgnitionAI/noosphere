import type { ContentGenerationRepository } from "@outbound/application/content/content-generation";
import type { ContentPublicationApplication } from "@outbound/application/content/content-publications";
import type { Clock } from "@outbound/application/shared/ports";
import { CONTENT_EDITORIAL_POLICY_VERSION } from "@outbound/domain/content/content-asset";

export interface ContentAutopilotCadence {
  readonly postsPerWeek: number;
  readonly preferredDays: readonly number[];
  readonly publicationTimes: readonly string[];
  readonly timezone: string;
}

export function resolveContentAutopilotCadence(input: {
  readonly strategyCadence: Omit<ContentAutopilotCadence, "publicationTimes">;
  readonly publicationTimes?: readonly string[] | null | undefined;
  readonly publicationDays?: readonly number[] | null | undefined;
  readonly timezone?: string | null | undefined;
}): ContentAutopilotCadence {
  const publicationTimes = input.publicationTimes?.length
    ? [...new Set(input.publicationTimes)].sort()
    : ["09:00"];
  const preferredDays = input.publicationDays?.length
    ? [...new Set(input.publicationDays)].sort((left, right) => left - right)
    : [...input.strategyCadence.preferredDays];
  const hasOperationalOverride = Boolean(input.publicationTimes?.length || input.publicationDays?.length);
  return {
    postsPerWeek: hasOperationalOverride
      ? publicationTimes.length * preferredDays.length
      : input.strategyCadence.postsPerWeek,
    preferredDays,
    publicationTimes,
    timezone: input.timezone ?? input.strategyCadence.timezone,
  };
}

export interface ContentAutopilotView {
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly localTime: string;
  readonly timezone: string;
  readonly publicationTimes: readonly string[];
  readonly publicationDays: readonly number[];
  readonly postsPerWeek: number;
  readonly lastRunAt: Date | null;
  readonly nextRunAt: Date | null;
  readonly nextPublicationAt: Date | null;
  readonly queuedIdeas: number;
  readonly generatingAssets: number;
  readonly readyAssets: number;
  readonly scheduledPublications: number;
  readonly blockedAssets: number;
  readonly exceptions: number;
}

export interface ContentAutopilotWorkspace {
  readonly workspaceId: string;
  readonly strategyVersionId: string;
  readonly cadence: ContentAutopilotCadence;
}

export interface ContentAutopilotRepairCandidate {
  readonly assetId: string;
  readonly attempt: number;
  readonly blockers: readonly string[];
}

export interface ContentAutopilotRepository {
  get(input: { readonly workspaceId: string }): Promise<ContentAutopilotView>;
  configure(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly requestKey: string;
    readonly enabled: boolean;
    readonly localTime: string;
    readonly timezone: string;
    readonly publicationTimes?: readonly string[];
    readonly publicationDays?: readonly number[];
    readonly now: Date;
  }): Promise<ContentAutopilotView>;
  listEnabled(input: { readonly limit: number }): Promise<readonly ContentAutopilotWorkspace[]>;
  listGenerationCandidates(input: { readonly workspaceId: string; readonly strategyVersionId: string; readonly now: Date; readonly limit: number }): Promise<readonly { readonly ideaId: string }[]>;
  listRepairCandidates(input: { readonly workspaceId: string; readonly strategyVersionId: string; readonly limit: number }): Promise<readonly ContentAutopilotRepairCandidate[]>;
  listPublicationCandidates(input: { readonly workspaceId: string; readonly strategyVersionId: string; readonly limit: number }): Promise<readonly { readonly assetId: string; readonly assetVersionId: string; readonly publicationSequence: number }[]>;
  listOccupiedPublicationTimes(input: { readonly workspaceId: string; readonly from: Date; readonly to: Date }): Promise<readonly Date[]>;
  recordDeferred(input: { readonly workspaceId: string; readonly assetId: string; readonly code: string; readonly message: string; readonly now: Date }): Promise<void>;
}

export class ContentAutopilotApplication {
  constructor(
    private readonly repository: ContentAutopilotRepository,
    private readonly clock: Clock,
  ) {}

  get(workspaceId: string): Promise<ContentAutopilotView> {
    return this.repository.get({ workspaceId });
  }

  configure(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly requestKey: string;
    readonly enabled: boolean;
    readonly localTime: string;
    readonly timezone: string;
    readonly publicationTimes?: readonly string[];
    readonly publicationDays?: readonly number[];
  }): Promise<ContentAutopilotView> {
    return this.repository.configure({ ...input, now: this.clock.now() });
  }
}

export class ContentAutopilotReconciler {
  constructor(
    private readonly repository: ContentAutopilotRepository,
    private readonly generation: ContentGenerationRepository,
    private readonly publications: ContentPublicationApplication,
    private readonly clock: Clock,
  ) {}

  async reconcile(limit = 25): Promise<number> {
    const now = this.clock.now();
    const workspaces = await this.repository.listEnabled({ limit });
    let progressed = 0;
    for (const workspace of workspaces) {
      progressed += await this.#reconcileWorkspace(workspace, now);
    }
    return progressed;
  }

  async #reconcileWorkspace(workspace: ContentAutopilotWorkspace, now: Date): Promise<number> {
    let progressed = 0;
    const repairCandidates = await this.repository.listRepairCandidates({
      workspaceId: workspace.workspaceId,
      strategyVersionId: workspace.strategyVersionId,
      limit: Math.min(8, Math.max(2, workspace.cadence.postsPerWeek)),
    });
    for (const candidate of repairCandidates.slice(0, 1)) {
      await this.generation.createGeneration({
        workspaceId: workspace.workspaceId,
        userId: null,
        assetId: candidate.assetId,
        operation: "asset.improve",
        requestKey: `autopilot:repair:${candidate.assetId}:${CONTENT_EDITORIAL_POLICY_VERSION}:v${candidate.attempt}`,
        instruction: automaticRepairInstruction(candidate.blockers),
        now,
      });
      progressed += 1;
    }

    if (repairCandidates.length === 0) {
      const generationCandidates = await this.repository.listGenerationCandidates({
        workspaceId: workspace.workspaceId,
        strategyVersionId: workspace.strategyVersionId,
        now,
        limit: 1,
      });
      for (const candidate of generationCandidates.slice(0, 1)) {
        await this.generation.createGeneration({
          workspaceId: workspace.workspaceId,
          userId: null,
          ideaId: candidate.ideaId,
          operation: "asset.generate",
          requestKey: `autopilot:generation:${candidate.ideaId}`,
          now,
        });
        progressed += 1;
      }
    }

    const candidates = await this.repository.listPublicationCandidates({
      workspaceId: workspace.workspaceId,
      strategyVersionId: workspace.strategyVersionId,
      limit: 14,
    });
    if (candidates.length === 0) return progressed;
    const horizon = new Date(now.getTime() + 56 * 86_400_000);
    const occupied = await this.repository.listOccupiedPublicationTimes({
      workspaceId: workspace.workspaceId,
      from: new Date(now.getTime() - 7 * 86_400_000),
      to: horizon,
    });
    const slots = nextCadenceSlots({
      now,
      cadence: workspace.cadence,
      occupied,
      count: candidates.length,
    });
    for (const [index, candidate] of candidates.entries()) {
      const scheduledFor = slots[index];
      if (!scheduledFor) break;
      try {
        await this.publications.schedule({
          workspaceId: workspace.workspaceId,
          userId: null,
          assetId: candidate.assetId,
          requestKey: `autopilot:publication:${candidate.assetVersionId}:v${candidate.publicationSequence}`,
          scheduledFor,
          now,
        });
        progressed += 1;
      } catch (error) {
        await this.repository.recordDeferred({
          workspaceId: workspace.workspaceId,
          assetId: candidate.assetId,
          code: errorCode(error),
          message: error instanceof Error ? error.message : String(error),
          now,
        });
      }
    }
    return progressed;
  }
}

function automaticRepairInstruction(blockers: readonly string[]): string {
  const bounded = [...new Set(blockers)].slice(0, 8);
  return [
    "Produis une nouvelle version autonome à partir du même brief et des mêmes preuves.",
    `Répare strictement ces blocages sans ajouter de fait ni de claim : ${bounded.join(", ") || "editorial_blocker"}.`,
    "Supprime toute phrase non prouvée, formulation générique ou répétition signalée. Garde un hook spécifique et un seul CTA aligné.",
  ].join(" ");
}

export function nextCadenceSlots(input: {
  readonly now: Date;
  readonly cadence: Omit<ContentAutopilotCadence, "publicationTimes"> & { readonly publicationTimes?: readonly string[] };
  readonly occupied: readonly Date[];
  readonly count: number;
  readonly localTime?: string;
}): readonly Date[] {
  if (input.count <= 0) return [];
  const publicationTimes = [...new Set(input.cadence.publicationTimes ?? [input.localTime ?? "09:00"])].sort();
  const preferredDays = new Set(input.cadence.preferredDays);
  const usedByWeek = new Map<string, number>();
  const usedSlots = new Set<string>();
  for (const occupied of input.occupied) {
    usedSlots.add(localDateTimeKey(occupied, input.cadence.timezone));
    const week = isoWeekKey(occupied, input.cadence.timezone);
    usedByWeek.set(week, (usedByWeek.get(week) ?? 0) + 1);
  }
  const slots: Date[] = [];
  for (let offset = 0; offset < 84 && slots.length < input.count; offset += 1) {
    for (const publicationTime of publicationTimes) {
      const candidate = localOccurrence(input.now, offset, publicationTime, input.cadence.timezone);
      if (candidate.getTime() <= input.now.getTime() + 60_000) continue;
      const day = isoDay(candidate, input.cadence.timezone);
      if (!preferredDays.has(day)) continue;
      const slotKey = localDateTimeKey(candidate, input.cadence.timezone);
      if (usedSlots.has(slotKey)) continue;
      const week = isoWeekKey(candidate, input.cadence.timezone);
      if ((usedByWeek.get(week) ?? 0) >= input.cadence.postsPerWeek) continue;
      slots.push(candidate);
      usedSlots.add(slotKey);
      usedByWeek.set(week, (usedByWeek.get(week) ?? 0) + 1);
      if (slots.length >= input.count) break;
    }
  }
  return slots;
}

function localOccurrence(reference: Date, offset: number, localTime: string, timezone: string): Date {
  const parts = zonedParts(reference, timezone);
  const [hour, minute] = localTime.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error("CONTENT_AUTOPILOT_TIME_INVALID");
  const calendar = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset, hour, minute));
  let candidate = new Date(calendar.getTime() - timezoneOffsetMs(calendar, timezone));
  candidate = new Date(calendar.getTime() - timezoneOffsetMs(candidate, timezone));
  return candidate;
}

function isoDay(date: Date, timezone: string): number {
  const parts = zonedParts(date, timezone);
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

function localDateKey(date: Date, timezone: string): string {
  const parts = zonedParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localDateTimeKey(date: Date, timezone: string): string {
  const dateKey = localDateKey(date, timezone);
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${dateKey} ${values.hour}:${values.minute}`;
}

function isoWeekKey(date: Date, timezone: string): string {
  const parts = zonedParts(date, timezone);
  const current = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((current.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${current.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function zonedParts(date: Date, timezone: string): { year: number; month: number; day: number } {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second)) - date.getTime();
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^[A-Z][A-Z0-9_]{2,159}$/.test(message) ? message : "CONTENT_AUTOPILOT_ASSET_DEFERRED";
}
