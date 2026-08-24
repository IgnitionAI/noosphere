export const SIGNAL_TYPES = [
  "hiring",
  "funding",
  "job_change",
  "leadership_change",
  "geographic_expansion",
  "public_activity",
  "technology",
  "competitor",
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];
export type SignalEntityType = "company" | "contact";
export type SignalConfidence = "high" | "medium" | "low";

export interface IntentSignal {
  readonly id: string;
  readonly workspaceId: string;
  readonly signalType: SignalType;
  readonly entityType: SignalEntityType;
  readonly entityId: string;
  readonly companyId: string | null;
  readonly contactId: string | null;
  readonly source: string;
  readonly sources: readonly string[];
  readonly providerEventId: string | null;
  readonly evidenceUrl: string;
  readonly evidenceSnippet: string | null;
  readonly observedAt: Date;
  readonly expiresAt: Date;
  readonly confidence: SignalConfidence;
  readonly deduplicationKey: string;
  readonly legalBasis: string;
  readonly sourceAuthorized: boolean;
}
export function signalIsCurrent(signal: Pick<IntentSignal, "expiresAt">, now = new Date()): boolean {
  return signal.expiresAt.getTime() > now.getTime();
}

export function assertSignal(input: {
  signalType: SignalType;
  entityType: SignalEntityType;
  evidenceUrl: string;
  observedAt: Date;
  expiresAt: Date;
  confidence: SignalConfidence;
  deduplicationKey: string;
  legalBasis: string;
  sourceAuthorized: boolean;
}): void {
  if (!input.evidenceUrl.trim()) throw new Error("SIGNAL_EVIDENCE_REQUIRED");
  if (!input.deduplicationKey.trim()) throw new Error("SIGNAL_DEDUP_KEY_REQUIRED");
  if (!input.legalBasis.trim()) throw new Error("SIGNAL_LEGAL_BASIS_REQUIRED");
  if (input.signalType === "competitor" && !input.sourceAuthorized) throw new Error("SIGNAL_SOURCE_NOT_AUTHORIZED");
  if (input.entityType === "contact" && input.signalType === "funding") throw new Error("SIGNAL_TARGET_INVALID");
}

export function confidenceRank(confidence: SignalConfidence): number {
  return confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
}

export function expirationForSignalType(signalType: SignalType, observedAt: Date): Date {
  const days = signalType === "hiring" ? 45
    : signalType === "funding" ? 180
      : signalType === "job_change" || signalType === "leadership_change" ? 90
        : signalType === "geographic_expansion" ? 180
          : signalType === "public_activity" ? 30
            : signalType === "technology" ? 180
              : 90;
  return new Date(observedAt.getTime() + days * 86_400_000);
}
