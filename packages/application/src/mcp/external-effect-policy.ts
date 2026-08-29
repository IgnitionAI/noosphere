import type { McpExecutionContext } from "./mcp-read-capabilities";
import type { McpEffectProposal, McpGovernedEffectKind } from "./mcp-governed-effects";
import type { ExternalEffectPolicy as ExternalEffectPolicyPort, ExternalEffectPolicyResult as ExternalEffectPolicyPortResult } from "./mcp-governed-effects";

/** Stable outcomes shared by preview and final policy evaluation. */
export const EXTERNAL_EFFECT_POLICY_CODES = [
  "OK",
  "CONTACT_SUPPRESSED",
  "HUMAN_REPLY_ARRIVED",
  "SOURCE_STALE",
  "CAMPAIGN_NOT_ACTIVE",
  "ACCOUNT_UNHEALTHY",
  "QUOTA_EXCEEDED",
  "ADAPTER_UNAVAILABLE",
  "POLICY_VERSION_UNSUPPORTED",
  "SCHEDULE_WINDOW_NOT_OPEN",
  "SCHEDULE_WINDOW_EXPIRED",
  "EFFECT_CANCELLED",
  "EFFECT_EXPIRED",
  "IDEMPOTENCY_CONFLICT",
] as const;

export type ExternalEffectPolicyCode = (typeof EXTERNAL_EFFECT_POLICY_CODES)[number];

export interface ExternalEffectSourceSnapshot {
  readonly kind: McpGovernedEffectKind;
  readonly aggregateId: string;
  readonly revision: number;
  readonly sourceVersion: number;
  readonly factsVersion: number;
  readonly sourceId: string;
  readonly sourceUpdatedAt: string;
  readonly [key: string]: unknown;
}

interface ExternalEffectFactsBase {
  readonly kind: McpGovernedEffectKind;
  readonly aggregateId: string;
  readonly revision: number;
  readonly sourceVersion: number;
  readonly factsVersion: number;
  readonly sourceId: string;
  readonly sourceUpdatedAt: string;
  readonly status: string;
  readonly deleted?: boolean;
  readonly contactPresent?: boolean;
  readonly suppressed?: boolean;
  readonly suppressionStatus?: "suppressed" | "opted_out";
  readonly humanReply?: boolean;
  readonly contact?: { readonly present?: boolean; readonly suppressed?: boolean };
  readonly humanReplyAt?: string | null;
  readonly hasHumanReply?: boolean;
  readonly cancelled?: boolean;
  readonly cancelledAt?: string | null;
  readonly expiresAt?: string | null;
  readonly evaluatedAt?: string;
  readonly accountHealthy: boolean;
  readonly account?: { readonly healthy?: boolean; readonly adapterAvailable?: boolean };
  readonly adapterAvailable: boolean;
  readonly capabilityAvailable?: boolean;
  readonly quotaAvailable: boolean;
  readonly quotaExceeded?: boolean;
  readonly quota?: { readonly available?: boolean; readonly remaining?: number };
  readonly idempotencyConflict?: boolean;
  readonly idempotency?: { readonly conflict?: boolean; readonly available?: boolean };
  readonly policyVersion?: string;
  readonly policyVersionSupported?: boolean;
  readonly supportedPolicyVersions?: readonly string[];
  readonly campaignActive?: boolean;
  readonly enrollmentActive?: boolean;
  readonly scheduleWindow?: {
    readonly start: string;
    readonly end: string;
    readonly timeZone?: string;
  };
  readonly scheduledFor?: string;
  readonly accountHealth?: { readonly status: string; readonly checkedAt: string };
}

/**
 * Authoritative, redacted projections. Each branch is discriminated by kind;
 * raw content, credentials, and provider responses are intentionally absent.
 */
export type ExternalEffectFacts =
  | (ExternalEffectFactsBase & { readonly kind: "conversation_reply"; readonly conversationStatus?: string })
  | (ExternalEffectFactsBase & { readonly kind: "content_publication"; readonly assetId?: string; readonly publicationId?: string; readonly assetVersionId: string; readonly contentVersion: number; readonly assetReady: boolean; readonly assetStatus: string; readonly strategyActive: boolean; readonly strategyDeleted: boolean; readonly strategyVersionId?: string; readonly strategyVersion: number })
  | (ExternalEffectFactsBase & { readonly kind: "meeting_proposal"; readonly slotPosition: number; readonly slotStart: string; readonly slotEnd: string; readonly timeZone: string })
  | (ExternalEffectFactsBase & { readonly kind: "campaign_activation"; readonly automationStage: string; readonly enrollmentFingerprint: string });

