import { describe, expect, test } from "bun:test";
import { classifyPriorityInbound, normalizeInboundWebhook } from "@outbound/infrastructure/campaigns/inbound-reply-runner";

const now = new Date("2026-08-13T10:00:00.000Z");

describe("inbound priority rules", () => {
  test.each([
    ["unsubscribe", { event: "mail_received", text: "Merci de me désinscrire de vos messages." }, "unsubscribe", "stop"],
    ["bounce", { event: "mail_delivery_failed", subject: "Undeliverable", text: "Delivery status notification" }, "bounce", "stop"],
    ["wrong person", { event: "message_received", text: "Je ne suis pas la bonne personne pour ce sujet." }, "wrong_person", "handoff"],
    ["referral", { event: "message_received", text: "Contactez plutôt notre directrice juridique à claire@example.com" }, "referral", "handoff"],
  ] as const)("classifies %s without an LLM", (_name, payload, intent, action) => {
    expect(classifyPriorityInbound(payload, incoming(payload.text), now)).toMatchObject({ intent, action, confidence: 1 });
  });

  test("extracts an explicit not-now date", () => {
    expect(classifyPriorityInbound(
      { event: "message_received", text: "Pas maintenant, revenez vers moi le 30/09/2026." },
      incoming("Pas maintenant, revenez vers moi le 30/09/2026."),
      now,
    )).toMatchObject({ intent: "not_now", action: "wait", resumeAt: "2026-09-30T09:00:00.000Z" });
  });

  test("schedules an out-of-office recheck after the explicit return date", () => {
    expect(classifyPriorityInbound(
      { event: "mail_received", subject: "Réponse automatique", text: "Absent du bureau, de retour le 2026-08-24." },
      incoming("Absent du bureau, de retour le 2026-08-24."),
      now,
    )).toMatchObject({ intent: "out_of_office", action: "wait", resumeAt: "2026-08-24T09:00:00.000Z" });
  });

  test("returns null for content that needs structured agent classification", () => {
    expect(classifyPriorityInbound(
      { event: "message_received", text: "Comment gérez-vous la sécurité ?" },
      incoming("Comment gérez-vous la sécurité ?"),
      now,
    )).toBeNull();
  });

  test("normalizes a provider bounce even when the webhook has no thread or body", () => {
    expect(normalizeInboundWebhook({
      event: "mail_delivery_failed",
      account_id: "account",
      id: "bounce-event",
      direction: "inbound",
    })).toMatchObject({
      channel: "email",
      threadId: "bounce-event",
      messageId: "bounce-event",
      body: "mail_delivery_failed",
      inbound: true,
    });
  });
});

function incoming(body: string) {
  return {
    accountId: "account",
    channel: "email" as const,
    threadId: "thread",
    messageId: crypto.randomUUID(),
    body,
    senderValue: "prospect@example.com",
    senderProviderId: null,
    occurredAt: now,
    inbound: true,
  };
}
