import type { ContentBrandKitSnapshot, ContentBrandPaletteContrast } from "@outbound/domain/content/content-brand-kit";
import { assertContentBrandKit, contentBrandPaletteContrast, DEFAULT_CONTENT_BRAND_KIT } from "@outbound/domain/content/content-brand-kit";

export interface ContentBrandKitView {
  readonly workspaceId: string;
  readonly version: number;
  readonly snapshot: ContentBrandKitSnapshot;
  readonly updatedAt: Date | null;
}

export interface ContentBrandKitRepository {
  find(workspaceId: string): Promise<ContentBrandKitView | null>;
  findRequest(input: { readonly workspaceId: string; readonly requestKey: string }): Promise<ContentBrandKitView | null>;
  save(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly requestKey: string;
    readonly snapshot: ContentBrandKitSnapshot;
    readonly now: Date;
  }): Promise<ContentBrandKitView>;
}

export type ContentBrandKitReader = Pick<ContentBrandKitRepository, "find">;

export interface ContentBrandLogoProcessor {
  normalize(input: {
    readonly bytes: Uint8Array;
    readonly mimeType: "image/png" | "image/jpeg" | "image/webp";
  }): Promise<{
    readonly bytes: Uint8Array;
    readonly width: number;
    readonly height: number;
    readonly previewDataUrl: string;
    readonly colors: ContentBrandKitSnapshot["colors"];
  }>;
}

export interface ContentBrandAssetStorage {
  put(input: { readonly objectKey: string; readonly body: Uint8Array; readonly contentType: "image/png" }): Promise<void>;
}

export interface ContentBrandLandingPage {
  readonly url: string;
  readonly title: string | null;
  readonly markdown: string;
  readonly collectedAt: string | null;
}

export interface ContentBrandLandingPageReader {
  read(input: { readonly url: string; readonly correlationId: string }): Promise<ContentBrandLandingPage>;
}

export interface ContentBrandDirectionDesigner {
  design(input: {
    readonly workspaceId: string;
    readonly brand: ContentBrandKitSnapshot;
    readonly landingPage: ContentBrandLandingPage | null;
    readonly description: string | null;
    readonly sources: readonly ("landing_page" | "logo" | "description")[];
  }): Promise<{
    readonly colors: ContentBrandKitSnapshot["colors"];
    readonly typography: ContentBrandKitSnapshot["typography"];
    readonly imageStyle: ContentBrandKitSnapshot["imageStyle"];
    readonly rationale: string;
    readonly metadata: {
      readonly provider: string;
      readonly model: string;
      readonly promptVersion: string;
      readonly aiRunId: string | null;
    };
  }>;
}

export interface ContentBrandDirectionView {
  readonly brandKit: ContentBrandKitView;
  readonly contrast: ContentBrandPaletteContrast;
  readonly metadata: {
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
    readonly aiRunId: string | null;
  } | null;
}

export class ContentBrandKitApplication {
  constructor(
    private readonly repository: ContentBrandKitRepository,
    private readonly logoProcessor?: ContentBrandLogoProcessor,
    private readonly assetStorage?: ContentBrandAssetStorage,
    private readonly directionDesigner?: ContentBrandDirectionDesigner,
    private readonly landingPageReader?: ContentBrandLandingPageReader,
  ) {}

  async get(workspaceId: string): Promise<ContentBrandKitView> {
    return await this.repository.find(workspaceId) ?? {
      workspaceId,
      version: 0,
      snapshot: DEFAULT_CONTENT_BRAND_KIT,
      updatedAt: null,
    };
  }