export interface ExternalEffectFactsReaderInput {
  readonly context: McpExecutionContext;
  readonly proposal: McpEffectProposal;
  readonly phase?: "preview" | "final";
}

/** Application port. Implementations may expose either name for compatibility with existing readers. */
export interface ExternalEffectFactsReader {
  readonly read?: (input: ExternalEffectFactsReaderInput) => Promise<unknown>;
  readonly readFacts?: (input: ExternalEffectFactsReaderInput) => Promise<unknown>;
}

export type ExternalEffectAuthoritativeFactsReader = ExternalEffectFactsReader;
export type ExternalEffectFactsPort = ExternalEffectFactsReader;
export type ExternalEffectFactsByKind = ExternalEffectFacts;
export type ExternalEffectAuthoritativeFacts = ExternalEffectFacts;

export interface ExternalEffectEvaluationInput {
  readonly context: McpExecutionContext;
  readonly proposal: McpEffectProposal;
  readonly phase?: "preview" | "final";
  readonly sourceSnapshot?: ExternalEffectSourceSnapshot;
  readonly now?: string;
}

export interface ExternalEffectStaleEvaluation {
  readonly stale: boolean;
  readonly code: ExternalEffectPolicyCode;
  readonly factsVersion: number;
}

export interface ExternalEffectPolicyInput extends ExternalEffectEvaluationInput {}

export interface ExternalEffectPolicyResult extends ExternalEffectPolicyPortResult {
  readonly code: ExternalEffectPolicyCode;
}

export interface ExternalEffectPolicyOptions {
  readonly now?: Date | string;
}

/** Pure evaluator: it reads only the authoritative application facts port. */
export class ExternalEffectStaleEvaluator {
  readonly #reader: ExternalEffectFactsReader;
  readonly #now: string | undefined;

  constructor(reader: ExternalEffectFactsReader, options: ExternalEffectPolicyOptions = {}) {
    this.#reader = reader;
    this.#now = options.now instanceof Date ? options.now.toISOString() : options.now;
  }

