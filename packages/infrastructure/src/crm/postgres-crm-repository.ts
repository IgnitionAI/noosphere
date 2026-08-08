import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, or, sql, lte, gte, type SQL } from "drizzle-orm";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  companies,
  auditLogs,
  contactEmployments,
  contactIdentities,
  contacts,
  contactSuppressions,
  outboxEvents,
} from "@outbound/infrastructure/database/schema";

export interface CompanyListCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export class PostgresCrmRepository {
  constructor(private readonly db: Database) {}

  async createCompany(input: {
    id: string;
    workspaceId: string;
    name: string;
    normalizedDomain: string | null;
    sector: string | null;
    employeeCountMin: number | null;
    employeeCountMax: number | null;
    location: string | null;
    linkedinUrl: string | null;
    source: "manual" | "csv" | "icp_research" | "discovery" | "provider";
  }) {
    try {
      const rows = await this.db
        .insert(companies)
        .values({
          id: input.id,
          workspaceId: input.workspaceId,
          name: input.name,
          normalizedDomain: input.normalizedDomain,
          sector: input.sector,
          employeeCountMin: input.employeeCountMin,
          employeeCountMax: input.employeeCountMax,
          location: input.location,
          linkedinUrl: input.linkedinUrl,
          source: input.source,
        })
        .returning();
      await this.recordEvent(this.db, input.workspaceId, "Company", input.id, "CompanyCreated", {
        companyId: input.id,
      });
      return rows[0]!;
    } catch (error) {
      if (isUniqueViolation(error) && input.normalizedDomain) {
        const existing = await this.db
          .select({ id: companies.id })
          .from(companies)
          .where(
            and(
              eq(companies.workspaceId, input.workspaceId),
              eq(companies.normalizedDomain, input.normalizedDomain),
            ),
          )
          .limit(1);
        throw new Error(`COMPANY_DOMAIN_CONFLICT:${existing[0]?.id ?? ""}`);
      }
      throw error;
    }
  }

