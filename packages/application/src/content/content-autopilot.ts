import type { ContentGenerationRepository } from "@outbound/application/content/content-generation";
import type { ContentPublicationApplication } from "@outbound/application/content/content-publications";
import type { Clock } from "@outbound/application/shared/ports";
import type { EditorialStrategySnapshot } from "@outbound/domain/content/editorial-strategy";

export interface ContentAutopilotView {
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly localTime: string;
  readonly timezone: string;
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
  readonly cadence: EditorialStrategySnapshot["cadence"];
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
    readonly now: Date;
  }): Promise<ContentAutopilotView>;
  listEnabled(input: { readonly limit: number }): Promise<readonly ContentAutopilotWorkspace[]>;
  listGenerationCandidates(input: { readonly workspaceId: string; readonly strategyVersionId: string; readonly now: Date; readonly limit: number }): Promise<readonly { readonly ideaId: string }[]>;
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
    const generationCandidates = await this.repository.listGenerationCandidates({
      workspaceId: workspace.workspaceId,
      strategyVersionId: workspace.strategyVersionId,
      now,
      limit: Math.min(14, Math.max(2, workspace.cadence.postsPerWeek * 2)),
    });
    for (const candidate of generationCandidates) {
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

export function nextCadenceSlots(input: {
  readonly now: Date;
  readonly cadence: EditorialStrategySnapshot["cadence"];
  readonly occupied: readonly Date[];
  readonly count: number;
  readonly localTime?: string;
}): readonly Date[] {
  if (input.count <= 0) return [];
  const localTime = input.localTime ?? "09:00";
  const preferredDays = new Set(input.cadence.preferredDays);
  const usedByWeek = new Map<string, number>();
  const usedDays = new Set<string>();
  for (const occupied of input.occupied) {
    const key = localDateKey(occupied, input.cadence.timezone);
    usedDays.add(key);
    const week = isoWeekKey(occupied, input.cadence.timezone);
    usedByWeek.set(week, (usedByWeek.get(week) ?? 0) + 1);
  }
  const slots: Date[] = [];
  for (let offset = 0; offset < 84 && slots.length < input.count; offset += 1) {
    const candidate = localOccurrence(input.now, offset, localTime, input.cadence.timezone);
    if (candidate.getTime() <= input.now.getTime() + 60_000) continue;
    const day = isoDay(candidate, input.cadence.timezone);
    if (!preferredDays.has(day)) continue;
    const dateKey = localDateKey(candidate, input.cadence.timezone);
    if (usedDays.has(dateKey)) continue;
    const week = isoWeekKey(candidate, input.cadence.timezone);
    if ((usedByWeek.get(week) ?? 0) >= input.cadence.postsPerWeek) continue;
    slots.push(candidate);
    usedDays.add(dateKey);
    usedByWeek.set(week, (usedByWeek.get(week) ?? 0) + 1);
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
