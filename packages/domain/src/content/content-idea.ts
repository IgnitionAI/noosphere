export const contentIdeaStatuses = ["discovered", "shortlisted", "briefed", "discarded", "expired"] as const;
export type ContentIdeaStatus = (typeof contentIdeaStatuses)[number];

export const contentIdeaSourceTypes = ["offer_claim", "knowledge_claim", "conversation_message", "public_web"] as const;
export type ContentIdeaSourceType = (typeof contentIdeaSourceTypes)[number];

export interface ContentIdeaCandidate {
  readonly angle: string;
  readonly rationale: string;
  readonly audience: string;
  readonly pillar: string;
  readonly priority: number;
  readonly freshnessDays: number;
  readonly sourceKeys: readonly string[];
  readonly conceptKey: string;
}

export function assertGroundedIdeaCandidate(candidate: ContentIdeaCandidate, availableSourceKeys: readonly string[]): void {
  const available = new Set(availableSourceKeys);
  if (candidate.sourceKeys.length === 0 || candidate.sourceKeys.some((key) => !available.has(key))) {
    throw new Error("CONTENT_IDEA_UNRESOLVED_SOURCE");
  }
  if (!candidate.angle.trim() || !candidate.rationale.trim() || !candidate.audience.trim() || !candidate.pillar.trim()) {
    throw new Error("CONTENT_IDEA_INCOMPLETE");
  }
  if (!Number.isInteger(candidate.priority) || candidate.priority < 0 || candidate.priority > 100) {
    throw new Error("CONTENT_IDEA_PRIORITY_INVALID");
  }
  if (!Number.isInteger(candidate.freshnessDays) || candidate.freshnessDays < 1 || candidate.freshnessDays > 365) {
    throw new Error("CONTENT_IDEA_FRESHNESS_INVALID");
  }
}

export function normalizeIdeaConcept(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b(?:[a-z]\s+){2,}[a-z]\b/g, (initialism) => initialism.replace(/\s/g, ""))
    .slice(0, 500);
}
