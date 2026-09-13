import { contentClaimOccurrences, contentPublicFields, type ContentDraftSnapshot } from "@outbound/domain/content/content-asset";

/** Exact current occurrences, including repeated wording with a different local context. */
export function contentAuditDeclarations(draft: ContentDraftSnapshot) {
  const fields = contentPublicFields(draft);
  const declarations: { id: string; field: string; start: number; statement: string; claimedSourceKeys: readonly string[] }[] = [];
  for (const [claimIndex, claim] of draft.factualClaims.entries()) {
    let located = false;
    for (const [fieldIndex, field] of fields.entries()) {
      for (const {start, statement} of contentClaimOccurrences(field.text, claim.statement)) {
        located = true;
        const existing = declarations.find(item => item.field === field.field && item.start === start && item.statement === statement);
        if (existing) existing.claimedSourceKeys = [...new Set([...existing.claimedSourceKeys, ...claim.sourceKeys])];
        else declarations.push({ id: `c${claimIndex}_f${fieldIndex}_o${start}`, field: field.field, start, statement, claimedSourceKeys: claim.sourceKeys });
        if (declarations.length > 200) throw new Error("CONTENT_AUDIT_CAPACITY_EXCEEDED");
      }
    }
    if (!located) throw new Error("CONTENT_AUDIT_DECLARATION_NOT_LOCATED");
  }
  return declarations;
}
