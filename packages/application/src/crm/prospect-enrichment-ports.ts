import type { ProspectChannels } from "@outbound/domain/crm/prospect-channels";

export interface ProspectEnrichmentInput {
  readonly fullName: string;
  readonly companyName: string;
  readonly location: string | null;
  readonly linkedinUrl: string | null;
  readonly channels: ProspectChannels;
  readonly correlationId: string;
  readonly requestKey: string;
}

export interface ProspectEnrichmentEvidence {
  readonly kind: "company_website" | "email" | "phone";
  readonly url: string;
  readonly snippet: string;
  readonly collectedAt: string | null;
}

export interface ProspectEnrichmentResult {
  readonly companyWebsite: string | null;
  readonly companyDomain: string | null;
  readonly channels: ProspectChannels;
  readonly queries: readonly string[];
  readonly evidence: readonly ProspectEnrichmentEvidence[];
}

export interface ProspectEnricher {
  enrich(input: ProspectEnrichmentInput): Promise<ProspectEnrichmentResult>;
}
