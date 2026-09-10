import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { canonicalMcpWriteHash } from "@outbound/interface/mcp/mcp-write-contracts";
import { PostgresOfferRepository } from "@outbound/infrastructure/offers/postgres-offer-repository";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { createNoosphereApiRuntime, createMcpWriteCapabilities } from "@outbound/bootstrap/create-noosphere-api-runtime";
import { authUsers, mcpOauthClients, offers, workspaceMembers, workspaces, campaigns, sequences, icps, icpVersions, calendarConnections, calendarBookings, knowledgeSources, knowledgeClaims, productResearchRuns } from "@outbound/infrastructure/database/schema";
import type { McpExecutionContext } from "@outbound/application/mcp/mcp-read-capabilities";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("MCP list pagination and offer draft concurrency", () => {
  if (!url) return;
  const db = createDatabase(url);
  const workspaceId = crypto.randomUUID(), otherWorkspace = crypto.randomUUID(), userId = crypto.randomUUID(), clientId = crypto.randomUUID();
  const context: McpExecutionContext = { workspaceId, userId, clientId, role: "owner", scopes: ["mcp:read", "mcp:write"], audience: "https://mcp.example.test/mcp" };
  const offerIds = Array.from({ length: 5 }, () => crypto.randomUUID());
  const runtime = createNoosphereApiRuntime({ DATABASE_URL: url, KIMI_CODE_API_KEY: "fixture-no-network", BETTER_AUTH_URL: "https://mcp.example.test", BETTER_AUTH_SECRET: "synthetic-test-secret-with-thirty-two-characters", S3_ENDPOINT: "http://127.0.0.1:1", S3_BUCKET: "test", S3_ACCESS_KEY_ID: "fixture", S3_SECRET_ACCESS_KEY: "fixture" });
  beforeAll(async () => {
    await migrate(db.db, { migrationsFolder: `${import.meta.dir}/../../packages/infrastructure/migrations` });
    await db.db.insert(workspaces).values([{ id: workspaceId, slug: workspaceId, name: "Offers" }, { id: otherWorkspace, slug: otherWorkspace, name: "Other" }]);
    await db.db.insert(authUsers).values({ id: userId, name: "Synthetic owner", email: `${userId}@example.test` });
    await db.db.insert(workspaceMembers).values({ workspaceId, userId, role: "owner", status: "active" });
    await db.db.insert(mcpOauthClients).values({ clientId, clientName: "Test", redirectUris: [], userId, workspaceId, workspaceSlug: workspaceId, allowedScopes: ["mcp:read", "mcp:write"] });
    await db.db.insert(offers).values(offerIds.map((id, i) => ({ id, workspaceId, name: `Offer ${i}`, createdBy: userId, updatedAt: new Date("2026-09-01T00:00:00Z") })));
    await db.db.insert(offers).values({ id: crypto.randomUUID(), workspaceId: otherWorkspace, name: "Foreign" });
    const stamp = new Date("2026-09-01T00:00:00Z"), icpId = crypto.randomUUID(), icpVersionId = crypto.randomUUID(), sequenceId = crypto.randomUUID(), connectionId = crypto.randomUUID();
    await db.db.insert(icps).values({ id: icpId, workspaceId, name: "Test ICP" });
    await db.db.insert(icpVersions).values({ id: icpVersionId, workspaceId, icpId, version: 1, name: "Test", confidence: "0.9000", criteria: {}, buyingCommittee: [], problems: [], signals: [], exclusions: [], unknowns: [], unresolvedContradictions: [], blockedFindings: [], publishedAt: stamp });
    await db.db.insert(sequences).values({ id: sequenceId, workspaceId, name: "Test" });
    await db.db.insert(campaigns).values(Array.from({ length: 101 }, (_, i) => ({ id: crypto.randomUUID(), workspaceId, name: `Campaign ${i}`, icpVersionId, sequenceId, channel: "email" as const, updatedAt: stamp })));
    await db.db.insert(calendarConnections).values({ id: connectionId, workspaceId, provider: "calcom", bookingUrl: "https://example.test/booking" });
    await db.db.insert(calendarBookings).values(Array.from({ length: 5 }, () => ({ id: crypto.randomUUID(), workspaceId, connectionId, providerBookingId: crypto.randomUUID(), status: "booked", startAt: stamp })));
    await db.db.insert(knowledgeSources).values(Array.from({ length: 5 }, (_, i) => ({ id: crypto.randomUUID(), workspaceId, type: "proof" as const, title: `Source ${i}`, content: "Synthetic proof", authorName: "Fixture", publishedAt: stamp, updatedAt: stamp })));
    await db.db.insert(knowledgeClaims).values(Array.from({ length: 5 }, (_, i) => ({ id: crypto.randomUUID(), workspaceId, claim: `Claim ${i}`, updatedAt: stamp })));
    await db.db.insert(productResearchRuns).values(Array.from({ length: 5 }, () => ({ id: crypto.randomUUID(), workspaceId, brief: {}, status: "draft" as const, createdAt: stamp, updatedAt: stamp })));

  });
  afterAll(async () => { await runtime.close(); await db.close(); });
  test("enforces positive draft revisions independently from publication versions", async () => {
    const row = await new PostgresOfferRepository(db.db).getOffer({ workspaceId, offerId: offerIds[4]! });
    expect(row?.revision).toBe(1);
    expect(row?.currentVersion).toBe(0);
    await expect(Promise.resolve(db.client`update offers set revision = 0 where id = ${offerIds[4]!}`)).rejects.toThrow();
  });
  test("enumerates all offers with a stable cursor without exposing another workspace", async () => {
    const read = runtime.capabilities.mcpRead!;
    const first = await read.offer.list(context, { limit: 2 });
    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await read.offer.list(context, { limit: 2, cursor: first.nextCursor! });
    const third = await read.offer.list(context, { limit: 2, cursor: second.nextCursor! });
    const ids = [...first.data, ...second.data, ...third.data].map(row => (row as { id: string }).id);
    expect(new Set(ids).size).toBe(5);
    expect(ids.toSorted()).toEqual(offerIds.toSorted());
    expect(third.nextCursor).toBeNull();
    await expect(read.offer.list({ ...context, workspaceId: otherWorkspace }, { limit: 2, cursor: first.nextCursor! })).rejects.toThrow();
  });
  test("competing draft edits accept one revision and HTTP edits invalidate stale MCP versions", async () => {
    const writes = createMcpWriteCapabilities(db.db, { now: () => new Date() });
    const command = (name: string, expectedVersion: number) => {
      const args = { requestKey: crypto.randomUUID(), offerId: offerIds[0]!, name, expectedVersion };
      return { operation: "offer_update" as const, requestKey: args.requestKey, inputHash: canonicalMcpWriteHash(args), arguments: args };
    };
    const edits = [command("First competing edit", 1), command("Second competing edit", 1)];
    const results = await Promise.allSettled(edits.map(edit => writes.execute(context, edit)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const winner = results.findIndex(result => result.status === "fulfilled");
    const accepted = await writes.execute(context, edits[winner]!);
    expect(accepted.version).toBe(2);
    expect(String((results[1 - winner] as PromiseRejectedResult).reason)).toContain("MCP_WRITE_VERSION_CONFLICT");
    const repository = new PostgresOfferRepository(db.db);
    const draft = await repository.getOffer({ workspaceId, offerId: offerIds[0]! });
    expect(draft?.currentVersion).toBe(0);
    await repository.updateOffer({ workspaceId, offerId: offerIds[0]!, fields: { name: "HTTP draft edit" } });
    await expect(writes.execute(context, command("Stale MCP edit", accepted.version))).rejects.toThrow("MCP_WRITE_VERSION_CONFLICT");
    expect((await repository.getOffer({ workspaceId, offerId: offerIds[0]! }))?.name).toBe("HTTP draft edit");
  });

  test("publishes only the reviewed draft revision and preserves publication counters on retry", async () => {
    const repository = new PostgresOfferRepository(db.db);
    const offerId = crypto.randomUUID();
    await repository.createOffer({ id: offerId, workspaceId, createdBy: userId, name: "Reviewed", category: "saas", targetAudience: "Synthetic" });
    const reviewed = await repository.updateOffer({ workspaceId, offerId, fields: { valueProposition: "Reviewed promise", claims: [{ claim: "Synthetic evidence", validationStatus: "validated", evidenceUri: "https://example.test/proof" }] } });
    const writes = createMcpWriteCapabilities(db.db, { now: () => new Date() });
    const publish = (expectedVersion: number) => {
      const args = { requestKey: crypto.randomUUID(), offerId, expectedVersion };
      return { operation: "offer_publish" as const, requestKey: args.requestKey, inputHash: canonicalMcpWriteHash(args), arguments: args };
    };
    const changed = await repository.updateOffer({ workspaceId, offerId, fields: { name: "Changed since review" } });
    await expect(writes.execute(context, publish(reviewed.revision))).rejects.toThrow("MCP_WRITE_VERSION_CONFLICT");
    expect(await repository.listVersions({ workspaceId, offerId })).toHaveLength(0);
    const command = publish(changed.revision);
    const accepted = await writes.execute(context, command);
    expect(accepted.version).toBe(1);
    expect(await writes.execute(context, command)).toEqual(accepted);
    const current = await repository.getOffer({ workspaceId, offerId });
    expect(current?.revision).toBe(changed.revision);
    expect(current?.currentVersion).toBe(1);
    expect(current?.versions).toHaveLength(1);
    expect(current?.versions[0]?.name).toBe("Changed since review");

    let publicationReady!: () => void;
    let releasePublication!: () => void;
    let reportUpdater!: (pid: number) => void;
    const ready = new Promise<void>(resolve => { publicationReady = resolve; });
    const hold = new Promise<void>(resolve => { releasePublication = resolve; });
    const updaterPid = new Promise<number>(resolve => { reportUpdater = resolve; });
    const publishing = db.db.transaction(async tx => {
      const result = await new PostgresOfferRepository(tx as unknown as typeof db.db).publishOffer({ id: crypto.randomUUID(), workspaceId, offerId, userId, publishedAt: new Date(), expectedRevision: changed.revision });
      publicationReady();
      await hold;
      return result;
    });
    await Promise.race([ready, publishing]);
    const updating = db.db.transaction(async tx => {
      const [backend] = await tx.execute(sql`select pg_backend_pid() as pid`);
      reportUpdater(Number(backend!.pid));
      return new PostgresOfferRepository(tx as unknown as typeof db.db).updateOffer({ workspaceId, offerId, fields: { name: "Concurrent edit" } });
    });
    try {
      const pid = await updaterPid;
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        const [row] = await db.client`select cardinality(pg_blocking_pids(${pid})) > 0 as blocked`;
        blocked = row!.blocked === true;
        if (!blocked) await Bun.sleep(10);
      }
      // Even no-change publication holds the reviewed row until its transaction commits.
      expect(blocked).toBe(true);
    } finally {
      releasePublication();
      await Promise.all([publishing, updating]);
    }
    expect((await repository.getOffer({ workspaceId, offerId }))?.name).toBe("Concurrent edit");
    expect((await repository.listVersions({ workspaceId, offerId }))[0]?.name).toBe("Changed since review");
  });

  test.each(["campaign", "research", "calls", "sources", "claims"] as const)("enumerates all %s pages, rejecting cursors for another tool", async (kind) => {
    const read = runtime.capabilities.mcpRead!;
    const list = kind === "sources" ? read.knowledge.listSources : kind === "claims" ? read.knowledge.listClaims : read[kind].list;
    const limit = kind === "campaign" ? 50 : 2;
    const first = await list(context, { limit });
    expect(first.nextCursor).not.toBeNull();
    const second = await list(context, { limit, cursor: first.nextCursor! });
    const third = await list(context, { limit, cursor: second.nextCursor! });
    const ids = [...first.data, ...second.data, ...third.data].map(row => (row as { id: string }).id);
    expect(ids.length).toBe(kind === "campaign" ? 101 : 5);
    expect(new Set(ids).size).toBe(ids.length);
    expect(third.nextCursor).toBeNull();
    await expect(read.offer.list(context, { limit: 2, cursor: first.nextCursor! })).rejects.toThrow();
    if (kind === "sources") await expect(read.knowledge.listSources(context, { limit: 2, cursor: first.nextCursor!, status: "validated" })).rejects.toThrow();
  });

});
