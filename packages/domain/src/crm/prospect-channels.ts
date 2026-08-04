export type ProspectChannelStatus =
  | "verified"
  | "found"
  | "unverified"
  | "unavailable";

export type ProspectChannelConfidence = "high" | "medium" | "low" | "none";

export interface ProspectChannel {
  readonly value: string | null;
  readonly normalizedValue: string | null;
  readonly status: ProspectChannelStatus;
  readonly confidence: ProspectChannelConfidence;
  readonly source: string | null;
  readonly evidenceUrl?: string | null;
  readonly evidenceSnippet?: string | null;
  readonly observedAt?: string | null;
}

export interface ProspectChannels {
  readonly linkedin: ProspectChannel;
  readonly email: ProspectChannel;
  readonly whatsapp: ProspectChannel;
}

export function unavailableProspectChannel(): ProspectChannel {
  return {
    value: null,
    normalizedValue: null,
    status: "unavailable",
    confidence: "none",
    source: null,
  };
}

export function emptyProspectChannels(): ProspectChannels {
  return {
    linkedin: unavailableProspectChannel(),
    email: unavailableProspectChannel(),
    whatsapp: unavailableProspectChannel(),
  };
}
