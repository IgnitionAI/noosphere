import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeterministicContentMediaRenderer } from "../../packages/infrastructure/src/content/deterministic-content-media-renderer";
import { DEFAULT_CONTENT_BRAND_KIT } from "../../packages/domain/src/content/content-brand-kit";

// Run inside the exact distributed runtime; ordinary host tests may select another SVG backend.
const expectedUnavailable = process.argv.includes("--expect-unavailable");
try {
  const result = await new DeterministicContentMediaRenderer().render({
    format: "linkedin_image", body: "Un contrôle lisible.", brandKit: DEFAULT_CONTENT_BRAND_KIT,
    outputDirectory: join(tmpdir(), `noosphere-text-canary-${randomUUID()}`),
    plan: { format: "linkedin_image", visualTone: "editorial", title: "Vérifier le texte", subtitle: "Un contrôle lisible.", altText: "Vérifier le texte", slides: [], scenes: [] },
  });
  if (expectedUnavailable) throw new Error("CONTENT_TEXT_CANARY_EXPECTED_REJECTION");
  console.log(JSON.stringify({ status: "rendered", bytes: result.bytes.byteLength }));
} catch (error) {
  if (!expectedUnavailable || !(error instanceof Error) || error.message !== "CONTENT_MEDIA_TEXT_RENDER_UNAVAILABLE") throw error;
  console.log(JSON.stringify({ status: "rejected_missing_glyphs" }));
}
