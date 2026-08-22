import sharp from "sharp";
import type { ContentBrandLogoProcessor } from "@outbound/application/content/content-brand-kit";
import { contentBrandPaletteIssues } from "@outbound/domain/content/content-brand-kit";

const MAX_DIMENSION = 1_024;
const SAMPLE_SIZE = 64;

export class SharpContentBrandLogoProcessor implements ContentBrandLogoProcessor {
  async normalize(input: Parameters<ContentBrandLogoProcessor["normalize"]>[0]) {
    const source = sharp(input.bytes, { failOn: "error", limitInputPixels: 16_777_216 });
    const metadata = await source.metadata();
    if (!["png", "jpeg", "webp"].includes(metadata.format ?? "")) throw new Error("CONTENT_BRAND_LOGO_TYPE_INVALID");
    if (!metadata.width || !metadata.height) throw new Error("CONTENT_BRAND_LOGO_DIMENSIONS_INVALID");

    const bytes = new Uint8Array(await sharp(input.bytes, { failOn: "error", limitInputPixels: 16_777_216 })
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer());
    const normalizedMetadata = await sharp(bytes).metadata();
    const previewBytes = await sharp(bytes)
      .resize({ width: 128, height: 128, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const { data, info } = await sharp(bytes)
      .resize({ width: SAMPLE_SIZE, height: SAMPLE_SIZE, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return {
      bytes,
      width: normalizedMetadata.width!,
      height: normalizedMetadata.height!,
      previewDataUrl: `data:image/png;base64,${previewBytes.toString("base64")}`,
      colors: extractPalette(data, info.channels),
    };
  }
}

function extractPalette(data: Buffer, channels: number) {
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let offset = 0; offset < data.length; offset += channels) {
    const alpha = channels > 3 ? data[offset + 3]! : 255;
    if (alpha < 96) continue;
    const r = data[offset]!;
    const g = data[offset + 1]!;
    const b = data[offset + 2]!;
    const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
    if (lightness > 0.96 || lightness < 0.04) continue;
    const qr = Math.round(r / 32) * 32;
    const qg = Math.round(g / 32) * 32;
    const qb = Math.round(b / 32) * 32;
    const key = `${qr},${qg},${qb}`;
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const candidates = [...buckets.values()].map((bucket) => {
    const r = Math.round(bucket.r / bucket.count);
    const g = Math.round(bucket.g / bucket.count);
    const b = Math.round(bucket.b / bucket.count);
    const { saturation, lightness } = colorProperties(r, g, b);
    return { r, g, b, count: bucket.count, saturation, lightness };
  });
  if (!candidates.length) return { primary: "#07133F", accent: "#C8F85A", background: "#F7F8F4", text: "#07133F" };
  const primary = [...candidates].sort((left, right) => {
    const leftScore = left.count * (0.55 + left.saturation) * (1.25 - left.lightness);
    const rightScore = right.count * (0.55 + right.saturation) * (1.25 - right.lightness);
    return rightScore - leftScore;
  })[0]!;
  const accent = [...candidates].sort((left, right) => {
    const distance = colorDistance(left, primary);
    const leftScore = left.count * (0.35 + left.saturation * 2) * (0.5 + distance);
    const rightDistance = colorDistance(right, primary);
    const rightScore = right.count * (0.35 + right.saturation * 2) * (0.5 + rightDistance);
    return rightScore - leftScore;
  })[0]!;
  const primaryHex = toHex(primary.r, primary.g, primary.b);
  const accentHex = colorDistance(accent, primary) < 0.12 ? "#C8F85A" : toHex(accent.r, accent.g, accent.b);
  const detected = { primary: primaryHex, accent: accentHex, background: "#F7F8F4", text: primaryHex };
  if (contentBrandPaletteIssues(detected).length === 0) return detected;
  const accessiblePrimary = contentBrandPaletteIssues({ ...detected, primary: primaryHex, text: primaryHex })
    .some((issue) => issue.includes("primary") || issue.includes("text")) ? "#07133F" : primaryHex;
  const withPrimary = { ...detected, primary: accessiblePrimary, text: accessiblePrimary };
  return contentBrandPaletteIssues(withPrimary).some((issue) => issue.includes("accent"))
    ? { ...withPrimary, accent: "#C8F85A" }
    : withPrimary;
}

function colorProperties(r: number, g: number, b: number) {
  const high = Math.max(r, g, b) / 255;
  const low = Math.min(r, g, b) / 255;
  const lightness = (high + low) / 2;
  const saturation = high === low ? 0 : (high - low) / (1 - Math.abs(2 * lightness - 1));
  return { saturation, lightness };
}

function colorDistance(left: { r: number; g: number; b: number }, right: { r: number; g: number; b: number }) {
  return Math.sqrt((left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2) / Math.sqrt(3 * 255 ** 2);
}

function toHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
