export interface EmailVerificationResult {
  readonly status: "verified" | "invalid";
  readonly confidence: "high" | "medium" | "low";
  readonly source: string;
  readonly evidenceUrl?: string | null;
  readonly evidenceSnippet?: string | null;
}

export interface EmailVerifier {
  verify(input: {
    email: string;
    workspaceId: string;
    correlationId: string;
  }): Promise<EmailVerificationResult>;
}

/** Free V1 verifier: syntax is checked locally; delivery providers remain behind this port. */
export class SyntaxEmailVerifier implements EmailVerifier {
  async verify(input: { email: string }): Promise<EmailVerificationResult> {
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim());
    return {
      status: valid ? "verified" : "invalid",
      confidence: valid ? "low" : "high",
      source: "syntax",
      evidenceSnippet: valid ? "Adresse conforme à la syntaxe email." : "Adresse email invalide.",
    };
  }
}

