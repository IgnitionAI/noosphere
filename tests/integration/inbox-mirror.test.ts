import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { UnipileAccountInboxSynchronizer } from "@outbound/infrastructure/inbox/unipile-account-inbox-synchronizer";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("account inbox mirror", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const linkedinAccountId = crypto.randomUUID();
  const emailAccountId = crypto.randomUUID();
  const linkedinProviderId = `linkedin-${crypto.randomUUID()}`;
  const emailProviderId = `email-${crypto.randomUUID()}`;
  let phase = 1;
  const ingestedEvents: string[] = [];

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.client`insert into workspaces (id, slug, name) values (${workspaceId}, ${`inbox-${workspaceId}`}, 'Inbox mirror test')`;
    await database.client`
      insert into connected_accounts (id, workspace_id, provider, provider_account_id, display_name, status, capabilities, encrypted_secret)
      values
        (${linkedinAccountId}, ${workspaceId}, 'unipile', ${linkedinProviderId}, 'LinkedIn test', 'connected', '{"linkedin":{"sending":true}}'::jsonb, 'encrypted'),
        (${emailAccountId}, ${workspaceId}, 'unipile', ${emailProviderId}, 'Email test', 'connected', '{"email":{"sending":true,"receiving":true}}'::jsonb, 'encrypted')
    `;
  });

  afterAll(async () => {
    await database.client`delete from messages where workspace_id = ${workspaceId}`;
    await database.client`delete from conversations where workspace_id = ${workspaceId}`;
    await database.client`delete from contact_identities where workspace_id = ${workspaceId}`;
    await database.client`delete from contacts where workspace_id = ${workspaceId}`;
    await database.client`delete from inbox_sync_states where workspace_id = ${workspaceId}`;
    await database.client`delete from connected_accounts where workspace_id = ${workspaceId}`;
    await database.client`delete from workspaces where id = ${workspaceId}`;
    await database.close();
  });

  function synchronizer() {
    return new UnipileAccountInboxSynchronizer(
      database.db,
      { async ingest(rawBody) { ingestedEvents.push(rawBody); return { duplicate: false, eventId: crypto.randomUUID() }; } },
      {
        dsn: "https://api.example.test",
        apiKey: "secret",
        now: () => new Date(phase === 1 ? "2026-08-18T08:00:00.000Z" : "2026-08-18T09:00:00.000Z"),
        fetchImpl: fakeFetch((url) => providerResponse(url)),
      },
    );
  }

  test("backfills every associated account and resumes incrementally after restart", async () => {
    expect(await synchronizer().reconcile(workspaceId)).toBe(2);
    const firstStates = await database.client<{ channel: string; backfill_complete: boolean; cursor: string | null }[]>`
      select channel, backfill_complete, cursor from inbox_sync_states where workspace_id = ${workspaceId} order by channel::text
    `;
    expect([...firstStates]).toEqual([
      { channel: "email", backfill_complete: true, cursor: null },
      { channel: "linkedin", backfill_complete: true, cursor: null },
    ]);
    const firstConversations = await database.client<{ channel: string; origin: string; automation_mode: string; connected_account_id: string | null }[]>`
      select channel, origin, automation_mode, connected_account_id from conversations where workspace_id = ${workspaceId} order by channel::text
    `;
    expect([...firstConversations]).toEqual([
      { channel: "email", origin: "outside_campaign", automation_mode: "human", connected_account_id: emailAccountId },
      { channel: "linkedin", origin: "outside_campaign", automation_mode: "human", connected_account_id: linkedinAccountId },
    ]);
    expect(ingestedEvents).toHaveLength(0);

    phase = 2;
    expect(await synchronizer().reconcile(workspaceId)).toBe(2);
    const counts = await database.client<{ conversations: number; messages: number; workspaces: number }[]>`
      select
        (select count(*)::int from conversations where workspace_id = ${workspaceId}) as conversations,
        (select count(*)::int from messages where workspace_id = ${workspaceId}) as messages,
        (select count(distinct workspace_id)::int from conversations where workspace_id = ${workspaceId}) as workspaces
    `;
    expect(counts[0]).toEqual({ conversations: 2, messages: 4, workspaces: 1 });
    const syncErrors = await database.client<{ count: number }[]>`
      select count(*)::int as count from inbox_sync_states where workspace_id = ${workspaceId} and status <> 'idle'
    `;
    expect(syncErrors[0]?.count).toBe(0);
    expect(ingestedEvents).toHaveLength(0);
  });

  function providerResponse(url: URL): Response {
    const after = url.searchParams.get("after");
    if (phase === 2) expect(after).toBeTruthy();
    if (url.pathname === "/api/v1/messages") {
      expect(url.searchParams.get("account_id")).toBe(linkedinProviderId);
      return Response.json({
        items: phase === 1
          ? [{ id: "li-first", chat_id: "li-thread", text: "Premier message", timestamp: "2026-08-18T07:00:00.000Z", is_sender: false }]
          : [{ id: "li-second", chat_id: "li-thread", text: "Réponse manuelle", timestamp: "2026-08-18T08:30:00.000Z", is_sender: true }],
        cursor: null,
      });
    }
    if (url.pathname === "/api/v1/chats/li-thread") {
      return Response.json({ id: "li-thread", attendee_provider_id: "li-contact", name: "Contact LinkedIn", unread_count: phase === 1 ? 1 : 0 });
    }
    if (url.pathname === "/api/v1/chat_attendees/li-contact") {
      return Response.json({ name: "Contact LinkedIn", profile_url: "https://linkedin.example/contact" });
    }
    if (url.pathname === "/api/v1/emails") {
      expect(url.searchParams.get("account_id")).toBe(emailProviderId);
      return Response.json({
        items: phase === 1
          ? [{
              id: "email-first",
              thread_id: "email-thread",
              body_plain: "Premier email",
              subject: "Question",
              date: "2026-08-18T07:15:00.000Z",
              origin: "external",
              role: "inbox",
              from_attendee: { display_name: "Contact Email", identifier: "contact@example.test" },
              to_attendees: [{ identifier: "sales@example.test" }],
            }]
          : [{
              id: "email-second",
              thread_id: "email-thread",
              body_plain: "Réponse depuis la boîte",
              subject: "Re: Question",
              date: "2026-08-18T08:45:00.000Z",
              origin: "internal",
              role: "sent",
              from_attendee: { identifier: "sales@example.test" },
              to_attendees: [{ display_name: "Contact Email", identifier: "contact@example.test" }],
            }],
        cursor: null,
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  }
});

function fakeFetch(handler: (url: URL) => Response): typeof fetch {
  return (async (value: string | URL | Request) => handler(new URL(String(value)))) as unknown as typeof fetch;
}
