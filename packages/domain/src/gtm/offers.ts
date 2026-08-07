export type OfferClaimValidationStatus = "hypothesis" | "sourced" | "validated" | "invalidated";

export interface OfferClaimDraft {
  readonly claim: string;
  readonly validationStatus: OfferClaimValidationStatus;
  readonly evidenceUri: string | null;
}

export interface OfferDraft {
  readonly name: string;
  readonly category: string;
  readonly valueProposition: string;
  readonly targetAudience: string;
  readonly pricing: unknown;
  readonly commercialRules: unknown;
  readonly constraints: unknown;
  readonly claims: readonly OfferClaimDraft[];
  readonly objections: unknown;
}

export function validateOfferForPublication(draft: OfferDraft): string[] {
  const missing: string[] = [];
  if (!draft.name.trim()) missing.push("name");
  if (!draft.valueProposition.trim()) missing.push("valueProposition");
  if (!draft.claims.length) missing.push("claims");
  if (draft.claims.some((claim) => claim.validationStatus === "invalidated")) {
    missing.push("claims.invalidated");
  }
  return missing;
}

export function hasOfferDraftChanged(draft: OfferDraft, version: OfferDraft): boolean {
  return JSON.stringify(draft) !== JSON.stringify(version);
}
