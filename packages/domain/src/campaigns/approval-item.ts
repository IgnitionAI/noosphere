export type ApprovalItemStatus = "pending" | "approved" | "rejected" | "invalidated";
export type ApprovalDecision = "approve" | "reject";

export function decideApprovalItem(status: ApprovalItemStatus, decision: ApprovalDecision, justification?: string): { status: ApprovalItemStatus; changed: boolean } {
  if (status === "invalidated") throw new Error("APPROVAL_ITEM_INVALIDATED");
  if (decision === "reject" && !justification?.trim()) throw new Error("REJECTION_JUSTIFICATION_REQUIRED");
  if (status === decisionStatus(decision)) return { status, changed: false };
  if (status !== "pending") throw new Error("APPROVAL_ITEM_DECISION_CONFLICT");
  return { status: decisionStatus(decision), changed: true };
}

export function invalidateApprovalItem(status: ApprovalItemStatus, reason: string): { status: ApprovalItemStatus; changed: boolean } {
  if (status !== "pending") return { status, changed: false };
  if (!reason.trim()) throw new Error("INVALIDATION_REASON_REQUIRED");
  return { status: "invalidated", changed: true };
}

function decisionStatus(decision: ApprovalDecision): ApprovalItemStatus { return decision === "approve" ? "approved" : "rejected"; }
