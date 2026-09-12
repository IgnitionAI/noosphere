import { expect, test } from "bun:test";
import { OutboundDeliveryError, type OutboundSendRequest } from "@outbound/application/campaigns/outbound-channel-gateway";
import type { LeasedJob } from "@outbound/application/jobs/job-queue";
import { AutomatedReplySendJobProcessor } from "@outbound/infrastructure/campaigns/automated-reply-send-runner";
import { ConversationCommandJobProcessor } from "@outbound/infrastructure/campaigns/conversation-command-runner";
import { automatedReplies, contactIdentities, conversationCommands, messages } from "@outbound/infrastructure/database/schema";

for (const runner of ["manual", "automated"] as const) {
  test.each(["email", "linkedin"] as const)(`${runner} reply preserves the correct %s identifier namespace`, async (channel) => {
    const row = {
      id: "reply-1", workspaceId: "workspace-1", status: "scheduled", mode: "manual", executionMode: "live",
      body: "Synthetic reply", requestedBody: "Synthetic reply", idempotencyKey: "reply-request-1",
      providerAccountId: "account-1", providerThreadId: "thread-1", conversationId: "conversation-1",
      contactId: "contact-1", channel, firstName: "Test", lastName: "Person",
      contactFirstName: "Test", contactLastName: "Person", inboundProviderMessageId: "mirrored-local-id", inboundOccurredAt: null,
    };
    const fixtureRows = new Map<unknown, unknown[]>([
      [conversationCommands, [row]],
      [automatedReplies, runner === "automated" ? [row] : []],
      [contactIdentities, [{ value: "person@example.test", normalizedValue: "person@example.test" }]],
      [messages, [{ providerMessageId: "mirrored-local-id" }]],
    ]);
    const database = {
      select: () => ({ from: (table: unknown) => {
        const query = { innerJoin: () => query, leftJoin: () => query, where: () => query, orderBy: () => query, limit: async () => fixtureRows.get(table) ?? [] };
        return query;
      } }),
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: row.id }] }) }) }),
    };
    const requests: OutboundSendRequest[] = [];
    const gateway = { send: async (request: OutboundSendRequest) => {
      requests.push(request);
      // End at the transport boundary; this test does not simulate persistence
      // after a successful external send or touch a database/provider.
      throw new OutboundDeliveryError("FIXTURE_NOT_SENT", "Controlled transport refusal", "not_sent", false);
    } };
    const queue = { acknowledge: async () => {} };
    const clock = { now: () => new Date("2026-09-10T12:00:00Z") };
    const processor = runner === "manual"
      ? new ConversationCommandJobProcessor(database as never, queue as never, gateway, {} as never, clock, null)
      : new AutomatedReplySendJobProcessor(database as never, queue as never, gateway, clock);
    await processor.process({ id: "job-1", workspaceId: row.workspaceId, lockedBy: "worker-1", payload: { workspaceId: row.workspaceId, commandId: row.id, replyId: row.id } } as LeasedJob);
    expect(requests).toHaveLength(1);
    if (channel === "email") {
      expect(requests[0]!.replyToUnipileMessageId).toBe("mirrored-local-id");
      expect(requests[0]!.replyToProviderMessageId).toBeUndefined();
    } else {
      expect(requests[0]!.replyToProviderMessageId).toBe("mirrored-local-id");
      expect(requests[0]!.replyToUnipileMessageId).toBeUndefined();
    }
  });
}
