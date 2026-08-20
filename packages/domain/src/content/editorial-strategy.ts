export interface EditorialStrategySnapshot {
  readonly audience: {
    readonly name: string;
    readonly summary: string;
    readonly awareness: "unaware" | "problem_aware" | "solution_aware" | "product_aware" | "mixed";
  };
  readonly pillars: readonly {
    readonly name: string;
    readonly promise: string;
    readonly proofTypes: readonly string[];
  }[];
  readonly voice: { readonly traits: readonly string[]; readonly avoid: readonly string[] };
  readonly formats: readonly ("linkedin_text" | "linkedin_document" | "linkedin_image" | "linkedin_video")[];
  readonly cadence: { readonly postsPerWeek: number; readonly preferredDays: readonly number[]; readonly timezone: string };
  readonly callsToAction: readonly string[];
  readonly allowedClaimIds: readonly string[];
  readonly forbiddenTopics: readonly string[];
}

export function assertStrategyClaimsAreAuthorized(
  snapshot: EditorialStrategySnapshot,
  authorizedClaimIds: readonly string[],
): void {
  const authorized = new Set(authorizedClaimIds);
  const invalid = snapshot.allowedClaimIds.filter((id) => !authorized.has(id));
  if (invalid.length > 0) throw new Error("EDITORIAL_STRATEGY_UNAUTHORIZED_CLAIM");
}
