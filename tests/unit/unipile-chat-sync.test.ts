import { describe, expect, test } from "bun:test";
import {
  collectUnipileEmailInboxPage,
  collectUnipileMessageInboxPage,
} from "@outbound/infrastructure/inbox/unipile-account-inbox-synchronizer";

describe("account inbox mirror collectors", () => {
  test("reads the global chat message page and preserves the provider cursor", async () => {
    const page = await collectUnipileMessageInboxPage({
      dsn: "https://api.example.test",
      apiKey: "secret",
      accountId: "linkedin-account",
      channel: "linkedin",
      cursor: "cursor-1",
      fetchImpl: fakeFetch((url) => {
        if (url.pathname === "/api/v1/messages") {
          expect(url.searchParams.get("account_id")).toBe("linkedin-account");
          expect(url.searchParams.get("cursor")).toBe("cursor-1");
          return Response.json({
            items: [
              { id: "m-in", chat_id: "chat-1", text: "Bonjour", timestamp: "2026-08-18T06:00:00.000Z", is_sender: 0, sender_id: "person-1" },
              { id: "m-out", chat_id: "chat-1", text: "Bonjour Alice", timestamp: "2026-08-18T06:01:00.000Z", is_sender: 1 },
            ],
            cursor: "cursor-2",
          });
        }
        if (url.pathname === "/api/v1/chats/chat-1") {
          return Response.json({ id: "chat-1", attendee_provider_id: "person-1", name: "Fallback", unread_count: 1 });
        }
        if (url.pathname === "/api/v1/chat_attendees/person-1") {
          return Response.json({ name: "Alice Martin", profile_url: "https://linkedin.example/alice", picture_url: "https://img.example/alice" });
        }
        throw new Error(`Unexpected URL ${url}`);
      }),
    });

    expect(page.nextCursor).toBe("cursor-2");
    expect(page.highWatermark?.toISOString()).toBe("2026-08-18T06:01:00.000Z");
    expect(page.threads).toEqual([
      expect.objectContaining({
        threadId: "chat-1",
        channel: "linkedin",
        externalIdentity: "person-1",
        contactName: "Alice Martin",
        unreadCount: 1,
        messages: [
          expect.objectContaining({ id: "m-in", direction: "inbound" }),
          expect.objectContaining({ id: "m-out", direction: "outbound" }),
        ],
      }),
    ]);
  });

  test("mirrors WhatsApp chats even when Unipile omits attendee_provider_id", async () => {
    const page = await collectUnipileMessageInboxPage({
      dsn: "https://api.example.test",
      apiKey: "secret",
      accountId: "whatsapp-account",
      channel: "whatsapp",
      after: new Date("2026-08-18T05:00:00.000Z"),
      fetchImpl: fakeFetch((url) => {
        if (url.pathname === "/api/v1/messages") {
          expect(url.searchParams.get("after")).toBe("2026-08-18T05:00:00.000Z");
          return Response.json({
            items: [{ id: "wa-1", chat_id: "wa-chat", text: "Disponible demain", timestamp: "2026-08-18T07:00:00.000Z", is_sender: false }],
            cursor: null,
          });
        }
        if (url.pathname === "/api/v1/chats/wa-chat") {
          return Response.json({ id: "wa-chat", provider_id: "phone-provider-id", name: "Client WhatsApp", unread_count: 3 });
        }
        throw new Error(`Unexpected URL ${url}`);
      }),
    });

    expect(page.threads[0]).toMatchObject({
      channel: "whatsapp",
      externalIdentity: "phone-provider-id",
      identityValue: "phone-provider-id",
      contactName: "Client WhatsApp",
      unreadCount: 3,
    });
  });

  test("groups emails by thread and distinguishes inbox from sent mail", async () => {
    const page = await collectUnipileEmailInboxPage({
      dsn: "https://api.example.test",
      apiKey: "secret",
      accountId: "email-account",
      fetchImpl: fakeFetch((url) => {
        expect(url.pathname).toBe("/api/v1/emails");
        expect(url.searchParams.get("meta_only")).toBe("false");
        return Response.json({
          items: [
            {
              id: "email-in",
              thread_id: "thread-1",
              body_plain: "Je suis intéressée",
              subject: "Re: Démo",
              date: "2026-08-18T08:00:00.000Z",
              origin: "external",
              role: "inbox",
              read_date: null,
              from_attendee: { display_name: "Claire Dupont", identifier: "CLAIRE@example.com" },
              to_attendees: [{ identifier: "sales@example.test" }],
            },
            {
              id: "email-out",
              thread_id: "thread-1",
              body: "<p>Voici mes créneaux.</p>",
              subject: "Re: Démo",
              date: "2026-08-18T08:05:00.000Z",
              origin: "internal",
              role: "sent",
              from_attendee: { identifier: "sales@example.test" },
              to_attendees: [{ display_name: "Claire Dupont", identifier: "claire@example.com" }],
            },
          ],
          cursor: null,
        });
      }),
    });

    expect(page.threads).toHaveLength(1);
    expect(page.threads[0]).toMatchObject({
      threadId: "thread-1",
      channel: "email",
      externalIdentity: "CLAIRE@example.com",
      contactName: "Claire Dupont",
      subject: "Re: Démo",
      unreadCount: 1,
      messages: [
        expect.objectContaining({ id: "email-in", direction: "inbound", body: "Je suis intéressée" }),
        expect.objectContaining({ id: "email-out", direction: "outbound", body: "Voici mes créneaux." }),
      ],
    });
  });
});

function fakeFetch(handler: (url: URL) => Response): typeof fetch {
  return (async (value: string | URL | Request) => handler(new URL(String(value)))) as unknown as typeof fetch;
}