  async evaluateByKind(input: ExternalEffectEvaluationInput): Promise<ExternalEffectStaleEvaluation> {
    if (input.context.workspaceId !== input.proposal.workspaceId) return { stale: true, code: "ADAPTER_UNAVAILABLE", factsVersion: 0 };
    if (input.now !== undefined && !isIsoInstant(input.now)) return { stale: true, code: "ADAPTER_UNAVAILABLE", factsVersion: 0 };
    const facts = await this.readFacts(input);
    if (!facts) return { stale: true, code: "ADAPTER_UNAVAILABLE", factsVersion: 0 };

    const suppliedSnapshot = input.sourceSnapshot
      ? validateSnapshot(input.sourceSnapshot)
      : undefined;
    if (input.sourceSnapshot && !suppliedSnapshot) {
      return { stale: true, code: "SOURCE_STALE", factsVersion: facts.factsVersion };
    }
    const storedSnapshotValue = (input.proposal as McpEffectProposal & { readonly sourceSnapshot?: unknown }).sourceSnapshot;
    const storedSnapshot = sourceSnapshotFromProposal(input.proposal);
    if (storedSnapshotValue !== undefined && !storedSnapshot) {
      return { stale: true, code: "ADAPTER_UNAVAILABLE", factsVersion: facts.factsVersion };
    }
    if (suppliedSnapshot && storedSnapshot && !canonicalEqual(suppliedSnapshot, storedSnapshot)) {
      return { stale: true, code: "SOURCE_STALE", factsVersion: facts.factsVersion };
    }
    const snapshot = storedSnapshot ?? suppliedSnapshot;
    if (!snapshot || !validVersion(snapshot.revision) || !validVersion(snapshot.sourceVersion)) {
      return { stale: true, code: "SOURCE_STALE", factsVersion: facts.factsVersion };
    }
    if (snapshot.kind !== input.proposal.kind || !proposalBindingMatches(input.proposal, snapshot)) {
      return { stale: true, code: "ADAPTER_UNAVAILABLE", factsVersion: facts.factsVersion };
    }
    if (!validVersion(input.proposal.version) || !validVersion(input.proposal.revision) || !validVersion(input.proposal.sourceVersion)) {
      return { stale: true, code: "ADAPTER_UNAVAILABLE", factsVersion: facts.factsVersion };
    }
    if (snapshot.revision !== input.proposal.revision || snapshot.sourceVersion !== input.proposal.sourceVersion) {
      return { stale: true, code: "SOURCE_STALE", factsVersion: facts.factsVersion };
    }
    if (facts.factsVersion < input.proposal.version || facts.revision < input.proposal.revision || facts.sourceVersion < input.proposal.sourceVersion) {
      return { stale: true, code: "ADAPTER_UNAVAILABLE", factsVersion: facts.factsVersion };
    }
    const persistedVersions = persistedPolicyFactsVersions(input.proposal);
    if (!persistedVersions.valid || (input.phase === "final" && !persistedVersions.hasPreview)) {
      return { stale: true, code: "ADAPTER_UNAVAILABLE", factsVersion: facts.factsVersion };
    }
    if ((persistedVersions.previewVersion !== null && persistedVersions.previewVersion < snapshot.factsVersion)
      || (persistedVersions.finalVersion !== null && (persistedVersions.previewVersion === null || persistedVersions.finalVersion < persistedVersions.previewVersion))) {
      return { stale: true, code: "SOURCE_STALE", factsVersion: facts.factsVersion };
    }
    const minimumFactsVersion = Math.max(snapshot.factsVersion, ...persistedVersions.values, input.proposal.version);
    if (facts.factsVersion < minimumFactsVersion) return { stale: true, code: "SOURCE_STALE", factsVersion: facts.factsVersion };
    if (facts.kind !== snapshot.kind || facts.aggregateId !== snapshot.aggregateId) {
      return { stale: true, code: "SOURCE_STALE", factsVersion: facts.factsVersion };
    }

    const now = input.now ?? this.#now ?? facts.evaluatedAt;
    if (!isIsoInstant(now)) return { stale: true, code: "ADAPTER_UNAVAILABLE", factsVersion: facts.factsVersion };
    const semanticCode = this.semanticCode(facts, snapshot, now);
    if (semanticCode) return { stale: true, code: semanticCode, factsVersion: facts.factsVersion };
    if (snapshotChanged(snapshot, facts)) {
      return { stale: true, code: "SOURCE_STALE", factsVersion: facts.factsVersion };
    }
    if (facts.revision !== snapshot.revision || facts.sourceVersion !== snapshot.sourceVersion) {
      return { stale: true, code: "SOURCE_STALE", factsVersion: facts.factsVersion };
    }
    return { stale: false, code: "OK", factsVersion: facts.factsVersion };
  }

  private async readFacts(input: ExternalEffectEvaluationInput): Promise<ExternalEffectFacts | null> {
    const readerInput: ExternalEffectFactsReaderInput = { context: input.context, proposal: input.proposal };
    try {
      const inputWithPhase = input.phase !== undefined ? { ...readerInput, phase: input.phase } : readerInput;
      const value = this.#reader.readFacts
        ? await this.#reader.readFacts(inputWithPhase)
        : this.#reader.read
          ? await this.#reader.read(inputWithPhase)
          : null;
      return validateFacts(value);
    } catch {
      return null;
    }
  }

