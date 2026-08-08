import type { SignalConfidence, SignalEntityType, SignalType } from "@outbound/domain/crm/intent-signal";

export interface SignalSourceObservation {
  readonly signalType: SignalType;
  readonly entityType: SignalEntityType;
  readonly entityId: string;
  readonly companyId: string | null;
  readonly contactId: string | null;
  readonly source: string;
  readonly providerEventId?: string | null;
  readonly evidenceUrl: string;
  readonly evidenceSnippet?: string | null;
  readonly observedAt: Date;
  readonly expiresAt: Date;
  readonly confidence: SignalConfidence;
  readonly deduplicationKey: string;
  readonly legalBasis: string;
  readonly sourceAuthorized: boolean;
}
export interface SignalSource {
  readonly name: string;
  readonly supportedTypes: readonly SignalType[];
  collect(input: {
    workspaceId: string;
    entityType: SignalEntityType;
    entityId: string;
    companyId: string | null;
    contactId: string | null;
    signalTypes: readonly SignalType[];
    correlationId: string;
    requestKey: string;
  }): Promise<readonly SignalSourceObservation[]>;
}
