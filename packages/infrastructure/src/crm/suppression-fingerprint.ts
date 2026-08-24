import { createHmac } from "node:crypto";

export function suppressionFingerprint(input: {
  readonly workspaceId: string;
  readonly identityType: string;
  readonly normalizedValue: string;
  readonly secret?: string;
}): string {
  const secret = input.secret
    ?? process.env.SUPPRESSION_HMAC_SECRET
    ?? process.env.BETTER_AUTH_SECRET
    ?? localDevelopmentSecret();
  const workspaceKey = createHmac("sha256", secret)
    .update(`workspace:${input.workspaceId}`)
    .digest();
  return createHmac("sha256", workspaceKey)
    .update(`${input.identityType}:${input.normalizedValue}`)
    .digest("hex");
}

function localDevelopmentSecret(): string {
  if (process.env.NODE_ENV === "production") {
    throw new Error("SUPPRESSION_HMAC_SECRET_OR_BETTER_AUTH_SECRET_REQUIRED");
  }
  return "ignition-outbound-local-suppression-key";
}
