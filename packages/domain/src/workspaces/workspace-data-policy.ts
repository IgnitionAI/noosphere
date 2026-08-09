import { resolveCampaignAutopilotPolicy, type CampaignAutopilotPolicy } from "../campaigns/campaign-autopilot-policy";
import type { ProspectingChannel } from "../campaigns/prospecting-plan";

export interface WorkspaceDataPolicy {
  readonly sending: {
    readonly timezone: string;
    readonly activeDays: readonly number[];
    readonly windowStart: string;
    readonly windowEnd: string;
  };
  readonly channelLimits: {
    readonly linkedin: number;
    readonly email: number;
    readonly whatsapp: number;
  };
  readonly retention: WorkspaceRetentionPolicy;
}

export interface WorkspaceRetentionPolicy {
  readonly invitationsDays: number;
  readonly jobsDays: number;
  readonly auditDays: number;
}

const CHANNEL_BOUNDS = {
  linkedin: [1, 100],
  email: [1, 500],
  whatsapp: [1, 200],
} as const;

const RETENTION_BOUNDS = {
  invitationsDays: [30, 3_650],
  jobsDays: [30, 365],
  auditDays: [365, 3_650],
} as const;

export function defaultWorkspaceDataPolicy(): WorkspaceDataPolicy {
  return {
    sending: {
      timezone: "Europe/Paris",
      activeDays: [1, 2, 3, 4, 5],
      windowStart: "09:00",
      windowEnd: "17:00",
    },
    channelLimits: { linkedin: 20, email: 50, whatsapp: 30 },
    retention: { invitationsDays: 90, jobsDays: 90, auditDays: 365 },
  };
}

export function validateWorkspaceDataPolicy(input: WorkspaceDataPolicy): WorkspaceDataPolicy {
  if (!isIanaTimezone(input.sending.timezone)) throw new Error("WORKSPACE_TIMEZONE_INVALID");
  if (!isTime(input.sending.windowStart) || !isTime(input.sending.windowEnd) || input.sending.windowStart >= input.sending.windowEnd) {
    throw new Error("WORKSPACE_SENDING_WINDOW_INVALID");
  }
  const activeDays = [...new Set(input.sending.activeDays)].sort((left, right) => left - right);
  if (!activeDays.length || activeDays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
    throw new Error("WORKSPACE_SENDING_DAYS_INVALID");
  }
  for (const channel of Object.keys(CHANNEL_BOUNDS) as Array<keyof typeof CHANNEL_BOUNDS>) {
    const value = input.channelLimits[channel];
    const [minimum, maximum] = CHANNEL_BOUNDS[channel];
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error("WORKSPACE_CHANNEL_LIMIT_INVALID");
    }
  }
  for (const category of Object.keys(RETENTION_BOUNDS) as Array<keyof typeof RETENTION_BOUNDS>) {
    const value = input.retention[category];
    const [minimum, maximum] = RETENTION_BOUNDS[category];
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error("WORKSPACE_RETENTION_INVALID");
    }
  }
  return {
    sending: { ...input.sending, activeDays },
    channelLimits: { ...input.channelLimits },
    retention: { ...input.retention },
  };
}

export function retentionWasReduced(
  current: WorkspaceRetentionPolicy,
  next: WorkspaceRetentionPolicy,
): boolean {
  return (Object.keys(current) as Array<keyof WorkspaceRetentionPolicy>)
    .some((category) => next[category] < current[category]);
}

export function assertTypedConfirmation(actual: string, expected: string): void {
  if (actual !== expected) throw new Error("TYPED_CONFIRMATION_REQUIRED");
}

export function startOfWorkspaceDay(now: Date, timezone: string): Date {
  if (!isIanaTimezone(timezone)) throw new Error("WORKSPACE_TIMEZONE_INVALID");
  const parts = zonedParts(now, timezone);
  const wallClockMidnight = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  let result = new Date(wallClockMidnight.getTime() - timezoneOffsetMs(wallClockMidnight, timezone));
  result = new Date(wallClockMidnight.getTime() - timezoneOffsetMs(result, timezone));
  return result;
}

export function campaignAutopilotFromWorkspacePolicy(policy: WorkspaceDataPolicy, channel: ProspectingChannel): CampaignAutopilotPolicy {
  const validated = validateWorkspaceDataPolicy(policy);
  return resolveCampaignAutopilotPolicy({
    schedule: {
      activeDays: validated.sending.activeDays,
      windowStart: validated.sending.windowStart,
      windowEnd: validated.sending.windowEnd,
      timezoneMode: "recipient",
      fallbackTimezone: validated.sending.timezone,
    },
  }, channel, validated.sending.timezone);
}

function isTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function zonedParts(date: Date, timezone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day") };
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const displayedAsUtc = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"));
  return displayedAsUtc - date.getTime();
}