  private semanticCode(
    facts: ExternalEffectFacts,
    snapshot: ExternalEffectSourceSnapshot,
    now: string | undefined,
  ): ExternalEffectPolicyCode | null {
    if (facts.suppressed === true || facts.contact?.suppressed === true) return "CONTACT_SUPPRESSED";
    if (facts.humanReply === true || facts.hasHumanReply === true || facts.humanReplyAt !== null && facts.humanReplyAt !== undefined) return "HUMAN_REPLY_ARRIVED";
    if (facts.suppressionStatus === "suppressed" || facts.suppressionStatus === "opted_out") return "CONTACT_SUPPRESSED";
    if (facts.deleted === true) return "SOURCE_STALE";
    if (facts.cancelled === true || facts.cancelledAt) return "EFFECT_CANCELLED";
    if (isExpired(facts.expiresAt, now)) return "EFFECT_EXPIRED";
    if (facts.kind === "campaign_activation" && (facts.campaignActive === false || facts.enrollmentActive === false || ["paused", "inactive", "cancelled"].includes(facts.status ?? ""))) {
      return "CAMPAIGN_NOT_ACTIVE";
    }
    if (facts.accountHealthy === false || facts.account?.healthy === false || facts.accountHealth?.status !== undefined && facts.accountHealth.status !== "healthy") return "ACCOUNT_UNHEALTHY";
    if (facts.quotaExceeded === true || facts.quotaAvailable === false || facts.quota?.available === false || facts.quota?.remaining !== undefined && facts.quota.remaining <= 0) return "QUOTA_EXCEEDED";
    if (facts.idempotencyConflict === true || facts.idempotency?.conflict === true || facts.idempotency?.available === false) return "IDEMPOTENCY_CONFLICT";
    if (facts.policyVersionSupported === false || facts.policyVersion !== undefined && facts.supportedPolicyVersions !== undefined && !facts.supportedPolicyVersions.includes(facts.policyVersion)) return "POLICY_VERSION_UNSUPPORTED";
    if (facts.adapterAvailable === false || facts.capabilityAvailable === false || facts.account?.adapterAvailable === false) return "ADAPTER_UNAVAILABLE";
    if (facts.kind === "campaign_activation" && facts.adapterAvailable !== true) return "ADAPTER_UNAVAILABLE";
    if (facts.scheduleWindow && now) {
      const nowEpoch = Date.parse(now);
      const startEpoch = Date.parse(facts.scheduleWindow.start);
      const endEpoch = Date.parse(facts.scheduleWindow.end);
      if (nowEpoch < startEpoch) return "SCHEDULE_WINDOW_NOT_OPEN";
      if (nowEpoch >= endEpoch) return "SCHEDULE_WINDOW_EXPIRED";
    }
    if (facts.scheduledFor && now && Date.parse(facts.scheduledFor) < Date.parse(now)) return "SCHEDULE_WINDOW_EXPIRED";
    // Read the snapshot argument so that future kind branches cannot silently
    // forget to compare the mandatory source identity/version.
    void snapshot;
    return null;
  }
}

/** Shared policy facade. Preview and final differ only by their explicit phase. */
export class ExternalEffectPolicy implements ExternalEffectPolicyPort {
  readonly #evaluator: ExternalEffectStaleEvaluator;

  constructor(readerOrEvaluator: ExternalEffectFactsReader | ExternalEffectStaleEvaluator, options: ExternalEffectPolicyOptions = {}) {
    this.#evaluator = readerOrEvaluator instanceof ExternalEffectStaleEvaluator
      ? readerOrEvaluator
      : new ExternalEffectStaleEvaluator(readerOrEvaluator, options);
  }

  async preview(input: ExternalEffectPolicyInput): Promise<ExternalEffectPolicyResult> {
    return this.evaluate({ ...input, phase: "preview" });
  }

  async final(input: ExternalEffectPolicyInput): Promise<ExternalEffectPolicyResult> {
    return this.evaluate({ ...input, phase: "final" });
  }

  private async evaluate(input: ExternalEffectPolicyInput): Promise<ExternalEffectPolicyResult> {
    const result = await this.#evaluator.evaluateByKind(input);
    return {
      decision: result.stale ? "deny" : "allow",
      code: result.code,
      factsVersion: result.factsVersion,
    };
  }
}

export function createExternalEffectPolicy(
  reader: ExternalEffectFactsReader,
  options?: ExternalEffectPolicyOptions,
): ExternalEffectPolicy {
  return new ExternalEffectPolicy(reader, options);
}

function sourceSnapshotFromProposal(proposal: McpEffectProposal): ExternalEffectSourceSnapshot | null {
  const value = (proposal as McpEffectProposal & { readonly sourceSnapshot?: unknown }).sourceSnapshot;
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ExternalEffectSourceSnapshot>;
  return validateSnapshot(candidate);
}

function validVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validNonNegativeVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isExpired(value: string | null | undefined, now: string | undefined): boolean {
  return Boolean(value && now && Date.parse(value) <= Date.parse(now));
}

function snapshotChanged(snapshot: ExternalEffectSourceSnapshot, facts: ExternalEffectFacts): boolean {
  const current = facts as unknown as Record<string, unknown>;
  if (snapshot.kind === "campaign_activation" && snapshot.enrollmentFingerprint !== undefined
    && (facts.kind !== "campaign_activation" || snapshot.enrollmentFingerprint !== facts.enrollmentFingerprint)) return true;
  for (const field of Object.keys(snapshot)) {
    if (["kind", "aggregateId", "revision", "sourceVersion", "factsVersion", "enrollmentFingerprint"].includes(field)) continue;
    if (!canonicalEqual(snapshot[field], current[field])) return true;
  }
  return false;
}

