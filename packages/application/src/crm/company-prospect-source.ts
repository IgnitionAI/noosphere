import type { ProspectChannels } from "@outbound/domain/crm/prospect-channels";

export interface CompanyProspectCandidate {
  readonly fullName: string;
  readonly companyName: string;
  readonly companyWebsite: string;
  readonly companyDomain: string;
  readonly location: string | null;
  readonly channels: ProspectChannels;
  readonly providerData: Readonly<Record<string, unknown>>;
}

export interface CompanyPhoneObservation {
  readonly rawValue: string;
  readonly e164: string | null;
  readonly endpointKind: "person" | "company";
  readonly companyName: string;
  readonly companyDomain: string;
  readonly personName: string | null;
  readonly personRole: string | null;
  readonly attributionStatus: "strong" | "weak" | "conflict" | "rejected";
  readonly attributionReason: string;
  readonly rejectionReason: string | null;
  readonly sourceKind: string;
  readonly sourceUrl: string;
  readonly evidenceSnippet: string;
  readonly contentHash: string | null;
  readonly observedAt: string | null;
  readonly reachabilityStatus: "verified" | "not_registered" | "unknown";
  readonly providerAccountId: string | null;
  readonly reachabilityCheckedAt: string | null;
  readonly reachabilityExpiresAt: string | null;
}

export interface CompanyProspectSearchResult {
  readonly candidates: readonly CompanyProspectCandidate[];
  readonly observations: readonly CompanyPhoneObservation[];
  readonly metrics: {
    readonly searchResultCount: number;
    readonly pageAttemptCount: number;
    readonly rawPhoneCount: number;
    readonly admissiblePhoneCount: number;
    readonly verificationAttemptCount: number;
    readonly verifiedPhoneCount: number;
  };
}

export interface CompanyProspectSource {
  searchCompanies(input: {
    readonly workspaceId: string;
    readonly channel: "email" | "whatsapp";
    readonly query: string;
    readonly sourceKinds: readonly string[];
    readonly limit: number | null;
    readonly correlationId: string;
    readonly sourcingCycleId?: string | null;
    readonly sourcingFrontierId?: string | null;
  }): Promise<CompanyProspectSearchResult>;
}
