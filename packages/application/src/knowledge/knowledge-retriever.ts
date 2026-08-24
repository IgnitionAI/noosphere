export interface AuthorizedKnowledgeSource {
  readonly sourceId: string;
  readonly type: "product_document" | "proof" | "customer_case" | "objection_response";
  readonly title: string;
  readonly excerpt: string;
  readonly publishedAt: string;
  readonly freshnessUntil: string;
}

export interface AuthorizedKnowledgeClaim {
  readonly claimId: string;
  readonly claim: string;
  readonly offerClaimId: string | null;
  readonly sources: readonly AuthorizedKnowledgeSource[];
}

export interface KnowledgeRetriever {
  search(input: {
    readonly workspaceId: string;
    readonly query: string;
    readonly limit: number;
  }): Promise<readonly AuthorizedKnowledgeClaim[]>;
}

export function filterAuthorizedKnowledgeCitations(
  authorizedKnowledge: readonly AuthorizedKnowledgeClaim[],
  claimedIds: readonly string[],
  sourceIds: readonly string[],
): { claimIds: string[]; sourceIds: string[] } {
  const allowedClaimIds = new Set(authorizedKnowledge.map((claim) => claim.claimId));
  const allowedSourceIds = new Set(authorizedKnowledge.flatMap((claim) => claim.sources.map((source) => source.sourceId)));
  return {
    claimIds: [...new Set(claimedIds)].filter((id) => allowedClaimIds.has(id)),
    sourceIds: [...new Set(sourceIds)].filter((id) => allowedSourceIds.has(id)),
  };
}