function validateFacts(value: unknown): ExternalEffectFacts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!isEffectKind(candidate.kind) || typeof candidate.aggregateId !== "string" || candidate.aggregateId.length === 0) return null;
  if (!validVersion(candidate.factsVersion) || !validVersion(candidate.revision) || !validVersion(candidate.sourceVersion)) return null;
  if (typeof candidate.status !== "string" || candidate.status.length === 0 || typeof candidate.adapterAvailable !== "boolean" || typeof candidate.accountHealthy !== "boolean" || typeof candidate.quotaAvailable !== "boolean" || !isIsoInstant(candidate.evaluatedAt)) return null;
  for (const field of ["deleted", "contactPresent", "suppressed", "humanReply", "hasHumanReply", "cancelled", "adapterAvailable", "capabilityAvailable", "accountHealthy", "quotaAvailable", "quotaExceeded", "idempotencyConflict", "campaignActive", "enrollmentActive", "policyVersionSupported"] as const) {
    if (candidate[field] !== undefined && typeof candidate[field] !== "boolean") return null;
  }
  if (candidate.suppressionStatus !== undefined && candidate.suppressionStatus !== "suppressed" && candidate.suppressionStatus !== "opted_out") return null;
  if (!validateOptionalObject(candidate.contact, ["present", "suppressed"], ["present", "suppressed"])) return null;
  if (!validateOptionalObject(candidate.account, ["healthy", "adapterAvailable"], ["healthy", "adapterAvailable"])) return null;
  if (!validateOptionalObject(candidate.quota, ["available", "remaining"], ["available"], ["remaining"])) return null;
  if (!validateOptionalObject(candidate.idempotency, ["conflict", "available"], ["conflict", "available"])) return null;
  if (typeof candidate.sourceId !== "string" || candidate.sourceId.length === 0 || !isIsoInstant(candidate.sourceUpdatedAt)) return null;
  if (!validateDates(candidate)) return null;
  if (candidate.kind === "conversation_reply" && (typeof candidate.suppressed !== "boolean" || !("humanReplyAt" in candidate) || candidate.humanReplyAt !== null && !isIsoInstant(candidate.humanReplyAt))) return null;
  if (candidate.kind === "content_publication" && (typeof candidate.assetVersionId !== "string" || !validVersion(candidate.contentVersion) || typeof candidate.policyVersion !== "string"
    || (candidate.assetId !== undefined && typeof candidate.assetId !== "string") || (candidate.publicationId !== undefined && typeof candidate.publicationId !== "string")
    || typeof candidate.assetReady !== "boolean" || typeof candidate.assetStatus !== "string" || typeof candidate.strategyActive !== "boolean"
    || typeof candidate.strategyDeleted !== "boolean" || (candidate.strategyVersionId !== undefined && typeof candidate.strategyVersionId !== "string") || !validVersion(candidate.strategyVersion))) return null;
  if (candidate.kind === "meeting_proposal" && (!validNonNegativeVersion(candidate.slotPosition) || !isIsoInstant(candidate.slotStart) || !isIsoInstant(candidate.slotEnd) || typeof candidate.timeZone !== "string" || !candidate.timeZone || !isTimeZone(candidate.timeZone) || !isIsoInstant(candidate.expiresAt))) return null;
  if (candidate.kind === "campaign_activation" && (typeof candidate.policyVersion !== "string" || typeof candidate.automationStage !== "string" || typeof candidate.enrollmentFingerprint !== "string" || !isEnrollmentFingerprint(candidate.enrollmentFingerprint) || !validateScheduleWindow(candidate.scheduleWindow) || !validateAccountHealth(candidate.accountHealth))) return null;
  if (candidate.policyVersion !== undefined && typeof candidate.policyVersion !== "string") return null;
  if (candidate.supportedPolicyVersions !== undefined && (!Array.isArray(candidate.supportedPolicyVersions) || !candidate.supportedPolicyVersions.every((item) => typeof item === "string"))) return null;
  const projected: Record<string, unknown> = {};
  for (const field of FACTS_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(candidate, field)) projected[field] = candidate[field];
  }
  return projected as unknown as ExternalEffectFacts;
}

