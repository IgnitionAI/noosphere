import { describe, expect, test } from "bun:test";
import {
  approvalItems,
  mcpEffectProposals,
} from "@outbound/infrastructure/database/schema";

type IsAny<T> = 0 extends (1 & T) ? true : false;
type ExpectFalse<T extends false> = T;

// These compile-time guards prevent circular-FK workarounds from widening the
// table declarations and erasing Drizzle's inferred row types.
type ProposalInsertIsTyped = ExpectFalse<IsAny<typeof mcpEffectProposals.$inferInsert>>;
type ProposalSelectIsTyped = ExpectFalse<IsAny<typeof mcpEffectProposals.$inferSelect>>;
type ApprovalInsertIsTyped = ExpectFalse<IsAny<typeof approvalItems.$inferInsert>>;
type ApprovalSelectIsTyped = ExpectFalse<IsAny<typeof approvalItems.$inferSelect>>;
const proposalInsertIsTyped: ProposalInsertIsTyped = false;
const proposalSelectIsTyped: ProposalSelectIsTyped = false;
const approvalInsertIsTyped: ApprovalInsertIsTyped = false;
const approvalSelectIsTyped: ApprovalSelectIsTyped = false;

describe("MCP governed-effect schema types", () => {
  test("retains concrete Drizzle insert fields through circular FKs", () => {
    expect(proposalInsertIsTyped).toBe(false);
    expect(proposalSelectIsTyped).toBe(false);
    expect(approvalInsertIsTyped).toBe(false);
    expect(approvalSelectIsTyped).toBe(false);
    const kind: typeof mcpEffectProposals.$inferInsert.kind = "conversation_reply";
    expect(kind).toBe("conversation_reply");
    const acceptsKind = (value: typeof mcpEffectProposals.$inferInsert.kind): string => value;
    // @ts-expect-error Drizzle must reject a non-string proposal kind.
    acceptsKind(42);
  });
});
