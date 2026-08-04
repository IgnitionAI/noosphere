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

export interface CompanyProspectSource {
  searchCompanies(input: {
    readonly channel: "email" | "whatsapp";
    readonly query: string;
    readonly sourceKinds: readonly string[];
    readonly limit: number | null;
    readonly correlationId: string;
  }): Promise<readonly CompanyProspectCandidate[]>;
}