  async listCompanies(input: {
    workspaceId: string;
    search?: string;
    sector?: string;
    location?: string;
    employeeCountMin?: number;
    employeeCountMax?: number;
    cursor?: CompanyListCursor;
    limit: number;
  }) {
    const conditions: SQL[] = [eq(companies.workspaceId, input.workspaceId)];
    if (input.search) {
      conditions.push(ilike(companies.name, `%${input.search}%`));
    }
    if (input.sector) conditions.push(ilike(companies.sector, `%${input.sector}%`));
    if (input.location) conditions.push(ilike(companies.location, `%${input.location}%`));
    if (input.employeeCountMin !== undefined) {
      conditions.push(gte(companies.employeeCountMax, input.employeeCountMin));
    }
    if (input.employeeCountMax !== undefined) {
      conditions.push(lte(companies.employeeCountMin, input.employeeCountMax));
    }
    if (input.cursor) {
      conditions.push(
        or(
          sql`date_trunc('milliseconds', ${companies.createdAt}) > ${input.cursor.createdAt.toISOString()}::timestamptz`,
          and(
            sql`date_trunc('milliseconds', ${companies.createdAt}) = ${input.cursor.createdAt.toISOString()}::timestamptz`,
            gt(companies.id, input.cursor.id),
          ),
        )!,
      );
    }
    const rows = await this.db
      .select()
      .from(companies)
      .where(and(...conditions))
      .orderBy(asc(companies.createdAt), asc(companies.id))
      .limit(input.limit + 1);
    const data = rows.slice(0, input.limit);
    const last = data.at(-1);
    return {
      data,
      nextCursor: rows.length > input.limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }

  async updateCompany(input: {
    workspaceId: string;
    companyId: string;
    fields: Partial<Pick<typeof companies.$inferInsert,
      "name" | "normalizedDomain" | "sector" | "employeeCountMin" | "employeeCountMax" | "location" | "linkedinUrl">>;
  }) {
    try {
      const rows = await this.db.update(companies).set({ ...input.fields, updatedAt: new Date() }).where(and(
        eq(companies.workspaceId, input.workspaceId), eq(companies.id, input.companyId),
      )).returning();
      if (!rows[0]) throw new Error("COMPANY_NOT_FOUND");
      return rows[0];
    } catch (error) {
      if (isUniqueViolation(error) && input.fields.normalizedDomain) {
        const existing = await this.db.select({ id: companies.id }).from(companies).where(and(
          eq(companies.workspaceId, input.workspaceId), eq(companies.normalizedDomain, input.fields.normalizedDomain),
        )).limit(1);
        throw new Error(`COMPANY_DOMAIN_CONFLICT:${existing[0]?.id ?? ""}`);
      }
      throw error;
    }
  }

  async getCompany(input: { workspaceId: string; companyId: string }) {
    const rows = await this.db
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.workspaceId, input.workspaceId),
          eq(companies.id, input.companyId),
        ),
      )
      .limit(1);
    const company = rows[0];
    if (!company) return null;
    const linkedContacts = await this.db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        status: contacts.status,
        title: contactEmployments.title,
        isCurrent: contactEmployments.isCurrent,
      })
      .from(contactEmployments)
      .innerJoin(
        contacts,
        and(
          eq(contactEmployments.workspaceId, contacts.workspaceId),
          eq(contactEmployments.contactId, contacts.id),
        ),
      )
      .where(
        and(
          eq(contactEmployments.workspaceId, input.workspaceId),
          eq(contactEmployments.companyId, input.companyId),
        ),
      );
    return { ...company, contacts: linkedContacts };
  }

  async createContact(input: {
    id: string;
    workspaceId: string;
    firstName: string;
    lastName: string;
    source: "manual" | "csv" | "icp_research" | "discovery" | "provider";
    identities: readonly {
      id: string;
      type: "email" | "linkedin" | "phone" | "whatsapp";
      value: string;
      normalizedValue: string;
    }[];
    employment: {
      id: string;
      companyId: string;
      title: string;
      startedOn: string | null;
    } | null;
  }) {
    return this.db.transaction(async (tx) => {
      await this.assertNotSuppressed(tx, input.workspaceId, input.identities);
      if (input.employment) {
        await this.assertCompanyExists(tx, input.workspaceId, input.employment.companyId);
      }
      const inserted = await tx
        .insert(contacts)
        .values({
          id: input.id,
          workspaceId: input.workspaceId,
          firstName: input.firstName,
          lastName: input.lastName,
          source: input.source,
        })
        .returning();
      if (input.identities.length) {
        try {
          await tx.insert(contactIdentities).values(
            input.identities.map((identity) => ({
              id: identity.id,
              workspaceId: input.workspaceId,
              contactId: input.id,
              type: identity.type,
              value: identity.value,
              normalizedValue: identity.normalizedValue,
              source: input.source,
            })),
          );
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new Error("CONTACT_IDENTITY_CONFLICT");
          }
          throw error;
        }
      }
      if (input.employment) {
        await tx.insert(contactEmployments).values({
          id: input.employment.id,
          workspaceId: input.workspaceId,
          contactId: input.id,
          companyId: input.employment.companyId,
          title: input.employment.title,
          startedOn: input.employment.startedOn,
          isCurrent: true,
        });
      }
      await this.recordEvent(tx, input.workspaceId, "Contact", input.id, "ContactCreated", {
        contactId: input.id,
      });
      return inserted[0]!;
    });
  }

  async listContacts(input: {
    workspaceId: string;
    search?: string;
    companyId?: string;
    cursor?: CompanyListCursor;
    limit: number;
  }) {
    const conditions: SQL[] = [eq(contacts.workspaceId, input.workspaceId)];
    if (input.search) {
      const pattern = `%${input.search}%`;
      conditions.push(
        or(
          ilike(contacts.firstName, pattern),
          ilike(contacts.lastName, pattern),
        )!,
      );
    }
    if (input.companyId) {
      const employedAt = this.db
        .select({ contactId: contactEmployments.contactId })
        .from(contactEmployments)
        .where(
          and(
            eq(contactEmployments.workspaceId, input.workspaceId),
            eq(contactEmployments.companyId, input.companyId),
          ),
        );
      conditions.push(inArray(contacts.id, employedAt));
    }
    if (input.cursor) {
      conditions.push(
        or(
          sql`date_trunc('milliseconds', ${contacts.createdAt}) > ${input.cursor.createdAt.toISOString()}::timestamptz`,
          and(
            sql`date_trunc('milliseconds', ${contacts.createdAt}) = ${input.cursor.createdAt.toISOString()}::timestamptz`,
            gt(contacts.id, input.cursor.id),
          ),
        )!,
      );
    }
    const rows = await this.db
      .select()
      .from(contacts)
      .where(and(...conditions))
      .orderBy(asc(contacts.createdAt), asc(contacts.id))
      .limit(input.limit + 1);
    const data = rows.slice(0, input.limit);
    const last = data.at(-1);
    const currentEmployments = await this.currentEmploymentsByContact(
      input.workspaceId,
      data.map((row) => row.id),
    );
    return {
      data: data.map((row) => ({
        ...row,
        currentEmployment: currentEmployments.get(row.id) ?? null,
      })),
      nextCursor: rows.length > input.limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }

  async getContact(input: { workspaceId: string; contactId: string }) {
    const rows = await this.db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, input.workspaceId),
          eq(contacts.id, input.contactId),
        ),
      )
      .limit(1);
    const contact = rows[0];
    if (!contact) return null;
    const [identities, employments] = await Promise.all([
      this.db
        .select()
        .from(contactIdentities)
        .where(
          and(
            eq(contactIdentities.workspaceId, input.workspaceId),
            eq(contactIdentities.contactId, input.contactId),
          ),
        )
        .orderBy(asc(contactIdentities.createdAt)),
      this.db
        .select({
          id: contactEmployments.id,
          companyId: contactEmployments.companyId,
          companyName: companies.name,
          title: contactEmployments.title,
          startedOn: contactEmployments.startedOn,
          endedOn: contactEmployments.endedOn,
          isCurrent: contactEmployments.isCurrent,
        })
        .from(contactEmployments)
        .innerJoin(
          companies,
          and(
            eq(contactEmployments.workspaceId, companies.workspaceId),
            eq(contactEmployments.companyId, companies.id),
          ),
        )
        .where(
          and(
            eq(contactEmployments.workspaceId, input.workspaceId),
            eq(contactEmployments.contactId, input.contactId),
          ),
        )
        .orderBy(asc(contactEmployments.createdAt)),
    ]);
    return { ...contact, identities, employments };
  }

  async updateContact(input: {
    workspaceId: string;
    contactId: string;
    fields: Partial<Pick<typeof contacts.$inferInsert, "firstName" | "lastName" | "photoUrl" | "preferredChannel">>;
  }) {
    const rows = await this.db.update(contacts).set({ ...input.fields, updatedAt: new Date() }).where(and(
      eq(contacts.workspaceId, input.workspaceId), eq(contacts.id, input.contactId),
    )).returning();
    if (!rows[0]) throw new Error("CONTACT_NOT_FOUND");
    return rows[0];
  }

  async addIdentity(input: {
    id: string;
    workspaceId: string;
    contactId: string;
    type: "email" | "linkedin" | "phone" | "whatsapp";
    value: string;
    normalizedValue: string;
  }) {
    return this.db.transaction(async (tx) => {
      await this.assertNotSuppressed(tx, input.workspaceId, [
        { type: input.type, normalizedValue: input.normalizedValue },
      ]);
      try {
        const rows = await tx
          .insert(contactIdentities)
          .values({
            id: input.id,
            workspaceId: input.workspaceId,
            contactId: input.contactId,
            type: input.type,
            value: input.value,
            normalizedValue: input.normalizedValue,
          })
          .returning();
        return rows[0]!;
      } catch (error) {
        if (isUniqueViolation(error)) throw new Error("CONTACT_IDENTITY_CONFLICT");
        throw error;
      }
    });
  }

  async addEmployment(input: {
    id: string;
    workspaceId: string;
    contactId: string;
    companyId: string;
    title: string;
    startedOn: string | null;
  }) {
    return this.db.transaction(async (tx) => {
      const contact = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.workspaceId, input.workspaceId),
            eq(contacts.id, input.contactId),
          ),
        )
        .limit(1);
      if (!contact[0]) throw new Error("CONTACT_NOT_FOUND");
      await this.assertCompanyExists(tx, input.workspaceId, input.companyId);
      const endedOn = input.startedOn ?? new Date().toISOString().slice(0, 10);
      await tx
        .update(contactEmployments)
        .set({ isCurrent: false, endedOn })
        .where(
          and(
            eq(contactEmployments.workspaceId, input.workspaceId),
            eq(contactEmployments.contactId, input.contactId),
            eq(contactEmployments.isCurrent, true),
          ),
        );
      const rows = await tx
        .insert(contactEmployments)
        .values({
          id: input.id,
          workspaceId: input.workspaceId,
          contactId: input.contactId,
          companyId: input.companyId,
          title: input.title,
          startedOn: input.startedOn,
          isCurrent: true,
        })
        .returning();
      const eventId = await this.recordEvent(
        tx,
        input.workspaceId,
        "Contact",
        input.contactId,
        "ContactEmploymentChanged",
        { contactId: input.contactId, companyId: input.companyId },
      );
      return rows[0]!;
    });
  }

  async suppressContact(input: {
    workspaceId: string;
    contactId: string;
    channel: "global" | "email" | "linkedin" | "whatsapp";
    reason: string | null;
    userId: string;
  }) {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(contacts)
        .set({ status: "suppressed", updatedAt: new Date() })
        .where(
          and(
            eq(contacts.workspaceId, input.workspaceId),
            eq(contacts.id, input.contactId),
          ),
        )
        .returning({ id: contacts.id });
      if (rows.length !== 1) throw new Error("CONTACT_NOT_FOUND");
      const identities = await tx
        .select({
          type: contactIdentities.type,
          normalizedValue: contactIdentities.normalizedValue,
        })
        .from(contactIdentities)
        .where(
          and(
            eq(contactIdentities.workspaceId, input.workspaceId),
            eq(contactIdentities.contactId, input.contactId),
          ),
        );
      if (identities.length) {
        await tx
          .insert(contactSuppressions)
          .values(
            identities.map((identity) => ({
              id: crypto.randomUUID(),
              workspaceId: input.workspaceId,
              contactId: input.contactId,
              channel: input.channel,
              identityType: identity.type,
              normalizedValue: identity.normalizedValue,
              reason: input.reason,
              createdBy: input.userId,
            })),
          )
          .onConflictDoNothing();
      }
      const eventId = await this.recordEvent(
        tx,
        input.workspaceId,
        "Contact",
        input.contactId,
        "SuppressionRegistered",
        { contactId: input.contactId, channel: input.channel, actorUserId: input.userId },
      );
      await tx.insert(auditLogs).values({
        workspaceId: input.workspaceId,
        actorUserId: input.userId,
        action: "SuppressionRegistered",
        subjectType: "Contact",
        subjectId: input.contactId,
        changes: { contactId: input.contactId, channel: input.channel, reason: input.reason },
        sourceEventId: eventId,
      });
    });
  }

  async createSuppression(input: {
    id: string;
    workspaceId: string;
    identityType: "email" | "linkedin" | "phone" | "whatsapp";
    normalizedValue: string;
    channel: "global" | "email" | "linkedin" | "whatsapp";
    reason: string | null;
    createdBy: string;
  }) {
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(contactSuppressions)
        .values({
          id: input.id,
          workspaceId: input.workspaceId,
          contactId: null,
          identityType: input.identityType,
          normalizedValue: input.normalizedValue,
          channel: input.channel,
          reason: input.reason,
          createdBy: input.createdBy,
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted[0]) {
        const existing = await tx
          .select()
          .from(contactSuppressions)
          .where(
            and(
              eq(contactSuppressions.workspaceId, input.workspaceId),
              eq(contactSuppressions.identityType, input.identityType),
              eq(contactSuppressions.normalizedValue, input.normalizedValue),
              eq(contactSuppressions.channel, input.channel),
            ),
          )
          .limit(1);
        if (!existing[0]) throw new Error("SUPPRESSION_CREATE_FAILED");
        return existing[0];
      }
      const suppression = inserted[0];
      const eventId = await this.recordEvent(
        tx,
        input.workspaceId,
        "Suppression",
        suppression.id,
        "SuppressionRegistered",
        {
          suppressionId: suppression.id,
          identityType: input.identityType,
          channel: input.channel,
        },
      );
      await tx.insert(auditLogs).values({
        workspaceId: input.workspaceId,
        actorUserId: input.createdBy,
        action: "SuppressionRegistered",
        subjectType: "Suppression",
        subjectId: suppression.id,
        changes: { identityType: input.identityType, channel: input.channel, reason: input.reason },
        sourceEventId: eventId,
      });
      return suppression;
    });
  }

  async listSuppressions(input: {
    workspaceId: string;
    channel?: "global" | "email" | "linkedin" | "whatsapp";
    cursor?: CompanyListCursor;
    limit: number;
  }) {
    const conditions: SQL[] = [eq(contactSuppressions.workspaceId, input.workspaceId)];
    if (input.channel) conditions.push(eq(contactSuppressions.channel, input.channel));
    if (input.cursor) {
      conditions.push(
        or(
          sql`date_trunc('milliseconds', ${contactSuppressions.createdAt}) < ${input.cursor.createdAt.toISOString()}::timestamptz`,
          and(
            sql`date_trunc('milliseconds', ${contactSuppressions.createdAt}) = ${input.cursor.createdAt.toISOString()}::timestamptz`,
            lt(contactSuppressions.id, input.cursor.id),
          ),
        )!,
      );
    }
    const rows = await this.db
      .select()
      .from(contactSuppressions)
      .where(and(...conditions))
      .orderBy(desc(contactSuppressions.createdAt), desc(contactSuppressions.id))
      .limit(input.limit + 1);
    const data = rows.slice(0, input.limit);
    const last = data.at(-1);
    return {
      data,
      nextCursor: rows.length > input.limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }

  async checkSuppression(input: {
    workspaceId: string;
    identityType: "email" | "linkedin" | "phone" | "whatsapp";
    normalizedValue: string;
    channel: "global" | "email" | "linkedin" | "phone" | "whatsapp";
  }) {
    const rows = await this.db
      .select({ id: contactSuppressions.id, channel: contactSuppressions.channel, reason: contactSuppressions.reason })
      .from(contactSuppressions)
      .where(
        and(
          eq(contactSuppressions.workspaceId, input.workspaceId),
          eq(contactSuppressions.identityType, input.identityType),
          eq(contactSuppressions.normalizedValue, input.normalizedValue),
          isNull(contactSuppressions.liftedAt),
          or(eq(contactSuppressions.channel, "global"), eq(contactSuppressions.channel, input.channel as never)),
        ),
      )
      .limit(1);
    const match = rows[0];
    return match
      ? { eligible: false, suppressionId: match.id, channel: match.channel, reason: match.reason }
      : { eligible: true, suppressionId: null, channel: null, reason: null };
  }

  async liftSuppression(input: {
    workspaceId: string;
    suppressionId: string;
    liftedBy: string;
    justification: string;
  }) {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(contactSuppressions)
        .where(
          and(
            eq(contactSuppressions.workspaceId, input.workspaceId),
            eq(contactSuppressions.id, input.suppressionId),
          ),
        )
        .limit(1);
      const existing = rows[0];
      if (!existing) throw new Error("SUPPRESSION_NOT_FOUND");
      if (existing.liftedAt) return existing;
      const liftedAt = new Date();
      const updated = await tx
        .update(contactSuppressions)
        .set({ liftedAt, liftedBy: input.liftedBy, liftJustification: input.justification })
        .where(
          and(
            eq(contactSuppressions.workspaceId, input.workspaceId),
            eq(contactSuppressions.id, input.suppressionId),
            isNull(contactSuppressions.liftedAt),
          ),
        )
        .returning();
      if (!updated[0]) return existing;
      const eventId = await this.recordEvent(
        tx,
        input.workspaceId,
        "Suppression",
        input.suppressionId,
        "SuppressionLifted",
        { suppressionId: input.suppressionId, justification: input.justification },
      );
      await tx.insert(auditLogs).values({
        workspaceId: input.workspaceId,
        actorUserId: input.liftedBy,
        action: "SuppressionLifted",
        subjectType: "Suppression",
        subjectId: input.suppressionId,
        changes: { justification: input.justification },
        sourceEventId: eventId,
      });
      return updated[0]!;
    });
  }

  private async assertNotSuppressed(
    tx: Pick<Database, "select">,
    workspaceId: string,
    identities: readonly { type: string; normalizedValue: string }[],
  ): Promise<void> {
    for (const identity of identities) {
      const matches = await tx
        .select({ id: contactSuppressions.id })
        .from(contactSuppressions)
        .where(
          and(
            eq(contactSuppressions.workspaceId, workspaceId),
            eq(contactSuppressions.identityType, identity.type as never),
            eq(contactSuppressions.normalizedValue, identity.normalizedValue),
            isNull(contactSuppressions.liftedAt),
            eq(contactSuppressions.channel, "global"),
          ),
        )
        .limit(1);
      if (matches.length) throw new Error("CONTACT_SUPPRESSED");
    }
  }

  private async assertCompanyExists(
    tx: Pick<Database, "select">,
    workspaceId: string,
    companyId: string,
  ): Promise<void> {
    const rows = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.workspaceId, workspaceId), eq(companies.id, companyId)))
      .limit(1);
    if (!rows[0]) throw new Error("COMPANY_NOT_FOUND");
  }

  private async currentEmploymentsByContact(
    workspaceId: string,
    contactIds: readonly string[],
  ): Promise<Map<string, { companyId: string; companyName: string; title: string }>> {
    const result = new Map<string, { companyId: string; companyName: string; title: string }>();
    if (!contactIds.length) return result;
    const rows = await this.db
      .select({
        contactId: contactEmployments.contactId,
        companyId: contactEmployments.companyId,
        companyName: companies.name,
        title: contactEmployments.title,
      })
      .from(contactEmployments)
      .innerJoin(
        companies,
        and(
          eq(contactEmployments.workspaceId, companies.workspaceId),
          eq(contactEmployments.companyId, companies.id),
        ),
      )
      .where(
        and(
          eq(contactEmployments.workspaceId, workspaceId),
          eq(contactEmployments.isCurrent, true),
        ),
      );
    for (const row of rows) {
      if (contactIds.includes(row.contactId)) {
        result.set(row.contactId, {
          companyId: row.companyId,
          companyName: row.companyName,
          title: row.title,
        });
      }
    }
    return result;
  }

  private async recordEvent(
    executor: Pick<Database, "insert">,
    workspaceId: string,
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<string> {
    const rows = await executor.insert(outboxEvents).values({
      workspaceId,
      aggregateType,
      aggregateId,
      eventType,
      payload,
    }).returning({ id: outboxEvents.id });
    return rows[0]!.id;
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    if ("code" in current && (current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
