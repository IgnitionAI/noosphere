import { expect, test } from "bun:test";
import { filterAuthorizedKnowledgeCitations } from "@outbound/application/knowledge/knowledge-retriever";

test("knowledge citations drop every model-invented claim or source id", () => {
  const claimId = "00000000-0000-4000-8000-000000000301";
  const sourceId = "00000000-0000-4000-8000-000000000302";
  const inventedId = "00000000-0000-4000-8000-000000000399";
  expect(filterAuthorizedKnowledgeCitations([{
    claimId,
    claim: "Déploiement privé",
    offerClaimId: null,
    sources: [{ sourceId, type: "proof", title: "Preuve", excerpt: "Texte", publishedAt: "2026-08-01T00:00:00.000Z", freshnessUntil: "2026-09-01T00:00:00.000Z" }],
  }], [claimId, inventedId], [inventedId, sourceId])).toEqual({ claimIds: [claimId], sourceIds: [sourceId] });
});
