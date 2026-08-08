import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(): Buffer {
  const value = process.env.APP_ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET;
  if (!value) throw new Error("APP_ENCRYPTION_KEY is required");
  return createHash("sha256").update(value).digest();
}

/** AES-256-GCM envelope. The returned value never contains the plaintext. */
export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptSecret(envelope: string): string {
  const [ivEncoded, tagEncoded, ciphertextEncoded] = envelope.split(".");
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) throw new Error("INVALID_SECRET_ENVELOPE");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivEncoded, "base64url"));
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
