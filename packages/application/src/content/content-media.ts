import type { ContentBrandKitSnapshot, LinkedinContentFormat } from "@outbound/domain/content/content-brand-kit";
import type { ContentDraftSnapshot, ContentMediaPlan } from "@outbound/domain/content/content-asset";

export type ContentMediaKind = "image" | "document" | "video";

export interface StoredContentMedia {
  readonly id: string;
  readonly kind: ContentMediaKind;
  readonly objectKey: string;
  readonly mimeType: "image/png" | "application/pdf" | "video/mp4";
  readonly filename: string;
  readonly checksumSha256: string;
  readonly sizeBytes: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly pageCount: number | null;
  readonly durationSeconds: number | null;
  readonly altText: string;
  readonly renderManifest: Record<string, unknown>;
  readonly provenance: {
    readonly provider: "deterministic" | "generative";
    readonly model: string | null;
    readonly promptVersion: string | null;
  };
}

export interface ContentMediaAttachment extends StoredContentMedia {
  readonly content: Uint8Array;
}

export interface ContentMediaObjectStorage {
  put(input: { readonly objectKey: string; readonly body: Uint8Array; readonly contentType: string }): Promise<void>;
  get(input: { readonly objectKey: string; readonly maxBytes: number }): Promise<Uint8Array>;
}

export interface ContentMediaRenderer {
  render(input: {
    readonly format: Exclude<LinkedinContentFormat, "linkedin_text">;
    readonly plan: ContentMediaPlan;
    readonly body: string;
    readonly brandKit: ContentBrandKitSnapshot;
    readonly logoBytes?: Uint8Array;
    readonly outputDirectory: string;
  }): Promise<{
    readonly bytes: Uint8Array;
    readonly mimeType: StoredContentMedia["mimeType"];
    readonly filename: string;
    readonly width: number | null;
    readonly height: number | null;
    readonly pageCount: number | null;
    readonly durationSeconds: number | null;
    readonly manifest: Record<string, unknown>;
  }>;
}

export interface GenerativeVideoProvider {
  readonly name: string;
  available(): boolean;
  generate(input: {
    readonly plan: ContentMediaPlan;
    readonly brandKit: ContentBrandKitSnapshot;
    readonly outputDirectory: string;
  }): Promise<{
    readonly bytes: Uint8Array;
    readonly model: string;
    readonly promptVersion: string;
  }>;
}

export class ContentMediaProducer {
  constructor(
    private readonly storage: ContentMediaObjectStorage,
    private readonly renderer: ContentMediaRenderer,
    private readonly generativeVideo?: GenerativeVideoProvider,
    private readonly temporaryRoot = "/tmp",
  ) {}

  async produce(input: {
    readonly workspaceId: string;
    readonly runId: string;
    readonly format: LinkedinContentFormat;
    readonly draft: ContentDraftSnapshot;
    readonly brandKit: ContentBrandKitSnapshot;
  }): Promise<StoredContentMedia | null> {
    if (input.format === "linkedin_text") return null;
    const plan = input.draft.mediaPlan;
    if (!plan || plan.format !== input.format || !plan.altText) throw new Error("CONTENT_MEDIA_PLAN_INVALID");
    const id = crypto.randomUUID();
    const outputDirectory = `${this.temporaryRoot.replace(/\/+$/, "")}/noosphere-media-${input.runId}`;
    let rendered: Awaited<ReturnType<ContentMediaRenderer["render"]>>;
    let provenance: StoredContentMedia["provenance"] = { provider: "deterministic", model: null, promptVersion: "noosphere-media-render-v1" };
    if (input.format === "linkedin_video" && input.brandKit.videoMode === "generative") {
      if (!this.generativeVideo?.available()) throw new Error("CONTENT_GENERATIVE_VIDEO_UNAVAILABLE");
      const generated = await this.generativeVideo.generate({ plan, brandKit: input.brandKit, outputDirectory });
      rendered = {
        bytes: generated.bytes,
        mimeType: "video/mp4",
        filename: "linkedin-video.mp4",
        width: 1080,
        height: 1350,
        pageCount: null,
        durationSeconds: plan.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0),
        manifest: { renderer: "generative-video-v1", scenes: plan.scenes.length },
      };
      provenance = { provider: "generative", model: generated.model, promptVersion: generated.promptVersion };
    } else {
      const logoBytes = input.brandKit.logo
        ? await this.storage.get({ objectKey: input.brandKit.logo.objectKey, maxBytes: 5 * 1024 * 1024 })
        : undefined;
      rendered = await this.renderer.render({
        format: input.format,
        plan,
        body: input.draft.body,
        brandKit: input.brandKit,
        ...(logoBytes ? { logoBytes } : {}),
        outputDirectory,
      });
    }
    if (rendered.bytes.byteLength < 1 || rendered.bytes.byteLength > 100 * 1024 * 1024) throw new Error("CONTENT_MEDIA_SIZE_INVALID");
    const checksumSha256 = new Bun.CryptoHasher("sha256").update(rendered.bytes).digest("hex");
    const extension = rendered.mimeType === "image/png" ? "png" : rendered.mimeType === "application/pdf" ? "pdf" : "mp4";
    const objectKey = `${input.workspaceId}/content-media/${input.runId}/${checksumSha256}.${extension}`;
    await this.storage.put({ objectKey, body: rendered.bytes, contentType: rendered.mimeType });
    return {
      id,
      kind: input.format === "linkedin_image" ? "image" : input.format === "linkedin_document" ? "document" : "video",
      objectKey,
      mimeType: rendered.mimeType,
      filename: rendered.filename,
      checksumSha256,
      sizeBytes: rendered.bytes.byteLength,
      width: rendered.width,
      height: rendered.height,
      pageCount: rendered.pageCount,
      durationSeconds: rendered.durationSeconds,
      altText: plan.altText,
      renderManifest: rendered.manifest,
      provenance,
    };
  }
}

export function mediaKindForFormat(format: LinkedinContentFormat): ContentMediaKind | null {
  return format === "linkedin_text" ? null : format === "linkedin_image" ? "image" : format === "linkedin_document" ? "document" : "video";
}
