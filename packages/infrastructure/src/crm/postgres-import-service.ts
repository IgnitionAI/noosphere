import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { LeasedJob, JobQueue } from "@outbound/application/jobs/job-queue";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  companies,
  contactIdentities,
  contactSuppressions,
  auditLogs,
  importBatches,
  importRows,
  jobs,
  outboxEvents,
} from "@outbound/infrastructure/database/schema";
import { PostgresCrmRepository } from "./postgres-crm-repository";
import {
  normalizeDomain,
  normalizeEmail,
  normalizeLinkedinUrl,
  normalizePhone,
} from "@outbound/domain/crm/normalization";

export type ImportMapping = Readonly<Record<string, string>>;
export type ImportRowStatus = "valid" | "invalid" | "duplicate" | "suppressed" | "created" | "failed";

export interface ImportBatchView {
  readonly id: string;
  readonly filename: string;
  readonly status: string;
  readonly previewedAt: Date | null;
  readonly appliedAt: Date | null;
  readonly completedAt: Date | null;
  readonly createdBy: string | null;
  readonly totals: unknown;
  readonly createdAt: Date;
  readonly rows: readonly ImportRowView[];
}

export interface ImportRowView {
  readonly id: string;
  readonly lineNumber: number;
  readonly rawData: unknown;
  readonly normalizedData: unknown;
  readonly status: string;
  readonly reason: string | null;
  readonly companyId: string | null;
  readonly contactId: string | null;
}

interface NormalizedRow {
  firstName: string;
  lastName: string;
  email: string | null;
  linkedin: string | null;
  phone: string | null;
  whatsapp: string | null;
  companyName: string | null;
  domain: string | null;
  title: string | null;
  startedOn: string | null;
}

interface ImportJobPayload {
  readonly batchId: string;
}

export class PostgresImportService {
  private readonly crm: PostgresCrmRepository;

  constructor(private readonly db: Database, private readonly queue?: JobQueue) {
    this.crm = new PostgresCrmRepository(db);
  }

