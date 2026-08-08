import { describe, expect, test } from "bun:test";
import {
  collectUnipileChatEvents,
  collectUnipileLinkedInInbox,
} from "@outbound/infrastructure/campaigns/unipile-chat-synchronizer";

describe("collectUnipileChatEvents", () => {
  test("returns only campaign-contact messages after the first outreach", async () => {
    const events = await collectUnipileChatEvents({
      dsn: "https://api.example.test",
      apiKey: "secret",
      accountId: "account-1",
      contacts: new Map([
        ["provider-contact-1", { channel: "linkedin", since: new Date("2026-08-04T09:00:00.000Z") }],
      ]),
      fetchImpl: fakeFetch((url) => {
        if (url.pathname === "/api/v1/chats") {
          return Response.json({
            items: [
              { id: "chat-1", attendee_provider_id: "provider-contact-1", type: 0 },
              { id: "chat-private", attendee_provider_id: "unrelated-contact", type: 0 },
            ],
            cursor: null,
          });
        }
        if (url.pathname === "/api/v1/chats/chat-1/messages") {
          return Response.json({
            items: [
              { id: "old", text: "Avant campagne", timestamp: "2026-08-04T08:00:00.000Z", is_sender: 0 },
              { id: "inbound-1", text: "Oui, dites-m'en plus", timestamp: "2026-08-04T10:00:00.000Z", is_sender: 0 },
              { id: "outbound-human", text: "Avec plaisir", timestamp: "2026-08-04T10:05:00.000Z", is_sender: 1 },
              { id: "event", text: "CONNECTED", timestamp: "2026-08-04T10:06:00.000Z", is_sender: 0, is_event: true },
            ],
            cursor: null,
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      }),
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      event: "message_received",
      id: "inbound-1",
      direction: "inbound",
      sender: { attendee_provider_id: "provider-contact-1" },
    });
    expect(events[1]).toMatchObject({
      event: "message_sent",
      id: "outbound-human",
      direction: "outbound",
    });
  });

  test("imports recent LinkedIn threads even when they are outside a campaign", async () => {
    const threads = await collectUnipileLinkedInInbox({
      dsn: "https://api.example.test",
      apiKey: "secret",
      accountId: "account-1",
      fetchImpl: fakeFetch((url) => {
        if (url.pathname === "/api/v1/chats") {
          return Response.json({
            items: [
              {
                id: "chat-private",
                attendee_provider_id: "private-contact",
                timestamp: "2026-08-04T11:00:00.000Z",
                unread_count: 2,
              },
            ],
            cursor: null,
          });
        }
        if (url.pathname === "/api/v1/chats/chat-private/messages") {
          return Response.json({
            items: [
              { id: "private-in", text: "Bonjour", timestamp: "2026-08-04T10:59:00.000Z", is_sender: 0 },
              { id: "private-out", text: "Bonjour Alice", timestamp: "2026-08-04T11:00:00.000Z", is_sender: 1 },
              { id: "hidden", text: "masqué", timestamp: "2026-08-04T11:01:00.000Z", hidden: true },
            ],
            cursor: null,
          });
        }
        if (url.pathname === "/api/v1/chat_attendees/private-contact") {
          return Response.json({
            provider_id: "private-contact",
            name: "Alice Martin",
            profile_url: "https://www.linkedin.com/in/alice-martin",
            picture_url: "https://media.example.test/alice.jpg",
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      }),
    });

    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      chatId: "chat-private",
      attendeeProviderId: "private-contact",
      name: "Alice Martin",
      profileUrl: "https://www.linkedin.com/in/alice-martin",
      photoUrl: "https://media.example.test/alice.jpg",
      unreadCount: 2,
      messages: [
        { id: "private-in", direction: "inbound", body: "Bonjour" },
        { id: "private-out", direction: "outbound", body: "Bonjour Alice" },
      ],
    });
  });
});

function fakeFetch(handler: (url: URL) => Response): typeof fetch {
  return (async (value: string | URL | Request) => handler(new URL(String(value)))) as unknown as typeof fetch;
}
