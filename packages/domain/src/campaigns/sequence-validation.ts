export type SequenceStepKind =
  | "linkedin_invite"
  | "linkedin_message"
  | "email"
  | "whatsapp"
  | "manual_task";

export interface SequenceStepInput {
  readonly position: number;
  readonly kind: SequenceStepKind;
  readonly delayDays: number;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly subject: string | null;
  readonly body: string;
  readonly fallbackKind: SequenceStepKind | null;
}

export interface SequenceValidationError {
  readonly code: string;
  readonly position: number;
  readonly message: string;
}

export const CHANNEL_LIMITS: Record<Exclude<SequenceStepKind, "manual_task">, number> = {
  linkedin_invite: 300,
  linkedin_message: 2_000,
  whatsapp: 1_000,
  email: 5_000,
};

export const EMAIL_SUBJECT_LIMIT = 200;

export const ALLOWED_TEMPLATE_VARIABLES = new Set([
  "firstName",
  "lastName",
  "companyName",
  "title",
  "icpName",
  "senderName",
]);

const CHANNEL_KINDS = new Set<SequenceStepKind>([
  "linkedin_invite",
  "linkedin_message",
  "email",
  "whatsapp",
]);

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;
const WINDOW_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateSequenceSteps(
  steps: readonly SequenceStepInput[],
): readonly SequenceValidationError[] {
  const errors: SequenceValidationError[] = [];
  const seenPositions = new Set<number>();
  const fallbackEdges = new Map<SequenceStepKind, { readonly target: SequenceStepKind; readonly position: number }>();
  for (const step of steps) {
    if (seenPositions.has(step.position)) {
      errors.push({
        code: "DUPLICATE_STEP_POSITION",
        position: step.position,
        message: `Position ${step.position} is used by two steps`,
      });
    }
    seenPositions.add(step.position);
    if (!Number.isInteger(step.delayDays) || step.delayDays < 0) {
      errors.push({
        code: "INVALID_STEP_DELAY",
        position: step.position,
        message: "Delay must be a non-negative integer number of days",
      });
    }
    if (!step.body.trim()) {
      errors.push({
        code: "STEP_BODY_REQUIRED",
        position: step.position,
        message:
          step.kind === "manual_task"
            ? "A manual task requires an instruction"
            : "A channel step requires a body template",
      });
    }
    for (const match of step.body.matchAll(VARIABLE_PATTERN)) {
      if (!ALLOWED_TEMPLATE_VARIABLES.has(match[1]!)) {
        errors.push({
          code: "UNKNOWN_TEMPLATE_VARIABLE",
          position: step.position,
          message: `Unknown template variable {{${match[1]}}}`,
        });
      }
    }
    if (step.kind === "email") {
      if (!step.subject?.trim()) {
        errors.push({
          code: "EMAIL_SUBJECT_REQUIRED",
          position: step.position,
          message: "An email step requires a subject",
        });
      } else if (step.subject.length > EMAIL_SUBJECT_LIMIT) {
        errors.push({
          code: "EMAIL_SUBJECT_TOO_LONG",
          position: step.position,
          message: `Email subject exceeds ${EMAIL_SUBJECT_LIMIT} characters`,
        });
      }
    }
    if (step.kind !== "manual_task") {
      const limit = CHANNEL_LIMITS[step.kind];
      if (step.body.length > limit) {
        errors.push({
          code: "STEP_BODY_TOO_LONG",
          position: step.position,
          message: `${step.kind} body exceeds ${limit} characters`,
        });
      }
    }
    if (step.fallbackKind) {
      if (!CHANNEL_KINDS.has(step.fallbackKind) || step.kind === "manual_task") {
        errors.push({
          code: "FALLBACK_NOT_ALLOWED",
          position: step.position,
          message: "A fallback is only allowed from one channel step to another channel",
        });
      } else if (step.fallbackKind === step.kind) {
        errors.push({
          code: "FALLBACK_SAME_AS_CHANNEL",
          position: step.position,
          message: "A fallback cannot reuse the step channel (double send risk)",
        });
      } else {
        fallbackEdges.set(step.kind, { target: step.fallbackKind, position: step.position });
      }
    }
    if (step.windowStart || step.windowEnd) {
      const startValid = step.windowStart !== null && WINDOW_PATTERN.test(step.windowStart);
      const endValid = step.windowEnd !== null && WINDOW_PATTERN.test(step.windowEnd);
      if (
        !startValid ||
        !endValid ||
        (startValid && endValid && step.windowStart! >= step.windowEnd!)
      ) {
        errors.push({
          code: "INVALID_SENDING_WINDOW",
          position: step.position,
          message: "Sending window must be HH:MM–HH:MM with start before end",
        });
      }
    }
  }

  // A fallback is a channel-to-channel edge. Reject cycles up front so a
  // delivery worker can never bounce between fallbacks for one logical step.
  const reportedFallbackLoops = new Set<string>();
  for (const [start] of fallbackEdges) {
    const path: SequenceStepKind[] = [];
    const visited = new Set<SequenceStepKind>();
    let current: SequenceStepKind | undefined = start;
    while (current) {
      if (visited.has(current)) {
        const cycleStart = path.indexOf(current);
        const cycleKey = path.slice(cycleStart).sort().join(",");
        if (reportedFallbackLoops.has(cycleKey)) break;
        reportedFallbackLoops.add(cycleKey);
        const edge = fallbackEdges.get(current) ?? fallbackEdges.get(start);
        errors.push({
          code: "FALLBACK_LOOP",
          position: edge?.position ?? 0,
          message: "Fallback channels cannot form a loop",
        });
        break;
      }
      path.push(current);
      visited.add(current);
      current = fallbackEdges.get(current)?.target;
    }
  }
  return errors;
}

export function fitSequenceStepContent(step: SequenceStepInput): SequenceStepInput {
  if (step.kind === "manual_task") return step;
  const body = fitText(step.body, CHANNEL_LIMITS[step.kind]);
  const subject = step.kind === "email" && step.subject
    ? fitText(step.subject, EMAIL_SUBJECT_LIMIT)
    : step.subject;
  return { ...step, body, subject };
}

function fitText(value: string, limit: number): string {
  const text = value.trim();
  if (text.length <= limit) return text;
  const questionEnd = text.lastIndexOf("?");
  if (questionEnd >= 0) {
    const questionStart = Math.max(
      text.lastIndexOf(".", questionEnd - 1),
      text.lastIndexOf("!", questionEnd - 1),
      text.lastIndexOf("\n", questionEnd - 1),
    ) + 1;
    const question = text.slice(questionStart, questionEnd + 1).trim();
    if (question.length < limit - 20) {
      const intro = truncateAtWord(text.slice(0, questionStart).trim(), limit - question.length - 1);
      return intro ? `${intro} ${question}` : question;
    }
    return `${truncateAtWord(question, limit - 1).replace(/\?+$/, "")}?`;
  }
  return truncateAtWord(text, limit);
}

function truncateAtWord(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const slice = value.slice(0, limit).trimEnd();
  const boundary = slice.lastIndexOf(" ");
  return (boundary > Math.floor(limit * 0.6) ? slice.slice(0, boundary) : slice)
    .replace(/[,:;\-]+$/, "")
    .trimEnd();
}