function persistedPolicyFactsVersions(proposal: McpEffectProposal): { readonly valid: boolean; readonly hasPreview: boolean; readonly previewVersion: number | null; readonly finalVersion: number | null; readonly values: readonly number[] } {
  const candidate = proposal as McpEffectProposal & { readonly policyPreview?: unknown; readonly policyFinal?: unknown };
  const values: number[] = [];
  let hasPreview = false;
  let previewVersion: number | null = null;
  let finalVersion: number | null = null;
  for (const [name, value] of [["policyPreview", candidate.policyPreview], ["policyFinal", candidate.policyFinal]] as const) {
    if (value === undefined || value === null) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, hasPreview, previewVersion, finalVersion, values };
    const factsVersion = (value as Record<string, unknown>).factsVersion;
    if (!validVersion(factsVersion)) return { valid: false, hasPreview, previewVersion, finalVersion, values };
    values.push(factsVersion);
    if (name === "policyPreview") { hasPreview = true; previewVersion = factsVersion; }
    else finalVersion = factsVersion;
  }
  return { valid: true, hasPreview, previewVersion, finalVersion, values };
}

function validateSnapshot(value: unknown): ExternalEffectSourceSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!isEffectKind(candidate.kind) || typeof candidate.aggregateId !== "string" || candidate.aggregateId.length === 0) return null;
  if (!validVersion(candidate.revision) || !validVersion(candidate.sourceVersion) || !validVersion(candidate.factsVersion)) return null;
  for (const field of Object.keys(candidate)) {
    if (!SNAPSHOT_FIELDS.has(field)) return null;
  }
  if (typeof candidate.sourceId !== "string" || candidate.sourceId.length === 0 || !isIsoInstant(candidate.sourceUpdatedAt)) return null;
  if (candidate.humanReply !== undefined && typeof candidate.humanReply !== "boolean") return null;
  if (candidate.hasHumanReply !== undefined && typeof candidate.hasHumanReply !== "boolean") return null;
  if (candidate.suppressionStatus !== undefined && candidate.suppressionStatus !== "suppressed" && candidate.suppressionStatus !== "opted_out") return null;
  if (candidate.slotPosition !== undefined && !validNonNegativeVersion(candidate.slotPosition)) return null;
  if (candidate.timeZone !== undefined && (typeof candidate.timeZone !== "string" || !isTimeZone(candidate.timeZone))) return null;
  if (candidate.scheduleWindow !== undefined && !validateScheduleWindow(candidate.scheduleWindow)) return null;
  if (candidate.accountHealth !== undefined && !validateAccountHealth(candidate.accountHealth)) return null;
  if (candidate.kind === "content_publication" && (
    candidate.assetId !== undefined && (typeof candidate.assetId !== "string" || candidate.assetId.length === 0)
    || candidate.publicationId !== undefined && (typeof candidate.publicationId !== "string" || candidate.publicationId.length === 0)
    || candidate.assetReady !== undefined && typeof candidate.assetReady !== "boolean"
    || candidate.assetStatus !== undefined && typeof candidate.assetStatus !== "string"
    || candidate.strategyActive !== undefined && typeof candidate.strategyActive !== "boolean"
    || candidate.strategyDeleted !== undefined && typeof candidate.strategyDeleted !== "boolean"
    || candidate.strategyVersion !== undefined && !validVersion(candidate.strategyVersion)
  )) return null;
  if (candidate.enrollmentFingerprint !== undefined && (typeof candidate.enrollmentFingerprint !== "string" || !isEnrollmentFingerprint(candidate.enrollmentFingerprint))) return null;
  return candidate as unknown as ExternalEffectSourceSnapshot;
}

function proposalBindingMatches(proposal: McpEffectProposal, snapshot: ExternalEffectSourceSnapshot): boolean {
  const aggregateId = (proposal as McpEffectProposal & { readonly aggregateId?: unknown }).aggregateId;
  return typeof aggregateId === "string" && aggregateId.length > 0 && aggregateId === snapshot.aggregateId;
}

