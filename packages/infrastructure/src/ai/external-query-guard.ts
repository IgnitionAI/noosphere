import type { ExternalQueryGuard } from "@outbound/application/gtm/product-research-ports";

const SECRET_PATTERNS = [
  /\bsk-[a-z0-9_-]{16,}\b/i,
  /\bbearer\s+[a-z0-9._~+/=-]{16,}\b/i,
  /\b(?:api[_ -]?key|client[_ -]?secret|password)\s*[:=]\s*\S{8,}/i,
  /\b(?:internal|private)[_ -]?canary\b/i,
];

export class DefaultExternalQueryGuard implements ExternalQueryGuard {
  async authorize(input: {
    channel: "web" | "unipile";
    payload: Readonly<Record<string, unknown>>;
    sensitiveTerms: readonly string[];
  }): Promise<{ allowed: true } | { allowed: false; reason: string }> {
    const serialized = JSON.stringify(input.payload).toLowerCase();
    if (SECRET_PATTERNS.some((pattern) => pattern.test(serialized))) {
      return { allowed: false, reason: "SECRET_PATTERN_DETECTED" };
    }
    const leaked = input.sensitiveTerms.some((term) =>
      term.length >= 8 && serialized.includes(term.toLowerCase()),
    );
    return leaked
      ? { allowed: false, reason: "INTERNAL_DOCUMENT_TERM_DETECTED" }
      : { allowed: true };
  }
}