  async create(input: {
    id: string;
    workspaceId: string;
    filename: string;
    content: string;
    mapping?: ImportMapping;
    createdBy: string;
  }): Promise<ImportBatchView> {
    if (Buffer.byteLength(input.content, "utf8") > 10 * 1024 * 1024) {
      throw new Error("IMPORT_FILE_TOO_LARGE");
    }
    const mapping = input.mapping ?? {};
    const fileHash = hash(input.content);
    const idempotencyKey = hash(`${fileHash}:${stableJson(mapping)}`);
    const encrypted = encrypt(input.content);
    const rows = parseCsv(input.content);
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(importBatches)
        .values({
          id: input.id,
          workspaceId: input.workspaceId,
          filename: input.filename,
          fileHash,
          idempotencyKey,
          mapping,
          rawContent: encrypted,
          rawExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
          createdBy: input.createdBy,
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted[0]) {
        const existing = await tx
          .select({ id: importBatches.id })
          .from(importBatches)
          .where(and(eq(importBatches.workspaceId, input.workspaceId), eq(importBatches.idempotencyKey, idempotencyKey)))
          .limit(1);
        if (!existing[0]) throw new Error("IMPORT_CREATE_FAILED");
        return this.get(input.workspaceId, existing[0].id, tx);
      }
      const batch = inserted[0];
      const normalizedRows = rows.map((row, index) => normalizeRow(row, mapping, index + 2));
      const fingerprints = new Set<string>();
      for (let index = 0; index < normalizedRows.length; index += 1) {
        const parsed = normalizedRows[index]!;
        const rowId = crypto.randomUUID();
        let status: ImportRowStatus = "valid";
        let reason: string | null = null;
        if (parsed.error) {
          status = "invalid";
          reason = parsed.error;
        } else if (fingerprints.has(parsed.fingerprint)) {
          status = "duplicate";
          reason = "duplicate row in file";
        } else if (await this.isSuppressed(tx, input.workspaceId, parsed.value!)) {
          status = "suppressed";
          reason = "suppression active";
        } else if (await this.isDuplicate(tx, input.workspaceId, parsed.value!)) {
          status = "duplicate";
          reason = "existing identity or company";
        }
        fingerprints.add(parsed.fingerprint);
        await tx.insert(importRows).values({
          id: rowId,
          workspaceId: input.workspaceId,
          batchId: batch.id,
          lineNumber: index + 2,
          rawData: rows[index]!,
          normalizedData: parsed.value ?? {},
          rowFingerprint: parsed.fingerprint,
          status,
          reason,
        });
      }
      const totals = summarizeRows(normalizedRows.map((_, index) => index));
      const statuses = await tx
        .select({ status: importRows.status })
        .from(importRows)
        .where(and(eq(importRows.workspaceId, input.workspaceId), eq(importRows.batchId, batch.id)));
      const finalTotals = summarizeStatuses(statuses.map((row) => row.status));
      await tx
        .update(importBatches)
        .set({ status: "previewed", previewedAt: new Date(), totals: { ...totals, ...finalTotals }, updatedAt: new Date() })
        .where(and(eq(importBatches.workspaceId, input.workspaceId), eq(importBatches.id, batch.id)));
      const eventId = await recordEvent(tx, input.workspaceId, batch.id, "ImportUploaded", {
        importId: batch.id,
        filename: input.filename,
        totals: { ...totals, ...finalTotals },
      });
      await tx.insert(auditLogs).values({
        workspaceId: input.workspaceId,
        actorUserId: input.createdBy,
        action: "ImportUploaded",
        subjectType: "ImportBatch",
        subjectId: batch.id,
        changes: { filename: input.filename, totals: { ...totals, ...finalTotals } },
        sourceEventId: eventId,
      });
      return this.get(input.workspaceId, batch.id, tx);
    });
  }

  async get(workspaceId: string, batchId: string, executor: Pick<Database, "select"> = this.db): Promise<ImportBatchView> {
    const batches = await executor
      .select()
      .from(importBatches)
      .where(and(eq(importBatches.workspaceId, workspaceId), eq(importBatches.id, batchId)))
      .limit(1);
    const batch = batches[0];
    if (!batch) throw new Error("IMPORT_NOT_FOUND");
    const rows = await executor
      .select()
      .from(importRows)
      .where(and(eq(importRows.workspaceId, workspaceId), eq(importRows.batchId, batchId)))
      .orderBy(importRows.lineNumber);
    return { ...batch, rows };
  }

  async preview(workspaceId: string, batchId: string): Promise<ImportBatchView> {
    return this.get(workspaceId, batchId);
  }

  async apply(input: { workspaceId: string; batchId: string; correlationId: string }): Promise<ImportBatchView> {
    const existing = await this.get(input.workspaceId, input.batchId);
    if (!existing.previewedAt) throw new Error("IMPORT_PREVIEW_REQUIRED");
    if (existing.status === "completed" || existing.status === "applying") return existing;
    const now = new Date();
    const job = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      type: "crm.import.apply",
      payload: { batchId: input.batchId } satisfies ImportJobPayload,
      idempotencyKey: input.batchId,
      correlationId: input.correlationId,
      maxAttempts: 5,
      availableAt: now,
    };
    if (this.queue) await this.queue.enqueue(job);
    else await this.db.insert(jobs).values({ ...job, payload: job.payload });
    const updated = await this.db
      .update(importBatches)
      .set({ status: "applying", appliedAt: now, updatedAt: now })
      .where(and(eq(importBatches.workspaceId, input.workspaceId), eq(importBatches.id, input.batchId), eq(importBatches.status, "previewed")))
      .returning();
    if (!updated[0]) return this.get(input.workspaceId, input.batchId);
    return this.get(input.workspaceId, input.batchId);
  }

  async process(job: LeasedJob<ImportJobPayload>): Promise<void> {
    const batch = await this.get(job.workspaceId, job.payload.batchId);
    if (batch.status === "completed") return;
    for (const row of batch.rows) {
      if (row.status !== "valid") continue;
      const value = row.normalizedData as NormalizedRow;
      try {
        if (await this.isSuppressed(this.db, job.workspaceId, value)) {
          await this.updateRow(job.workspaceId, row.id, { status: "suppressed", reason: "suppression active" });
          continue;
        }
        if (await this.isDuplicate(this.db, job.workspaceId, value)) {
          await this.updateRow(job.workspaceId, row.id, { status: "duplicate", reason: "existing identity or company" });
          continue;
        }
        let companyId: string | null = null;
        if (value.domain) {
          const existingCompany = await this.db
            .select({ id: companies.id })
            .from(companies)
            .where(and(eq(companies.workspaceId, job.workspaceId), eq(companies.normalizedDomain, value.domain)))
            .limit(1);
          if (existingCompany[0]) companyId = existingCompany[0].id;
          else if (value.companyName) {
            companyId = crypto.randomUUID();
            try {
              await this.crm.createCompany({
                id: companyId,
                workspaceId: job.workspaceId,
                name: value.companyName,
                normalizedDomain: value.domain,
                sector: null,
                employeeCountMin: null,
                employeeCountMax: null,
                location: null,
                linkedinUrl: null,
                source: "csv",
              });
            } catch (error) {
              if (!String(error).includes("COMPANY_DOMAIN_CONFLICT")) throw error;
              const winner = await this.db.select({ id: companies.id }).from(companies).where(and(eq(companies.workspaceId, job.workspaceId), eq(companies.normalizedDomain, value.domain))).limit(1);
              companyId = winner[0]?.id ?? null;
            }
          }
        }
        const contactId = crypto.randomUUID();
        await this.crm.createContact({
          id: contactId,
          workspaceId: job.workspaceId,
          firstName: value.firstName,
          lastName: value.lastName,
          source: "csv",
          identities: identityValues(value).map((identity) => ({ id: crypto.randomUUID(), ...identity })),
          employment: companyId && value.title ? { id: crypto.randomUUID(), companyId, title: value.title, startedOn: value.startedOn } : null,
        });
        await this.updateRow(job.workspaceId, row.id, { status: "created", companyId, contactId, reason: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.updateRow(job.workspaceId, row.id, { status: message === "CONTACT_IDENTITY_CONFLICT" ? "duplicate" : "failed", reason: message.slice(0, 500) });
      }
    }
    const rows = await this.db.select({ status: importRows.status }).from(importRows).where(and(eq(importRows.workspaceId, job.workspaceId), eq(importRows.batchId, job.payload.batchId)));
    const totals = summarizeStatuses(rows.map((row) => row.status));
    await this.db.update(importBatches).set({ status: "completed", completedAt: new Date(), totals, rawContent: "", updatedAt: new Date() }).where(and(eq(importBatches.workspaceId, job.workspaceId), eq(importBatches.id, job.payload.batchId)));
    const eventId = await recordEvent(this.db, job.workspaceId, job.payload.batchId, "ImportApplied", { importId: job.payload.batchId, totals });
    await this.db.insert(auditLogs).values({
      workspaceId: job.workspaceId,
      actorUserId: batch.createdBy,
      action: "ImportApplied",
      subjectType: "ImportBatch",
      subjectId: job.payload.batchId,
      changes: totals,
      sourceEventId: eventId,
    });
  }

  private async updateRow(workspaceId: string, rowId: string, fields: { status: string; reason: string | null; companyId?: string | null; contactId?: string | null }) {
    await this.db.update(importRows).set({ ...fields, updatedAt: new Date() }).where(and(eq(importRows.workspaceId, workspaceId), eq(importRows.id, rowId)));
  }

  private async isDuplicate(executor: Pick<Database, "select">, workspaceId: string, value: NormalizedRow): Promise<boolean> {
    const identityValues = identityValuesForQuery(value);
    if (identityValues.length) {
      const identities = await executor
        .select({ id: contactIdentities.id })
        .from(contactIdentities)
        .where(and(eq(contactIdentities.workspaceId, workspaceId), or(...identityValues.map((identity) => and(eq(contactIdentities.type, identity.type), eq(contactIdentities.normalizedValue, identity.normalizedValue))))))
        .limit(1);
      if (identities.length) return true;
    }
    if (value.domain) {
      const domains = await executor.select({ id: companies.id }).from(companies).where(and(eq(companies.workspaceId, workspaceId), eq(companies.normalizedDomain, value.domain))).limit(1);
      if (domains.length) return true;
    }
    return false;
  }

  private async isSuppressed(executor: Pick<Database, "select">, workspaceId: string, value: NormalizedRow): Promise<boolean> {
    const identities = identityValuesForQuery(value);
    for (const identity of identities) {
      const channels = identity.type === "email" ? ["global", "email"] : identity.type === "linkedin" ? ["global", "linkedin"] : identity.type === "whatsapp" ? ["global", "whatsapp"] : ["global"];
      const rows = await executor.select({ id: contactSuppressions.id }).from(contactSuppressions).where(and(eq(contactSuppressions.workspaceId, workspaceId), eq(contactSuppressions.identityType, identity.type), eq(contactSuppressions.normalizedValue, identity.normalizedValue), isNull(contactSuppressions.liftedAt), inArray(contactSuppressions.channel, channels as never))).limit(1);
      if (rows.length) return true;
    }
    return false;
  }
}

function identityValues(value: NormalizedRow) {
  return identityValuesForQuery(value).map((identity) => ({ type: identity.type, value: identity.normalizedValue, normalizedValue: identity.normalizedValue }));
}

function identityValuesForQuery(value: NormalizedRow): Array<{ type: "email" | "linkedin" | "phone" | "whatsapp"; normalizedValue: string }> {
  return ([
    value.email ? { type: "email" as const, normalizedValue: value.email } : null,
    value.linkedin ? { type: "linkedin" as const, normalizedValue: value.linkedin } : null,
    value.phone ? { type: "phone" as const, normalizedValue: value.phone } : null,
    value.whatsapp ? { type: "whatsapp" as const, normalizedValue: value.whatsapp } : null,
  ]).filter((entry): entry is { type: "email" | "linkedin" | "phone" | "whatsapp"; normalizedValue: string } => entry !== null);
}

function normalizeRow(row: Record<string, string>, mapping: ImportMapping, lineNumber: number): { value: NormalizedRow | null; error: string | null; fingerprint: string } {
  const get = (field: string, aliases: readonly string[] = []): string => {
    const source = mapping[field] ?? [field, ...aliases].find((alias) => Object.keys(row).some((key) => normalizeHeader(key) === normalizeHeader(alias)));
    return (source ? row[source] : "")?.trim() ?? "";
  };
  try {
    const firstName = get("firstName", ["first_name", "firstname", "prenom"]);
    const lastName = get("lastName", ["last_name", "lastname", "nom"]);
    const emailRaw = get("email", ["mail", "e-mail"]);
    const linkedinRaw = get("linkedin", ["linkedin_url", "linkedinurl"]);
    const phoneRaw = get("phone", ["telephone", "tel"]);
    const whatsappRaw = get("whatsapp");
    if (!firstName || !lastName) throw new Error("firstName and lastName are required");
    if (!emailRaw && !linkedinRaw && !phoneRaw && !whatsappRaw) throw new Error("at least one identity is required");
    const value: NormalizedRow = {
      firstName,
      lastName,
      email: emailRaw ? normalizeEmail(emailRaw) : null,
      linkedin: linkedinRaw ? normalizeLinkedinUrl(linkedinRaw) : null,
      phone: phoneRaw ? normalizePhone(phoneRaw) : null,
      whatsapp: whatsappRaw ? normalizePhone(whatsappRaw) : null,
      companyName: get("companyName", ["company", "company_name", "entreprise"]) || null,
      domain: normalizeDomain(get("domain", ["companyDomain", "company_domain", "website"])) || null,
      title: get("title", ["job_title", "poste"]) || null,
      startedOn: get("startedOn", ["started_on", "start_date"]) || null,
    };
    return { value, error: null, fingerprint: hash(stableJson(value)) };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : "invalid row", fingerprint: hash(`${lineNumber}:${stableJson(row)}`) };
  }
}