  async update(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly requestKey: string;
    readonly snapshot: ContentBrandKitSnapshot;
    readonly now?: Date;
  }): Promise<ContentBrandKitView> {
    const replay = await this.repository.findRequest({ workspaceId: input.workspaceId, requestKey: input.requestKey });
    if (replay) return replay;
    assertContentBrandKit(input.snapshot);
    if (input.snapshot.logo && !input.snapshot.logo.objectKey.startsWith(`${input.workspaceId}/brand-assets/`)) {
      throw new Error("CONTENT_BRAND_KIT_LOGO_WORKSPACE_MISMATCH");
    }
    return this.repository.save({ ...input, now: input.now ?? new Date() });
  }

  async importLogo(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly requestKey: string;
    readonly fileName: string;
    readonly mimeType: "image/png" | "image/jpeg" | "image/webp";
    readonly bytes: Uint8Array;
    readonly now?: Date;
  }): Promise<ContentBrandKitView> {
    const replay = await this.repository.findRequest({ workspaceId: input.workspaceId, requestKey: input.requestKey });
    if (replay) return replay;
    if (!this.logoProcessor || !this.assetStorage) throw new Error("CONTENT_BRAND_LOGO_IMPORT_UNAVAILABLE");
    if (input.bytes.byteLength < 1 || input.bytes.byteLength > 5 * 1024 * 1024) throw new Error("CONTENT_BRAND_LOGO_SIZE_INVALID");
    const normalized = await this.logoProcessor.normalize({ bytes: input.bytes, mimeType: input.mimeType });
    const checksumSha256 = new Bun.CryptoHasher("sha256").update(normalized.bytes).digest("hex");
    const objectKey = `${input.workspaceId}/brand-assets/${checksumSha256}.png`;
    await this.assetStorage.put({ objectKey, body: normalized.bytes, contentType: "image/png" });
    const current = await this.get(input.workspaceId);
    return this.update({
      workspaceId: input.workspaceId,
      userId: input.userId,
      requestKey: input.requestKey,
      ...(input.now ? { now: input.now } : {}),
      snapshot: {
        ...current.snapshot,
        colors: normalized.colors,
        paletteMetadata: {
          generatedBy: "detected",
          sources: ["logo"],
          rationale: "Couleurs candidates détectées dans le logo. La direction IA peut ensuite leur attribuer des rôles accessibles.",
        },
        logo: {
          objectKey,
          mimeType: "image/png",
          checksumSha256,
          width: normalized.width,
          height: normalized.height,
          previewDataUrl: normalized.previewDataUrl,
          sourceFileName: input.fileName,
        },
      },
    });
  }

  async generateDirection(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly requestKey: string;
    readonly landingPageUrl: string | null;
    readonly description: string | null;
    readonly useLogo: boolean;
    readonly now?: Date;
  }): Promise<ContentBrandDirectionView> {
    const replay = await this.repository.findRequest({ workspaceId: input.workspaceId, requestKey: input.requestKey });
    if (replay) return { brandKit: replay, contrast: contentBrandPaletteContrast(replay.snapshot.colors), metadata: null };
    if (!this.directionDesigner) throw new Error("CONTENT_BRAND_DIRECTION_UNAVAILABLE");
    const current = await this.get(input.workspaceId);
    const sources: ("landing_page" | "logo" | "description")[] = [];
    let landingPage: ContentBrandLandingPage | null = null;
    if (input.landingPageUrl) {
      if (!this.landingPageReader) throw new Error("CONTENT_BRAND_LANDING_PAGE_UNAVAILABLE");
      landingPage = await this.landingPageReader.read({
        url: input.landingPageUrl,
        correlationId: `brand-direction:${input.workspaceId}:${input.requestKey}`,
      });
      sources.push("landing_page");
    }
    if (input.useLogo && current.snapshot.logo) sources.push("logo");
    if (input.description) sources.push("description");
    if (sources.length < 1) throw new Error("CONTENT_BRAND_DIRECTION_SOURCE_REQUIRED");
    const proposal = await this.directionDesigner.design({
      workspaceId: input.workspaceId,
      brand: current.snapshot,
      landingPage,
      description: input.description,
      sources,
    });
    const brandKit = await this.update({
      workspaceId: input.workspaceId,
      userId: input.userId,
      requestKey: input.requestKey,
      ...(input.now ? { now: input.now } : {}),
      snapshot: {
        ...current.snapshot,
        websiteUrl: input.landingPageUrl ?? current.snapshot.websiteUrl,
        brandDescription: input.description ?? current.snapshot.brandDescription,
        colors: proposal.colors,
        typography: proposal.typography,
        imageStyle: proposal.imageStyle,
        paletteMetadata: {
          generatedBy: "ai",
          sources,
          rationale: proposal.rationale,
        },
      },
    });
    return { brandKit, contrast: contentBrandPaletteContrast(brandKit.snapshot.colors), metadata: proposal.metadata };
  }
}
