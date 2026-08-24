import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { DeterministicContentMediaRenderer } from "@outbound/infrastructure/content/deterministic-content-media-renderer";
import { S3ContentMediaStorage } from "@outbound/infrastructure/content/s3-content-media-storage";
import { DEFAULT_CONTENT_BRAND_KIT } from "@outbound/domain/content/content-brand-kit";

const root = await mkdtemp(join(tmpdir(), "noosphere-media-canary-"));
const renderer = new DeterministicContentMediaRenderer(process.env.FFMPEG_BINARY?.trim() || "ffmpeg");

try {
  const image = await renderer.render({
    format: "linkedin_image",
    plan: {
      format: "linkedin_image",
      visualTone: "editorial",
      title: "Une preuve visible",
      subtitle: "Noosphere relie contenu et demande.",
      altText: "Carte de validation Noosphere",
      slides: [],
      scenes: [],
    },
    body: "Noosphere relie contenu et demande.",
    brandKit: DEFAULT_CONTENT_BRAND_KIT,
    outputDirectory: join(root, "image"),
  });
  const imageMetadata = await sharp(image.bytes).metadata();
  if (imageMetadata.width !== 1080 || imageMetadata.height !== 1350 || imageMetadata.format !== "png") {
    throw new Error("CONTENT_MEDIA_CANARY_IMAGE_INVALID");
  }

  const document = await renderer.render({
    format: "linkedin_document",
    plan: {
      format: "linkedin_document",
      visualTone: "technical",
      title: "Trois preuves",
      subtitle: null,
      altText: "Carrousel de validation Noosphere",
      slides: [
        { title: "Observer", body: "Partir des faits." },
        { title: "Comprendre", body: "Relier le signal au problème." },
        { title: "Agir", body: "Publier une réponse utile." },
      ],
      scenes: [],
    },
    body: "Trois preuves.",
    brandKit: DEFAULT_CONTENT_BRAND_KIT,
    outputDirectory: join(root, "document"),
  });
  if ((await PDFDocument.load(document.bytes)).getPageCount() !== 3) throw new Error("CONTENT_MEDIA_CANARY_DOCUMENT_INVALID");

  const video = await renderer.render({
    format: "linkedin_video",
    plan: {
      format: "linkedin_video",
      visualTone: "bold",
      title: "Une idée en mouvement",
      subtitle: null,
      altText: "Vidéo de validation Noosphere",
      slides: [],
      scenes: [
        { title: "Observer", body: "Le signal existe.", durationSeconds: 4 },
        { title: "Comprendre", body: "Le signal devient idée.", durationSeconds: 4 },
        { title: "Agir", body: "L'idée devient demande.", durationSeconds: 4 },
      ],
    },
    body: "Une idée en mouvement.",
    brandKit: DEFAULT_CONTENT_BRAND_KIT,
    outputDirectory: join(root, "video"),
  });
  if (video.bytes.byteLength < 1_000 || new TextDecoder().decode(video.bytes.slice(4, 8)) !== "ftyp") {
    throw new Error("CONTENT_MEDIA_CANARY_VIDEO_INVALID");
  }

  const storageVerified = await verifyStorageWhenConfigured(image.bytes);
  console.info(JSON.stringify({
    event: "content_media_runtime_verified",
    image: { width: image.width, height: image.height, bytes: image.bytes.byteLength },
    document: { pages: document.pageCount, bytes: document.bytes.byteLength },
    video: { durationSeconds: video.durationSeconds, bytes: video.bytes.byteLength },
    storage: storageVerified ? "verified" : "skipped",
  }));
} finally {
  await rm(root, { recursive: true, force: true });
}

async function verifyStorageWhenConfigured(bytes: Uint8Array): Promise<boolean> {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  if (!endpoint) return false;
  const storage = new S3ContentMediaStorage({
    endpoint,
    region: requiredEnvironment("S3_REGION"),
    bucket: requiredEnvironment("S3_BUCKET"),
    accessKeyId: requiredEnvironment("S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment("S3_SECRET_ACCESS_KEY"),
  });
  const objectKey = "system-canary/content-media-runtime.png";
  await storage.put({ objectKey, body: bytes, contentType: "image/png" });
  const retained = await storage.get({ objectKey, maxBytes: 5 * 1024 * 1024 });
  const expected = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const actual = new Bun.CryptoHasher("sha256").update(retained).digest("hex");
  if (expected !== actual) throw new Error("CONTENT_MEDIA_CANARY_STORAGE_INVALID");
  return true;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when S3_ENDPOINT is configured`);
  return value;
}
