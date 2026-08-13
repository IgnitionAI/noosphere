import type { ProspectingChannel } from "./prospecting-plan";

export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface CampaignSendSchedule {
  readonly activeDays: readonly IsoWeekday[];
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly timezoneMode: "recipient" | "workspace";
  readonly fallbackTimezone: string;
}

export interface EmailAutopilotPolicy {
  readonly language: "auto" | "fr" | "en";
  readonly firstMessageInstructions: string | null;
  readonly followUpInstructions: string | null;
  readonly followUpDelaysBusinessDays: readonly number[];
  readonly autoReplyEnabled: boolean;
  readonly replyDelayMinutes: number;
  readonly replyInstructions: string | null;
  readonly bookingUrl: string | null;
  readonly stopOnHumanActivity: boolean;
}

export interface CampaignAutopilotPolicy {
  readonly version: 1;
  readonly enabled: boolean;
  readonly executionMode: "dry_run" | "live";
  readonly schedule: CampaignSendSchedule;
  readonly email: EmailAutopilotPolicy;
}

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5];

export function defaultCampaignAutopilotPolicy(
  channel: ProspectingChannel,
  fallbackTimezone = "Europe/Paris",
): CampaignAutopilotPolicy {
  const safeTimezone = isIanaTimezone(fallbackTimezone) ? fallbackTimezone : "UTC";
  return {
    version: 1,
    enabled: true,
    executionMode: "dry_run",
    schedule: {
      activeDays: WEEKDAYS,
      windowStart: "09:00",
      windowEnd: channel === "email" ? "17:00" : "17:30",
      timezoneMode: "recipient",
      fallbackTimezone: safeTimezone,
    },
    email: {
      language: "auto",
      firstMessageInstructions: null,
      followUpInstructions: null,
      followUpDelaysBusinessDays: [4, 10],
      autoReplyEnabled: true,
      replyDelayMinutes: 2,
      replyInstructions: null,
      bookingUrl: null,
      stopOnHumanActivity: true,
    },
  };
}

export function resolveCampaignAutopilotPolicy(
  value: unknown,
  channel: ProspectingChannel,
  fallbackTimezone = "Europe/Paris",
): CampaignAutopilotPolicy {
  const defaults = defaultCampaignAutopilotPolicy(channel, fallbackTimezone);
  if (!isRecord(value)) return defaults;
  const schedule = isRecord(value.schedule) ? value.schedule : {};
  const email = isRecord(value.email) ? value.email : {};
  const activeDays = Array.isArray(schedule.activeDays)
    ? [...new Set(schedule.activeDays.filter(isIsoWeekday))].sort()
    : [...defaults.schedule.activeDays];
  const configuredTimezone = stringValue(schedule.fallbackTimezone);
  return {
    version: 1,
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
    executionMode: value.executionMode === "live" ? "live" : "dry_run",
    schedule: {
      activeDays: activeDays.length ? activeDays : [...defaults.schedule.activeDays],
      windowStart: validTime(schedule.windowStart) ?? defaults.schedule.windowStart,
      windowEnd: validTime(schedule.windowEnd) ?? defaults.schedule.windowEnd,
      timezoneMode: schedule.timezoneMode === "workspace" ? "workspace" : "recipient",
      fallbackTimezone: configuredTimezone && isIanaTimezone(configuredTimezone)
        ? configuredTimezone
        : defaults.schedule.fallbackTimezone,
    },
    email: {
      language: email.language === "fr" || email.language === "en" ? email.language : "auto",
      firstMessageInstructions: nullableText(email.firstMessageInstructions, 3_000),
      followUpInstructions: nullableText(email.followUpInstructions, 3_000),
      followUpDelaysBusinessDays: positiveIntegerArray(email.followUpDelaysBusinessDays, 3)
        ?? defaults.email.followUpDelaysBusinessDays,
      autoReplyEnabled: typeof email.autoReplyEnabled === "boolean"
        ? email.autoReplyEnabled
        : defaults.email.autoReplyEnabled,
      replyDelayMinutes: boundedInteger(email.replyDelayMinutes, 0, 1_440)
        ?? defaults.email.replyDelayMinutes,
      replyInstructions: nullableText(email.replyInstructions, 3_000),
      bookingUrl: safeHttpUrl(email.bookingUrl),
      stopOnHumanActivity: true,
    },
  };
}

export function mergeCampaignAutopilotPolicy(
  current: unknown,
  patch: unknown,
  channel: ProspectingChannel,
  fallbackTimezone = "Europe/Paris",
): CampaignAutopilotPolicy {
  const existing = resolveCampaignAutopilotPolicy(current, channel, fallbackTimezone);
  if (!isRecord(patch)) return existing;
  return resolveCampaignAutopilotPolicy({
    ...existing,
    ...patch,
    schedule: {
      ...existing.schedule,
      ...(isRecord(patch.schedule) ? patch.schedule : {}),
    },
    email: {
      ...existing.email,
      ...(isRecord(patch.email) ? patch.email : {}),
    },
  }, channel, fallbackTimezone);
}

