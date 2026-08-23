import type { ContentHasher } from "@outbound/application/shared/ports";

export class Sha256ContentHasher implements ContentHasher {
  async hash(value: unknown): Promise<string> {
    // This service runs on Bun. CryptoHasher avoids scheduling one WebCrypto
    // promise per source event while preserving the exact SHA-256 contract.
    // That matters for Prospect 360 contexts where a bounded delta can contain
    // up to 200 immutable events and many contexts are assembled concurrently.
    return new Bun.CryptoHasher("sha256")
      .update(stableStringify(value))
      .digest("hex");
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