function validateDates(facts: Record<string, unknown>): boolean {
  for (const field of ["sourceUpdatedAt", "humanReplyAt", "cancelledAt", "expiresAt", "evaluatedAt", "scheduledFor", "slotStart", "slotEnd"] as const) {
    const value = facts[field];
    if (value !== undefined && value !== null && !isIsoInstant(value)) return false;
  }
  const window = facts.scheduleWindow;
  if (window !== undefined) {
    if (!window || typeof window !== "object" || Array.isArray(window)) return false;
    const candidate = window as Record<string, unknown>;
    if (Object.keys(candidate).some((key) => !["start", "end", "timeZone"].includes(key))) return false;
    if (!isIsoInstant(candidate.start) || !isIsoInstant(candidate.end) || Date.parse(candidate.start) >= Date.parse(candidate.end)) return false;
    if (candidate.timeZone !== undefined && (typeof candidate.timeZone !== "string" || !isTimeZone(candidate.timeZone))) return false;
  }
  return true;
}

function validateScheduleWindow(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).every((key) => ["start", "end", "timeZone"].includes(key))
    && isIsoInstant(candidate.start) && isIsoInstant(candidate.end)
    && Date.parse(candidate.start) < Date.parse(candidate.end)
    && (candidate.timeZone === undefined || typeof candidate.timeZone === "string" && isTimeZone(candidate.timeZone));
}

function validateAccountHealth(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).every((key) => key === "status" || key === "checkedAt")
    && typeof candidate.status === "string" && ["healthy", "degraded", "unhealthy"].includes(candidate.status)
    && isIsoInstant(candidate.checkedAt);
}

function validateOptionalObject(
  value: unknown,
  allowedKeys: readonly string[],
  booleanKeys: readonly string[] = [],
  integerKeys: readonly string[] = [],
): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) return false;
  for (const key of booleanKeys) if (record[key] !== undefined && typeof record[key] !== "boolean") return false;
  for (const key of integerKeys) if (record[key] !== undefined && (!Number.isSafeInteger(record[key]) || (record[key] as number) < 0)) return false;
  return true;
}

function isTimeZone(value: string): boolean {
  if (value === "UTC" || /^[+-]\d{2}:\d{2}$/.test(value)) return value === "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return supported.length > 0 ? supported.includes(value) : value.includes("/");
  } catch {
    return false;
  }
}

function isEnrollmentFingerprint(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch);
}

function isEffectKind(value: unknown): value is McpGovernedEffectKind {
  return value === "conversation_reply" || value === "content_publication" || value === "meeting_proposal" || value === "campaign_activation";
}

const SNAPSHOT_FIELDS = new Set([
  "kind", "aggregateId", "revision", "sourceVersion", "factsVersion", "sourceId", "sourceUpdatedAt", "status", "conversationStatus",
  "assetId", "publicationId", "assetVersionId", "contentVersion", "assetReady", "assetStatus", "strategyActive", "strategyDeleted", "strategyVersionId", "strategyVersion", "slotStart", "slotEnd", "timeZone", "expiresAt", "cancelledAt", "cancelled",
  "policyVersion", "automationStage", "campaignActive", "enrollmentActive", "suppressed", "humanReplyAt", "hasHumanReply",
  "scheduleWindow", "scheduledFor", "accountHealthy", "accountHealth", "account", "capabilityAvailable", "adapterAvailable", "quotaAvailable", "quota", "contact", "idempotency", "suppressionStatus", "humanReply", "slotPosition", "enrollmentFingerprint",
]);

const FACTS_FIELDS = new Set([
  "kind", "aggregateId", "revision", "sourceVersion", "factsVersion", "sourceId", "sourceUpdatedAt", "status", "conversationStatus",
  "deleted", "contactPresent", "contact", "suppressed", "suppressionStatus", "humanReply", "humanReplyAt", "hasHumanReply",
  "cancelled", "cancelledAt", "expiresAt", "evaluatedAt", "accountHealthy", "account", "capabilityAvailable", "adapterAvailable",
  "quotaAvailable", "quotaExceeded", "quota", "idempotencyConflict", "idempotency", "policyVersion", "policyVersionSupported",
  "supportedPolicyVersions", "campaignActive", "enrollmentActive", "scheduleWindow", "scheduledFor", "assetId", "publicationId", "assetVersionId", "contentVersion",
  "assetReady", "assetStatus", "strategyActive", "strategyDeleted", "strategyVersionId", "strategyVersion", "slotPosition", "slotStart", "slotEnd", "timeZone", "automationStage", "enrollmentFingerprint", "accountHealth",
]);

function canonicalEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => canonicalEqual(value, right[index]));
  }
  if (typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && canonicalEqual(leftRecord[key], rightRecord[key]));
}
