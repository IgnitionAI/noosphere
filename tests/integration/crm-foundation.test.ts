import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, workspaces } from "@outbound/infrastructure/database/schema";
import { createCrmHttpHandler } from "@outbound/interface/http/crm-handler";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("F-020/F-021 CRM foundation", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const context = {
    userId,
    workspaceId,
    role: "operator" as "operator" | "reviewer" | "viewer",
  };
  const handle = createCrmHttpHandler({
    contextResolver: { async resolve() { return context; } },
    database: database.db,
  });

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: resolve(import.meta.dir, "../../packages/infrastructure/migrations"),
    });
    await database.client`delete from companies where name like 'Page Corp %' or name like 'Example Corp%' or name like 'Foreign Example' or name like 'Cabinet _'`;
    await database.db.insert(workspaces).values([
      { id: workspaceId, slug: `crm-a-${workspaceId}`, name: "CRM A" },
      { id: otherWorkspaceId, slug: `crm-b-${otherWorkspaceId}`, name: "CRM B" },
    ]);
    await database.db.insert(authUsers).values({
      id: userId,
      name: "CRM Tester",
      email: `crm-${userId}@example.com`,
    });
  });

  afterAll(async () => {
    await database.client`delete from outbox_events where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from contact_suppressions where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from companies where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from contacts where workspace_id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.client`delete from auth_users where id = ${userId}`;
    await database.client`delete from workspaces where id in (${workspaceId}, ${otherWorkspaceId})`;
    await database.close();
  });

  function postJson(pathname: string, body: unknown) {
    return handle(
      new Request(`http://localhost${pathname}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  function patchJson(pathname: string, body: unknown) {
    return handle(new Request(`http://localhost${pathname}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  test("companies: normalized unique domain, workspace isolation, stable pagination", async () => {
    const created = await postJson("/api/v1/companies", {
      name: "Example Corp",
      domain: "HTTPS://WWW.Example.com/path?q=1",
      sector: "LegalTech",
      employeeCountMin: 50,
      employeeCountMax: 200,
      location: "Paris",
    });
    expect(created.status).toBe(201);
    const company = (await created.json()) as { id: string; normalizedDomain: string };
    expect(company.normalizedDomain).toBe("example.com");

    const duplicate = await postJson("/api/v1/companies", {
      name: "Example Corp Bis",
      domain: "example.com",
    });
    expect(duplicate.status).toBe(409);
    const conflict = (await duplicate.json()) as { code: string; existingCompanyId: string };
    expect(conflict.code).toBe("COMPANY_DOMAIN_CONFLICT");
    expect(conflict.existingCompanyId).toBe(company.id);

    // Same domain in another workspace is allowed.
    context.workspaceId = otherWorkspaceId;
    const foreign = await postJson("/api/v1/companies", {
      name: "Foreign Example",
      domain: "example.com",
    });
    expect(foreign.status).toBe(201);
    context.workspaceId = workspaceId;

    // Another workspace cannot see our company.
    context.workspaceId = otherWorkspaceId;
    const invisible = await handle(
      new Request(`http://localhost/api/v1/companies/${company.id}`),
    );
    expect(invisible.status).toBe(404);
    context.workspaceId = workspaceId;

    // Stable cursor pagination.
    for (let index = 0; index < 12; index += 1) {
      await postJson("/api/v1/companies", { name: `Page Corp ${String(index).padStart(2, "0")}` });
    }
    const page1 = await handle(
      new Request("http://localhost/api/v1/companies?search=Page%20Corp&limit=5"),
    );
    const body1 = (await page1.json()) as { data: unknown[]; nextCursor: string | null };
    expect(body1.data).toHaveLength(5);
    expect(body1.nextCursor).toBeTruthy();
    const page2 = await handle(
      new Request(
        `http://localhost/api/v1/companies?search=Page%20Corp&limit=5&cursor=${encodeURIComponent(body1.nextCursor!)}`,
      ),
    );
    const body2 = (await page2.json()) as { data: unknown[]; nextCursor: string | null };
    expect(body2.data).toHaveLength(5);
    const ids1 = new Set((body1.data as { id: string }[]).map((row) => row.id));
    expect((body2.data as { id: string }[]).every((row) => !ids1.has(row.id))).toBe(true);

    const filtered = await handle(new Request("http://localhost/api/v1/companies?sector=LegalTech&employeeCountMin=40&employeeCountMax=250&location=Paris"));
    expect(((await filtered.json()) as { data: { id: string }[] }).data.map((row) => row.id)).toContain(company.id);
    const patched = await patchJson(`/api/v1/companies/${company.id}`, { name: "Example Corp Updated" });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { name: string }).name).toBe("Example Corp Updated");
    context.role = "viewer";
    expect((await patchJson(`/api/v1/companies/${company.id}`, { name: "Forbidden" })).status).toBe(403);
    context.role = "operator";
  });

  test("contacts: employment history, identity uniqueness, persistent suppression", async () => {
    const companyA = (await (
      await postJson("/api/v1/companies", { name: "Cabinet A", domain: "cabinet-a.fr" })
    ).json()) as { id: string };
    const companyB = (await (
      await postJson("/api/v1/companies", { name: "Cabinet B", domain: "cabinet-b.fr" })
    ).json()) as { id: string };

    const created = await postJson("/api/v1/contacts", {
      firstName: "Jean",
      lastName: "Dupont",
      employment: { companyId: companyA.id, title: "Associé" },
      identities: [{ type: "email", value: "Jean.Dupont@Example.com" }],
    });
    expect(created.status).toBe(201);
    const contact = (await created.json()) as { id: string };

    // Duplicate email fingerprint is rejected with the existing contact.
    const duplicate = await postJson("/api/v1/contacts", {
      firstName: "Jeanne",
      lastName: "Dupont",
      identities: [{ type: "email", value: "jean.dupont@example.com" }],
    });
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { code: string }).code).toBe(
      "CONTACT_IDENTITY_CONFLICT",
    );

    // A new employer closes the current employment without a new person.
    const move = await postJson(`/api/v1/contacts/${contact.id}/employments`, {
      companyId: companyB.id,
      title: "Managing Partner",
      startedOn: "2026-07-01",
    });
    expect(move.status).toBe(201);
    const detail = await handle(
      new Request(`http://localhost/api/v1/contacts/${contact.id}`),
    );
    const body = (await detail.json()) as {
      employments: Array<{ isCurrent: boolean; companyId: string; endedOn: string | null }>;
    };
    const current = body.employments.filter((employment) => employment.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0]!.companyId).toBe(companyB.id);
    const previous = body.employments.find((employment) => employment.companyId === companyA.id);
    expect(previous?.isCurrent).toBe(false);
    expect(previous?.endedOn).toBe("2026-07-01");

    const patchedContact = await patchJson(`/api/v1/contacts/${contact.id}`, { firstName: "Jean-Pierre" });
    expect(patchedContact.status).toBe(200);
    expect(((await patchedContact.json()) as { firstName: string }).firstName).toBe("Jean-Pierre");
    context.role = "reviewer";
    expect((await patchJson(`/api/v1/contacts/${contact.id}`, { lastName: "Forbidden" })).status).toBe(403);
    context.role = "operator";

    // Suppression persists across re-import.
    const suppress = await postJson(`/api/v1/contacts/${contact.id}/actions/suppress`, {
      channel: "global",
      reason: "Opposition au démarchage",
    });
    expect(suppress.status).toBe(204);
    const reimport = await postJson("/api/v1/contacts", {
      firstName: "Jean",
      lastName: "Dupont",
      identities: [{ type: "email", value: "JEAN.DUPONT@example.com" }],
    });
    expect(reimport.status).toBe(409);
    expect(((await reimport.json()) as { code: string }).code).toBe("CONTACT_SUPPRESSED");
  });

  test("a viewer can read but cannot mutate", async () => {
    context.role = "viewer";
    const list = await handle(new Request("http://localhost/api/v1/companies"));
    expect(list.status).toBe(200);
    const create = await postJson("/api/v1/companies", { name: "Viewer Corp" });
    expect(create.status).toBe(403);
    context.role = "operator";
  });
});
