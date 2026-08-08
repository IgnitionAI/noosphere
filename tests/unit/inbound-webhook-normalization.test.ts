import { describe, expect, test } from "bun:test";
import { normalizeInboundWebhook } from "@outbound/infrastructure/campaigns/inbound-reply-runner";

describe("Unipile inbound webhook normalization", () => {
  test("normalizes an inbound LinkedIn message", () => {
    expect(normalizeInboundWebhook({
      event: "message_received",
      account_id: "acc_linkedin",
      account_type: "LINKEDIN",
      chat_id: "chat_1",
      message_id: "message_1",
      message: "Oui, je suis disponible mardi.",
      sender: { attendee_provider_id: "provider_contact" },
      account_info: { user_id: "provider_owner" },
      timestamp: "2026-08-02T12:00:00.000Z",
    })).toMatchObject({
      accountId: "acc_linkedin",
      channel: "linkedin",
      threadId: "chat_1",
      messageId: "message_1",
      senderProviderId: "provider_contact",
      inbound: true,
    });
  });

  test("normalizes the official Unipile mail_received payload", () => {
    expect(normalizeInboundWebhook({
      email_id: "email_1",
      account_id: "acc_mail",
      event: "mail_received",
      date: "2026-08-02T12:00:00.000Z",
      from_attendee: { display_name: "Marie", identifier: "marie@example.com" },
      provider_id: "provider-email-1",
      message_id: "message-email-1",
      subject: "Re: Ignition",
      body: "Pouvez-vous me proposer un rendez-vous ?",
      in_reply_to: { id: "thread-email-1" },
    })).toMatchObject({
      accountId: "acc_mail",
      channel: "email",
      threadId: "thread-email-1",
      messageId: "message-email-1",
      senderValue: "marie@example.com",
      inbound: true,
    });
  });

  test("identifies sent-message webhook echoes as outbound", () => {
    expect(normalizeInboundWebhook({
      account_id: "acc_linkedin",
      account_type: "LINKEDIN",
      chat_id: "chat_1",
      id: "message_1",
      text: "Bonjour",
      sender: { attendee_provider_id: "provider_owner" },
      account_info: { user_id: "provider_owner" },
    })?.inbound).toBe(false);
  });
});
