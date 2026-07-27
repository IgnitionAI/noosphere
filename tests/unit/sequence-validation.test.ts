import { describe, expect, test } from "bun:test";
import {
  CHANNEL_LIMITS,
  validateSequenceSteps,
  type SequenceStepInput,
} from "@outbound/domain/campaigns/sequence-validation";

function step(partial: Partial<SequenceStepInput>): SequenceStepInput {
  return {
    position: 1,
    kind: "manual_task",
    delayDays: 0,
    windowStart: null,
    windowEnd: null,
    subject: null,
    body: "Relancer {{firstName}}",
    fallbackKind: null,
    ...partial,
  };
}

describe("validateSequenceSteps", () => {
  test("accepts a valid multichannel sequence with a healthy fallback", () => {
    const errors = validateSequenceSteps([
      step({
        position: 1,
        kind: "linkedin_invite",
        body: "Bonjour {{firstName}}, votre gouvernance IA m’intéresse.",
        fallbackKind: "email",
      }),
      step({ position: 2, kind: "email", delayDays: 3, subject: "Votre registre IA" }),
      step({ position: 3, kind: "manual_task", delayDays: 5, body: "Appeler le standard" }),
    ]);
    expect(errors).toEqual([]);
  });

  test("rejects an invitation longer than the LinkedIn limit", () => {
    const errors = validateSequenceSteps([
      step({ kind: "linkedin_invite", body: "x".repeat(CHANNEL_LIMITS.linkedin_invite + 1) }),
    ]);
    expect(errors.map((error) => error.code)).toContain("STEP_BODY_TOO_LONG");
  });

  test("rejects an email without subject", () => {
    const errors = validateSequenceSteps([step({ kind: "email", body: "Corps" })]);
    expect(errors.map((error) => error.code)).toContain("EMAIL_SUBJECT_REQUIRED");
  });

  test("rejects a channel step without body and an unknown variable", () => {
    const errors = validateSequenceSteps([
      step({ kind: "whatsapp", body: "" }),
      step({ kind: "linkedin_message", body: "Salut {{phoneNumber}}" }),
    ]);
    expect(errors.map((error) => error.code)).toContain("STEP_BODY_REQUIRED");
    expect(errors.map((error) => error.code)).toContain("UNKNOWN_TEMPLATE_VARIABLE");
  });

  test("rejects a manual task without instruction", () => {
    const errors = validateSequenceSteps([step({ kind: "manual_task", body: " " })]);
    expect(errors.map((error) => error.code)).toContain("STEP_BODY_REQUIRED");
  });

  test("rejects a fallback on a manual task and a fallback identical to the channel", () => {
    const errors = validateSequenceSteps([
      step({ kind: "manual_task", fallbackKind: "email" }),
      step({ position: 2, kind: "email", subject: "S", fallbackKind: "email" }),
    ]);
    expect(errors.map((error) => error.code)).toContain("FALLBACK_NOT_ALLOWED");
    expect(errors.map((error) => error.code)).toContain("FALLBACK_SAME_AS_CHANNEL");
  });

  test("rejects an invalid sending window", () => {
    const errors = validateSequenceSteps([
      step({ windowStart: "18:00", windowEnd: "09:00", kind: "email", subject: "S" }),
      step({ position: 2, windowStart: "9h00" }),
    ]);
    expect(errors.map((error) => error.code)).toContain("INVALID_SENDING_WINDOW");
  });

  test("rejects duplicate positions and negative delays", () => {
    const errors = validateSequenceSteps([
      step({ position: 1, delayDays: -1 }),
      step({ position: 1 }),
    ]);
    expect(errors.map((error) => error.code)).toContain("DUPLICATE_STEP_POSITION");
    expect(errors.map((error) => error.code)).toContain("INVALID_STEP_DELAY");
  });
});
