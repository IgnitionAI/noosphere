import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { connectedAccounts, jobs, socialContentItems, socialInteractions, workspaces } from "@outbound/infrastructure/database/schema";
import { PostgresOperationalViews } from "@outbound/infrastructure/workspaces/postgres-operational-views";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("Noosphere operational projections", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const views = new PostgresOperationalViews(database.db);
  const workspaceA = crypto.randomUUID();
  const workspaceB = crypto.randomUUID();
  const jobA = crypto.randomUUID();
  const jobB = crypto.randomUUID();
  const futureJobA = crypto.randomUUID();
  const deadJobA = crypto.randomUUID();
  const linkedinAccountA = crypto.randomUUID();
  const linkedinPostA = crypto.randomUUID();
  const replyA = crypto.randomUUID();
  const replyA2 = crypto.randomUUID();
  const commentA = crypto.randomUUID();
  const reactionA = crypto.randomUUID();
  const mentionA = crypto.randomUUID();
  const lockedAt = new Date(Date.now() - 60_000);
  const unicodePostText = `${"x".repeat(71)}𝕌${"y".repeat(6)}𝕏 publication observée`;

  beforeAll(async () => {
    await migrate(database.db, { migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations") });
    await database.db.insert(workspaces).values([
      { id: workspaceA, slug: `noosphere-a-${workspaceA}`, name: "Noosphere A" },
      { id: workspaceB, slug: `noosphere-b-${workspaceB}`, name: "Noosphere B" },
    ]);
    await database.db.insert(jobs).values([
      { id: jobA, workspaceId: workspaceA, type: "campaign.autopilot", payload: {}, idempotencyKey: "axis-a", correlationId: "axis-proof-a", status: "running", attempts: 1, maxAttempts: 3, availableAt: lockedAt, lockedAt, lockedUntil: new Date(Date.now() + 5 * 60_000), lockedBy: "worker-a" },
      { id: jobB, workspaceId: workspaceB, type: "campaign.autopilot", payload: {}, idempotencyKey: "axis-b", correlationId: "axis-proof-b", status: "running", attempts: 1, maxAttempts: 3, availableAt: lockedAt, lockedAt, lockedUntil: new Date(Date.now() + 5 * 60_000), lockedBy: "worker-b" },
      { id: futureJobA, workspaceId: workspaceA, type: "prospect.decision.execute", payload: {}, idempotencyKey: "future-a", correlationId: "future-proof-a", status: "pending", attempts: 0, maxAttempts: 3, availableAt: new Date(Date.now() + 24 * 60 * 60_000) },
      { id: deadJobA, workspaceId: workspaceA, type: "campaign.autopilot", payload: {}, idempotencyKey: "internal-failure-a", correlationId: "internal-proof-a", status: "dead_lettered", attempts: 3, maxAttempts: 3, availableAt: lockedAt },
    ]);
    await database.db.insert(connectedAccounts).values({
      id: linkedinAccountA,
      workspaceId: workspaceA,
      provider: "unipile",
      providerAccountId: `operational-filter-${linkedinAccountA}`,
      displayName: "LinkedIn operational filter",
      status: "connected",
      capabilities: { linkedin: true },
      encryptedSecret: "integration-fixture",
    });
    await database.db.insert(socialContentItems).values({
      id: linkedinPostA,
      workspaceId: workspaceA,
      connectedAccountId: linkedinAccountA,
      providerAccountId: `operational-filter-${linkedinAccountA}`,
      origin: "external",
      providerPostId: `operational-post-${linkedinPostA}`,
      text: unicodePostText,
      firstSeenAt: lockedAt,
      lastSeenAt: lockedAt,
    });
    await database.db.insert(socialInteractions).values([
      interaction(replyA, "reply", "Réponse la plus récente", new Date(lockedAt.getTime() + 5_000)),
      interaction(replyA2, "reply", "Réponse précédente", new Date(lockedAt.getTime() + 4_000)),
      interaction(commentA, "comment", "Commentaire", new Date(lockedAt.getTime() + 3_000)),
      interaction(reactionA, "reaction", null, new Date(lockedAt.getTime() + 2_000), "like"),
      interaction(mentionA, "mention", "Mention", new Date(lockedAt.getTime() + 1_000)),
    ]);
  });

  afterAll(async () => {
    await database.client`delete from jobs where workspace_id in (${workspaceA}, ${workspaceB})`;
    await database.client`delete from workspaces where id in (${workspaceA}, ${workspaceB})`;
    await database.close();
  });

  test("switching the three lenses never changes a running job or its lease", async () => {
    const [before] = await database.db.select().from(jobs).where(eq(jobs.id, jobA));
    const pages = await Promise.all([
      views.getActivity({ workspaceId: workspaceA, lens: "inbound" }),
      views.getActivity({ workspaceId: workspaceA, lens: "symbiosis" }),
      views.getActivity({ workspaceId: workspaceA, lens: "outbound" }),
    ]);
    expect(pages.map((page) => page.lens)).toEqual(["inbound", "symbiosis", "outbound"]);
    const [after] = await database.db.select().from(jobs).where(eq(jobs.id, jobA));
    expect(after).toMatchObject({
      id: before!.id,
      status: before!.status,
      lockedAt: before!.lockedAt,
      lockedUntil: before!.lockedUntil,
      lockedBy: before!.lockedBy,
      attempts: before!.attempts,
    });
  });

  test("summary and activity stay isolated to the session workspace", async () => {
    const summaryA = await views.getSummary(workspaceA);
    const summaryB = await views.getSummary(workspaceB);
    expect(summaryA.jobs.running.map((job) => job.id)).toEqual([jobA]);
    expect(summaryB.jobs.running.map((job) => job.id)).toEqual([jobB]);
    expect(summaryA.engines.inbound.status).toBe("not_configured");
    expect(summaryA.engines.outbound.status).toBe("degraded");
    expect(summaryA.jobs.failed).toBe(1);
    expect(summaryA.jobs.active).toBe(1);
    expect(summaryA.counts.attention).toBe(1);
    expect(summaryA.attention).toEqual([
      expect.objectContaining({
        id: "job:dead-lettered",
        type: "job",
        severity: "warning",
        resourceHref: "/settings/console?status=dead_lettered",
      }),
    ]);
  });

  test("filters inbound interactions by their durable type with stable pagination", async () => {
    const firstReplies = await views.getActivity({ workspaceId: workspaceA, lens: "inbound", interactionType: "reply", limit: 1 });
    expect(firstReplies.items).toHaveLength(1);
    expect(firstReplies.items[0]?.id).toBe(`social-interaction:${replyA}`);
    expect(firstReplies.items[0]?.title).toBe("Ada Lovelace a répondu");
    expect(firstReplies.items[0]?.detail).toContain("𝕏 …");
    expect(firstReplies.items[0]?.detail).not.toContain("�");
    expect(firstReplies.pagination.nextCursor).toBe("1");

    const secondReplies = await views.getActivity({ workspaceId: workspaceA, lens: "inbound", interactionType: "reply", offset: 1, limit: 1 });
    expect(secondReplies.items.map((item) => item.id)).toEqual([`social-interaction:${replyA2}`]);
    expect(secondReplies.pagination.nextCursor).toBeNull();

    const reactions = await views.getActivity({ workspaceId: workspaceA, lens: "inbound", interactionType: "reaction" });
    expect(reactions.items.map((item) => item.id)).toEqual([`social-interaction:${reactionA}`]);
    expect(reactions.items[0]?.title).toBe("Ada Lovelace a réagi");

    const otherWorkspace = await views.getActivity({ workspaceId: workspaceB, lens: "inbound", interactionType: "reply" });
    expect(otherWorkspace.items).toEqual([]);
  });

  function interaction(id: string, type: "reply" | "comment" | "reaction" | "mention", body: string | null, observedAt: Date, reaction: string | null = null) {
    return {
      id,
      workspaceId: workspaceA,
      socialContentId: linkedinPostA,
      connectedAccountId: linkedinAccountA,
      providerAccountId: `operational-filter-${linkedinAccountA}`,
      syncKind: type === "reaction" ? "reactions" : "comments",
      scopeKey: "post",
      type,
      providerInteractionId: `${type}-${id}`,
      direction: "incoming",
      actorProviderId: "ada-lovelace",
      actorName: "Ada Lovelace",
      body,
      reaction,
      status: "observed",
      occurredAt: observedAt,
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
      lastScanToken: crypto.randomUUID(),
    };
  }
});
