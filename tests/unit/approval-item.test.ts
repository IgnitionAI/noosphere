import { describe, expect, test } from "bun:test";
import { decideApprovalItem, invalidateApprovalItem } from "@outbound/domain/campaigns/approval-item";

describe("ApprovalItem", () => {
  test("approves once and replay is idempotent", () => {
    expect(decideApprovalItem("pending", "approve")).toEqual({ status: "approved", changed: true });
    expect(decideApprovalItem("approved", "approve")).toEqual({ status: "approved", changed: false });
  });

  test("requires a justification for rejection", () => {
    expect(() => decideApprovalItem("pending", "reject")).toThrow("REJECTION_JUSTIFICATION_REQUIRED");
    expect(decideApprovalItem("pending", "reject", "Not relevant")).toEqual({ status: "rejected", changed: true });
    expect(decideApprovalItem("rejected", "reject", "Not relevant")).toEqual({ status: "rejected", changed: false });
  });

  test("does not allow decisions after invalidation", () => {
    expect(invalidateApprovalItem("pending", "contact_deleted")).toEqual({ status: "invalidated", changed: true });
    expect(() => decideApprovalItem("invalidated", "approve")).toThrow("APPROVAL_ITEM_INVALIDATED");
  });
});
