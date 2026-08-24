export type OutreachActionStatus = "planned" | "awaiting_approval" | "due" | "sending" | "sent" | "failed" | "cancelled" | "suspended";

export type OutreachActionTransition = "due" | "send" | "sent" | "failed" | "cancel" | "retry" | "awaiting_approval" | "suspend";

export function transitionOutreachAction(status: OutreachActionStatus, transition: OutreachActionTransition): { status: OutreachActionStatus; changed: boolean } {
  if (transition === "cancel") {
    if (status === "cancelled") return { status, changed: false };
    if (status === "sent") throw new Error("OUTREACH_ACTION_ALREADY_SENT");
    return { status: "cancelled", changed: true };
  }
  if (transition === "retry") {
    if (status === "failed" || status === "suspended") return { status: "due", changed: true };
    if (status === "due" || status === "planned") return { status, changed: false };
    throw new Error("OUTREACH_ACTION_RETRY_CONFLICT");
  }
  if (transition === "due") {
    if (status === "due") return { status, changed: false };
    if (status !== "planned") throw new Error("OUTREACH_ACTION_DUE_CONFLICT");
    return { status: "due", changed: true };
  }
  if (transition === "awaiting_approval") {
    if (status === "awaiting_approval") return { status, changed: false };
    if (status !== "planned" && status !== "due") throw new Error("OUTREACH_ACTION_APPROVAL_CONFLICT");
    return { status: "awaiting_approval", changed: true };
  }
  if (transition === "send") {
    if (status !== "due") throw new Error("OUTREACH_ACTION_NOT_DUE");
    return { status: "sending", changed: true };
  }
  if (transition === "sent") {
    if (status === "sent") return { status, changed: false };
    if (status !== "sending") throw new Error("OUTREACH_ACTION_SEND_CONFLICT");
    return { status: "sent", changed: true };
  }
  if (transition === "suspend") {
    if (status === "suspended") return { status, changed: false };
    if (status !== "due" && status !== "planned") throw new Error("OUTREACH_ACTION_SUSPEND_CONFLICT");
    return { status: "suspended", changed: true };
  }
  if (status === "failed") return { status, changed: false };
  if (status !== "sending") throw new Error("OUTREACH_ACTION_FAILURE_CONFLICT");
  return { status: "failed", changed: true };
}

export function retryDelayMs(attempt: number, baseMs = 30_000, maxMs = 15 * 60_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}
