export const ENRICHMENT_OBSERVATION_STATUSES = [
  "found",
  "probable",
  "verified",
  "invalid",
] as const;

export type EnrichmentObservationStatus = (typeof ENRICHMENT_OBSERVATION_STATUSES)[number];

export const ENRICHMENT_PHONE_KINDS = ["public_company", "personal"] as const;
export type EnrichmentPhoneKind = (typeof ENRICHMENT_PHONE_KINDS)[number];

export type EnrichmentConfidence = "high" | "medium" | "low" | "none";

export interface EnrichmentObservation {
  readonly id: string;
  readonly workspaceId: string;
  readonly jobId: string;
  readonly entityType: "contact" | "company";
  readonly entityId: string;
  readonly field: string;
  readonly value: string;
  readonly normalizedValue: string;
  readonly status: EnrichmentObservationStatus;
  readonly confidence: EnrichmentConfidence;
  readonly source: string;
  readonly provider: string | null;
  readonly evidenceUrl: string | null;
  readonly evidenceSnippet: string | null;
  readonly observedAt: Date;
  readonly phoneKind: EnrichmentPhoneKind | null;
}

const STATUS_RANK: Record<EnrichmentObservationStatus, number> = {
  invalid: 0,
  found: 1,
  probable: 2,
  verified: 3,
};

/** A lower-confidence observation must never replace a stronger value. */
export function canReplaceObservation(
  current: Pick<EnrichmentObservation, "status" | "observedAt"> | null,
  candidate: Pick<EnrichmentObservation, "status" | "observedAt">,
): boolean {
  if (!current) return true;
  const currentRank = STATUS_RANK[current.status];
  const candidateRank = STATUS_RANK[candidate.status];
  return candidateRank > currentRank
    || (candidateRank === currentRank && candidate.observedAt.getTime() > current.observedAt.getTime());
}

export function assertEnrichmentObservation(input: {
  field: string;
  status: EnrichmentObservationStatus;
  phoneKind?: EnrichmentPhoneKind | null;
}): void {
  if (!input.field.trim()) throw new Error("ENRICHMENT_FIELD_REQUIRED");
  if (input.field === "phone" && !input.phoneKind) {
    throw new Error("ENRICHMENT_PHONE_KIND_REQUIRED");
  }
  if (input.field !== "phone" && input.phoneKind) {
    throw new Error("ENRICHMENT_PHONE_KIND_INVALID");
  }
}

