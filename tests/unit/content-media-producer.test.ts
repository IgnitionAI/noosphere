import { describe, expect, test } from "bun:test";
import { ContentMediaProducer } from "@outbound/application/content/content-media";
import { DEFAULT_CONTENT_BRAND_KIT } from "@outbound/domain/content/content-brand-kit";

describe("Noosphere content media producer", () => {
  test("stores a deterministic image under a tenant-scoped immutable checksum key", async () => {
    const renderedBytes = new TextEncoder().encode("deterministic-png-fixture");
    const writes: unknown[] = [];
    const producer = new ContentMediaProducer(
      {
        async put(input) { writes.push(input); },
        async get() { throw new Error("must not read"); },
      },
      {
        async render(input) {
          expect(input).toMatchObject({
            format: "linkedin_image",
            outputDirectory: "/tmp/noosphere-test/noosphere-media-run-fixture",
            brandKit: { brandName: "Noosphere" },
          });
          return {
            bytes: renderedBytes,
            mimeType: "image/png",
            filename: "linkedin-image.png",
            width: 1080,
            height: 1350,
            pageCount: 1,
            durationSeconds: null,
            manifest: { renderer: "fixture" },
          };
        },
      },
      undefined,
      "/tmp/noosphere-test",
    );

    const media = await producer.produce({
      workspaceId: "workspace-fixture",
      runId: "run-fixture",
      format: "linkedin_image",
      draft: imageDraft(),
      brandKit: DEFAULT_CONTENT_BRAND_KIT,
    });

    const checksum = new Bun.CryptoHasher("sha256").update(renderedBytes).digest("hex");
    expect(media).toMatchObject({
      kind: "image",
      objectKey: `workspace-fixture/content-media/run-fixture/${checksum}.png`,
      checksumSha256: checksum,
      sizeBytes: renderedBytes.byteLength,
      provenance: { provider: "deterministic", model: null, promptVersion: "noosphere-media-render-v1" },
    });
    expect(writes).toEqual([{
      objectKey: `workspace-fixture/content-media/run-fixture/${checksum}.png`,
      body: renderedBytes,
      contentType: "image/png",
    }]);
  });

  test("keeps text posts storage-free and fails closed when generative video is not configured", async () => {
    let writes = 0;
    let renders = 0;
    const producer = new ContentMediaProducer(
      {
        async put() { writes += 1; },
        async get() { throw new Error("must not read"); },
      },
      {
        async render() {
          renders += 1;
          throw new Error("must not render");
        },
      },
    );

    expect(await producer.produce({
      workspaceId: "workspace-fixture",
      runId: "text-run",
      format: "linkedin_text",
      draft: {
        hook: "Un texte",
        body: "Un texte",
        callToAction: null,
        factualClaims: [],
        opinionStatements: ["Un texte"],
      },
      brandKit: DEFAULT_CONTENT_BRAND_KIT,
    })).toBeNull();
    await expect(producer.produce({
      workspaceId: "workspace-fixture",
      runId: "video-run",
      format: "linkedin_video",
      draft: videoDraft(),
      brandKit: { ...DEFAULT_CONTENT_BRAND_KIT, videoMode: "generative" },
    })).rejects.toThrow("CONTENT_GENERATIVE_VIDEO_UNAVAILABLE");
    expect(writes).toBe(0);
    expect(renders).toBe(0);
  });

  test("loads the active workspace logo before rendering branded media", async () => {
    const logo = new Uint8Array([7, 8, 9]);
    const producer = new ContentMediaProducer({
      async put() {},
      async get(input) {
        expect(input.objectKey).toStartWith("workspace-fixture/brand-assets/");
        return logo;
      },
    }, {
      async render(input) {
        expect(input.logoBytes).toEqual(logo);
        return { bytes: new Uint8Array([1]), mimeType: "image/png", filename: "image.png", width: 1080, height: 1350, pageCount: 1, durationSeconds: null, manifest: {} };
      },
    });
    const checksum = "a".repeat(64);
    await producer.produce({
      workspaceId: "workspace-fixture",
      runId: "brand-run",
      format: "linkedin_image",
      draft: imageDraft(),
      brandKit: { ...DEFAULT_CONTENT_BRAND_KIT, logo: { objectKey: `workspace-fixture/brand-assets/${checksum}.png`, mimeType: "image/png", checksumSha256: checksum, width: 120, height: 80, previewDataUrl: "data:image/png;base64,AQID", sourceFileName: "logo.png" } },
    });
  });
});

function imageDraft() {
  return {
    hook: "Une idée forte",
    body: "Une idée forte mérite une preuve visuelle.",
    callToAction: null,
    factualClaims: [],
    opinionStatements: ["Une idée forte mérite une preuve visuelle."],
    mediaPlan: {
      format: "linkedin_image" as const,
      visualTone: "editorial" as const,
      title: "Une idée forte",
      subtitle: "Une preuve visuelle",
      altText: "Carte Noosphere présentant une idée forte",
      slides: [],
      scenes: [],
    },
  };
}

function videoDraft() {
  return {
    ...imageDraft(),
    mediaPlan: {
      format: "linkedin_video" as const,
      visualTone: "bold" as const,
      title: "Une idée en mouvement",
      subtitle: null,
      altText: "Vidéo Noosphere présentant une idée",
      slides: [],
      scenes: [
        { title: "Le problème", body: "Le signal est dispersé.", durationSeconds: 4 },
        { title: "La bascule", body: "Le signal devient action.", durationSeconds: 4 },
        { title: "Le résultat", body: "La demande devient mesurable.", durationSeconds: 4 },
      ],
    },
  };
}
