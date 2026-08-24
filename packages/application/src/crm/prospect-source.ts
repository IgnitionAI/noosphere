export interface ProspectSearchFilters {
  readonly api: "classic" | "sales_navigator" | "recruiter";
  readonly category: "people";
  readonly keywords: string;
  readonly limit: number;
}

export interface ProspectSourceCandidate {
  readonly fullName: string;
  readonly headline: string | null;
  readonly linkedinUrl: string | null;
  readonly location: string | null;
  readonly companyName: string | null;
  readonly providerData: Readonly<Record<string, unknown>>;
}

export interface ProspectSource {
  searchPeople(filters: ProspectSearchFilters): Promise<readonly ProspectSourceCandidate[]>;
}

export class ProviderUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}