export function recipientTimezoneFromEvidence(
  evidence: unknown,
  fallbackTimezone: string,
): string {
  if (isRecord(evidence)) {
    for (const key of ["timezone", "timeZone", "ianaTimezone"] as const) {
      const candidate = stringValue(evidence[key]);
      if (candidate && isIanaTimezone(candidate)) return candidate;
    }
  }
  return isIanaTimezone(fallbackTimezone) ? fallbackTimezone : "UTC";
}

export function nextAllowedCampaignSendAt(input: {
  readonly from: Date;
  readonly delayBusinessDays: number;
  readonly schedule: CampaignSendSchedule;
  readonly recipientTimezone?: string | null;
}): Date {
  const timezone = input.schedule.timezoneMode === "recipient"
    && input.recipientTimezone
    && isIanaTimezone(input.recipientTimezone)
    ? input.recipientTimezone
    : input.schedule.fallbackTimezone;
  const safeTimezone = isIanaTimezone(timezone) ? timezone : "UTC";
  const delay = Math.max(0, Math.floor(input.delayBusinessDays));
  const startMinutes = timeToMinutes(input.schedule.windowStart);
  const endMinutes = timeToMinutes(input.schedule.windowEnd);
  const activeDays = new Set(input.schedule.activeDays);
  if (!activeDays.size || startMinutes >= endMinutes) {
    throw new Error("CAMPAIGN_SEND_SCHEDULE_INVALID");
  }

  const local = zonedParts(input.from, safeTimezone);
  if (delay === 0 && activeDays.has(local.weekday)) {
    const currentMinutes = local.hour * 60 + local.minute;
    if (currentMinutes >= startMinutes && currentMinutes < endMinutes) return new Date(input.from);
    if (currentMinutes < startMinutes) {
      return zonedLocalToUtc({ ...local, ...minutesToTime(startMinutes) }, safeTimezone);
    }
  }

  let cursor = { year: local.year, month: local.month, day: local.day };
  let remaining = delay === 0 ? 1 : delay;
  for (let guard = 0; guard < 370; guard += 1) {
    cursor = addLocalDays(cursor, 1);
    const weekday = isoWeekday(cursor);
    if (!activeDays.has(weekday)) continue;
    remaining -= 1;
    if (remaining === 0) {
      return zonedLocalToUtc({
        ...cursor,
        ...minutesToTime(startMinutes),
        second: 0,
      }, safeTimezone);
    }
  }
  throw new Error("CAMPAIGN_SEND_SCHEDULE_UNRESOLVABLE");
}

export function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function zonedParts(value: Date, timezone: string): ZonedDateTime {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const result = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = {
    year: Number(result.year),
    month: Number(result.month),
    day: Number(result.day),
  };
  return {
    ...date,
    hour: Number(result.hour),
    minute: Number(result.minute),
    second: Number(result.second),
    weekday: isoWeekday(date),
  };
}

function zonedLocalToUtc(
  value: Omit<ZonedDateTime, "weekday">,
  timezone: string,
): Date {
  const target = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
  let candidate = new Date(target);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const displayed = zonedParts(candidate, timezone);
    const displayedEpoch = Date.UTC(
      displayed.year,
      displayed.month - 1,
      displayed.day,
      displayed.hour,
      displayed.minute,
      displayed.second,
    );
    candidate = new Date(candidate.getTime() + target - displayedEpoch);
  }
  return candidate;
}

function addLocalDays(value: LocalDate, count: number): LocalDate {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + count));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function isoWeekday(value: LocalDate): IsoWeekday {
  const weekday = new Date(Date.UTC(value.year, value.month - 1, value.day)).getUTCDay();
  return (weekday === 0 ? 7 : weekday) as IsoWeekday;
}

function timeToMinutes(value: string): number {
  if (!TIME_PATTERN.test(value)) throw new Error("CAMPAIGN_SEND_TIME_INVALID");
  const [hour, minute] = value.split(":").map(Number);
  return hour! * 60 + minute!;
}

function minutesToTime(value: number) {
  return { hour: Math.floor(value / 60), minute: value % 60, second: 0 };
}

function validTime(value: unknown): string | null {
  return typeof value === "string" && TIME_PATTERN.test(value) ? value : null;
}

function isIsoWeekday(value: unknown): value is IsoWeekday {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 7;
}

function positiveIntegerArray(value: unknown, maxItems: number): number[] | null {
  if (!Array.isArray(value)) return null;
  const result = value
    .filter((item): item is number => Number.isSafeInteger(item) && item > 0 && item <= 90)
    .slice(0, maxItems);
  return result.length ? result : null;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : null;
}

function nullableText(value: unknown, maximum: number): string | null {
  const text = stringValue(value);
  return text ? text.slice(0, maximum) : null;
}

function safeHttpUrl(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

interface LocalDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface ZonedDateTime extends LocalDate {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly weekday: IsoWeekday;
}
