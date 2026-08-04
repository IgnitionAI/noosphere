import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

export function encryptCalendarCredential(secret: string, masterKey: string): string {
  if (!secret.trim()) throw new Error("CALENDAR_CREDENTIAL_EMPTY");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(masterKey), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptCalendarCredential(value: string, masterKey: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext, extra] = value.split(".");
  if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext || extra) {
    throw new Error("CALENDAR_CREDENTIAL_FORMAT_INVALID");
  }
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      encryptionKey(masterKey),
      Buffer.from(encodedIv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("CALENDAR_CREDENTIAL_DECRYPTION_FAILED");
  }
}

function encryptionKey(masterKey: string): Buffer {
  if (masterKey.length < 32) throw new Error("CALENDAR_CREDENTIAL_MASTER_KEY_TOO_SHORT");
  return createHash("sha256")
    .update("ignition-outbound:calendar-credential:v1")
    .update(masterKey)
    .digest();
}
