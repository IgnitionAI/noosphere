import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { SharpContentBrandLogoProcessor } from "@outbound/infrastructure/content/sharp-content-brand-logo-processor";

describe("SharpContentBrandLogoProcessor", () => {
  test("normalizes a raster logo and extracts a reusable palette", async () => {
    const source = await sharp({ create: { width: 800, height: 400, channels: 4, background: "#182A78" } })
      .composite([{ input: Buffer.from('<svg width="300" height="300"><rect width="300" height="300" fill="#E11D78"/></svg>'), left: 450, top: 50 }])
      .png()
      .toBuffer();
    const result = await new SharpContentBrandLogoProcessor().normalize({ bytes: source, mimeType: "image/png" });
    const metadata = await sharp(result.bytes).metadata();
    expect(metadata.format).toBe("png");
    expect(result.width).toBeLessThanOrEqual(1_024);
    expect(result.height).toBeLessThanOrEqual(1_024);
    expect(result.previewDataUrl).toStartWith("data:image/png;base64,");
    expect(result.colors.primary).toMatch(/^#[0-9A-F]{6}$/);
    expect(result.colors.accent).toMatch(/^#[0-9A-F]{6}$/);
    expect(result.colors.primary).not.toBe(result.colors.accent);
  });

  test("rejects unsupported image payloads", async () => {
    await expect(new SharpContentBrandLogoProcessor().normalize({ bytes: new TextEncoder().encode("not an image"), mimeType: "image/png" })).rejects.toThrow();
  });
});
