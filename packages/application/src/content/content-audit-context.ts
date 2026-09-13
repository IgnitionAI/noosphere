import { createHash } from "node:crypto";

/** Match the auditor's key-first source representation, including the actual evidence text. */
export function contentAuditEvidenceFingerprint(evidence: readonly { readonly key: string }[]): string {
  return createHash("sha256").update(JSON.stringify(evidence.map(({key, ...source}) => ({key, ...source})))).digest("hex");
}
