import { describe, expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { DeterministicContentMediaRenderer } from "@outbound/infrastructure/content/deterministic-content-media-renderer";
import { DEFAULT_CONTENT_BRAND_KIT } from "@outbound/domain/content/content-brand-kit";

describe("DeterministicContentMediaRenderer", () => {
  test("renders a deterministic 4:5 PNG without an external generation provider", async () => {
    const renderer = new DeterministicContentMediaRenderer();
    const result = await renderer.render({
      format: "linkedin_image",
      plan: { format: "linkedin_image", visualTone: "editorial", title: "Une idée doit rester lisible", subtitle: "Le visuel soutient le post au lieu de le recopier.", altText: "Carte éditoriale Noosphere", slides: [], scenes: [] },
      body: "Texte source",
      brandKit: DEFAULT_CONTENT_BRAND_KIT,
      outputDirectory: `/tmp/noosphere-image-test-${crypto.randomUUID()}`,
    });
    const metadata = await sharp(result.bytes).metadata();
    expect(result.mimeType).toBe("image/png");
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1350);
  });

  test("keeps the four image art directions visually distinct", async () => {
    const renderer = new DeterministicContentMediaRenderer();
    const hashes = await Promise.all((["editorial", "technical", "bold", "minimal"] as const).map(async (imageStyle) => {
      const result = await renderer.render({
        format: "linkedin_image",
        plan: { format: "linkedin_image", visualTone: imageStyle, title: "Un signal devient une conversation", subtitle: "Chaque direction doit avoir une composition propre.", altText: "Carte Noosphere", slides: [], scenes: [] },
        body: "Texte source",
        brandKit: { ...DEFAULT_CONTENT_BRAND_KIT, imageStyle },
        outputDirectory: `/tmp/noosphere-image-style-test-${imageStyle}-${crypto.randomUUID()}`,
      });
      return new Bun.CryptoHasher("sha256").update(result.bytes).digest("hex");
    }));
    expect(new Set(hashes).size).toBe(4);
  });

  test("composites the imported logo into a branded image", async () => {
    const logoBytes = await sharp({ create: { width: 180, height: 80, channels: 4, background: "#E11D78" } }).png().toBuffer();
    const renderer = new DeterministicContentMediaRenderer();
    const plain = await renderer.render({
      format: "linkedin_image",
      plan: { format: "linkedin_image", visualTone: "editorial", title: "Une marque cohérente", subtitle: "Sur chaque contenu", altText: "Carte", slides: [], scenes: [] },
      body: "Texte source",
      brandKit: DEFAULT_CONTENT_BRAND_KIT,
      outputDirectory: `/tmp/noosphere-logo-plain-${crypto.randomUUID()}`,
    });
    const branded = await renderer.render({
      format: "linkedin_image",
      plan: { format: "linkedin_image", visualTone: "editorial", title: "Une marque cohérente", subtitle: "Sur chaque contenu", altText: "Carte", slides: [], scenes: [] },
      body: "Texte source",
      brandKit: DEFAULT_CONTENT_BRAND_KIT,
      logoBytes,
      outputDirectory: `/tmp/noosphere-logo-branded-${crypto.randomUUID()}`,
    });
    expect(new Bun.CryptoHasher("sha256").update(branded.bytes).digest("hex")).not.toBe(new Bun.CryptoHasher("sha256").update(plain.bytes).digest("hex"));
    expect(branded.manifest).toMatchObject({ logo: true });
  });

  test("renders a LinkedIn carousel as a multi-page PDF document", async () => {
    const renderer = new DeterministicContentMediaRenderer();
    const result = await renderer.render({
      format: "linkedin_document",
      plan: {
        format: "linkedin_document",
        visualTone: "technical",
        title: "Cinq décisions",
        subtitle: null,
        altText: "Carrousel Noosphere en cinq pages",
        slides: [
          { layout: "cover", kicker: "Guide", title: "Le signal ne suffit pas", body: "Il faut relier chaque observation à une décision.", callout: null, items: [] },
          { layout: "insight", kicker: "Constat", title: "Partir du problème", body: "Observer avant de proposer.", callout: "Un signal sans contexte reste du bruit.", items: [] },
          { layout: "comparison", kicker: "Arbitrage", title: "Deux façons d'agir", body: "Comparer les options.", callout: null, items: [{ label: "Sans preuve", text: "Décider au ressenti." }, { label: "Avec preuve", text: "Décider avec le contexte." }] },
          { layout: "process", kicker: "Méthode", title: "Passer à l'action", body: "Trois étapes simples.", callout: null, items: [{ label: "Observer", text: "Collecter le signal." }, { label: "Vérifier", text: "Résoudre la source." }, { label: "Agir", text: "Décider avec contexte." }] },
          { layout: "closing", kicker: null, title: "La décision devient traçable", body: "Le contexte reste attaché à l'action.", callout: "Quelle décision voulez-vous mieux documenter ?", items: [] },
        ],
        scenes: [],
      },
      body: "Texte source",
      brandKit: DEFAULT_CONTENT_BRAND_KIT,
      outputDirectory: `/tmp/noosphere-document-test-${crypto.randomUUID()}`,
    });
    const document = await PDFDocument.load(result.bytes);
    expect(result.mimeType).toBe("application/pdf");
    expect(document.getPageCount()).toBe(5);
    expect(result.pageCount).toBe(5);
    expect(result.manifest).toEqual(expect.objectContaining({ renderer: "pdf-lib-sharp-v4", narrativeLayouts: ["cover", "insight", "comparison", "process", "closing"] }));
  });

  const ffmpeg = Bun.which("ffmpeg");
  (ffmpeg ? test : test.skip)("renders a native H.264 motion video when FFmpeg is installed", async () => {
    const renderer = new DeterministicContentMediaRenderer(ffmpeg!);
    const result = await renderer.render({
      format: "linkedin_video",
      plan: { format: "linkedin_video", visualTone: "bold", title: "Une preuve, trois décisions", subtitle: null, altText: "Vidéo Noosphere en trois scènes", slides: [], scenes: [{ title: "Observer", body: "Partir du signal réel.", durationSeconds: 4 }, { title: "Vérifier", body: "Relier chaque fait à sa preuve.", durationSeconds: 4 }, { title: "Agir", body: "Publier avec un contexte durable.", durationSeconds: 4 }] },
      body: "Texte source",
      brandKit: DEFAULT_CONTENT_BRAND_KIT,
      outputDirectory: `/tmp/noosphere-video-test-${crypto.randomUUID()}`,
    });
    expect(result.mimeType).toBe("video/mp4");
    expect(result.durationSeconds).toBe(12);
    expect(new TextDecoder().decode(result.bytes.slice(4, 8))).toBe("ftyp");
    expect(result.bytes.byteLength).toBeGreaterThan(10_000);
  }, 30_000);
});