function parseCsv(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;
    const next = content[index + 1];
    if (character === '"' && quoted && next === '"') { current += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (character === "," && !quoted) { row.push(current); current = ""; continue; }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(current); current = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    current += character;
  }
  if (current || row.length) { row.push(current); if (row.some((cell) => cell.trim() !== "")) rows.push(row); }
  const headers = (rows.shift() ?? []).map((header) => header.trim());
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function normalizeHeader(header: string): string { return header.toLowerCase().replaceAll(/[^a-z0-9]/g, ""); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function stableJson(value: unknown): string { return JSON.stringify(value, Object.keys((value ?? {}) as object).sort()); }
function encrypt(value: string): string {
  const key = createHash("sha256").update(process.env.IMPORT_ENCRYPTION_KEY ?? "ignition-outbound-import-key").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}
function summarizeRows(_rows: readonly number[]) { return { total: _rows.length }; }
function summarizeStatuses(statuses: readonly string[]) {
  return statuses.reduce<Record<string, number>>((result, status) => { result.total = (result.total ?? 0) + 1; result[status] = (result[status] ?? 0) + 1; return result; }, {});
}

async function recordEvent(
  executor: Pick<Database, "insert">,
  workspaceId: string,
  aggregateId: string,
  eventType: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<string> {
  const rows = await executor.insert(outboxEvents).values({ workspaceId, aggregateType: "Import", aggregateId, eventType, payload }).returning({ id: outboxEvents.id });
  return rows[0]!.id;
}
