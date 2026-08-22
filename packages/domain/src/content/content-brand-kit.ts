export const linkedinContentFormats = [
  "linkedin_text",
  "linkedin_image",
  "linkedin_document",
  "linkedin_video",
] as const;

export type LinkedinContentFormat = (typeof linkedinContentFormats)[number];

export interface ContentFormatMix {
  readonly linkedin_text: number;
  readonly linkedin_image: number;
  readonly linkedin_document: number;
  readonly linkedin_video: number;
}

export interface ContentBrandKitSnapshot {
  readonly brandName: string;
  readonly tagline: string | null;
  readonly websiteUrl: string | null;
  readonly brandDescription: string | null;
  readonly logo: {
    readonly objectKey: string;
    readonly mimeType: "image/png";
    readonly checksumSha256: string;
    readonly width: number;
    readonly height: number;
    readonly previewDataUrl: string;
    readonly sourceFileName: string;
  } | null;
  readonly colors: {
    readonly primary: string;
    readonly accent: string;
    readonly background: string;
    readonly text: string;
  };
  readonly paletteMetadata: {
    readonly generatedBy: "manual" | "detected" | "ai";
    readonly sources: readonly ("landing_page" | "logo" | "description" | "manual")[];
    readonly rationale: string | null;
  };
  readonly typography: "inter" | "space_grotesk" | "system";
  readonly enabledFormats: readonly LinkedinContentFormat[];
  readonly weeklyMix: ContentFormatMix;
  readonly imageStyle: "editorial" | "technical" | "bold" | "minimal";
  readonly videoMode: "motion_graphics" | "generative";
  readonly voice: {
    readonly traits: readonly string[];
    readonly avoid: readonly string[];
    readonly preferredVocabulary: readonly string[];
  };
}

export const DEFAULT_CONTENT_BRAND_KIT: ContentBrandKitSnapshot = {
  brandName: "Noosphere",
  tagline: "Créer et capter la demande",
  websiteUrl: null,
  brandDescription: null,
  logo: null,
  colors: {
    primary: "#07133F",
    accent: "#C8F85A",
    background: "#F7F8F4",
    text: "#07133F",
  },
  paletteMetadata: {
    generatedBy: "manual",
    sources: ["manual"],
    rationale: null,
  },
  typography: "inter",
  enabledFormats: ["linkedin_text", "linkedin_image", "linkedin_document"],
  weeklyMix: {
    linkedin_text: 6,
    linkedin_image: 5,
    linkedin_document: 3,
    linkedin_video: 0,
  },
  imageStyle: "editorial",
  videoMode: "motion_graphics",
  voice: {
    traits: ["clair", "direct", "expert sans jargon"],
    avoid: ["promesses vagues", "superlatifs", "ton robotique"],
    preferredVocabulary: [],
  },
};

export function assertContentBrandKit(snapshot: ContentBrandKitSnapshot): void {
  if (snapshot.logo && !/^[0-9a-f-]{36}\/brand-assets\/[0-9a-f]{64}\.png$/.test(snapshot.logo.objectKey)) {
    throw new Error("CONTENT_BRAND_KIT_LOGO_INVALID");
  }
  if (snapshot.voice.traits.length > 8 || snapshot.voice.avoid.length > 12 || snapshot.voice.preferredVocabulary.length > 20) {
    throw new Error("CONTENT_BRAND_KIT_VOICE_INVALID");
  }
  assertContentBrandPalette(snapshot.colors);
  if (snapshot.paletteMetadata.sources.length < 1 || new Set(snapshot.paletteMetadata.sources).size !== snapshot.paletteMetadata.sources.length) {
    throw new Error("CONTENT_BRAND_KIT_PALETTE_METADATA_INVALID");
  }
  const formats = new Set(snapshot.enabledFormats);
  if (formats.size !== snapshot.enabledFormats.length || formats.size === 0) {
    throw new Error("CONTENT_BRAND_KIT_FORMATS_INVALID");
  }
  for (const format of formats) {
    if (!linkedinContentFormats.includes(format)) throw new Error("CONTENT_BRAND_KIT_FORMATS_INVALID");
    if (snapshot.weeklyMix[format] <= 0) throw new Error("CONTENT_BRAND_KIT_MIX_INVALID");
  }
  for (const format of linkedinContentFormats) {
    if (!Number.isInteger(snapshot.weeklyMix[format]) || snapshot.weeklyMix[format] < 0 || snapshot.weeklyMix[format] > 14) {
      throw new Error("CONTENT_BRAND_KIT_MIX_INVALID");
    }
    if (!formats.has(format) && snapshot.weeklyMix[format] !== 0) throw new Error("CONTENT_BRAND_KIT_MIX_INVALID");
  }
  const total = linkedinContentFormats.reduce((sum, format) => sum + snapshot.weeklyMix[format], 0);
  if (total < 1 || total > 14) throw new Error("CONTENT_BRAND_KIT_MIX_INVALID");
}

export interface ContentBrandPaletteContrast {
  readonly textOnBackground: number;
  readonly backgroundOnPrimary: number;
  readonly accentOnPrimary: number;
}

export function contentBrandPaletteContrast(colors: ContentBrandKitSnapshot["colors"]): ContentBrandPaletteContrast {
  return {
    textOnBackground: contrastRatio(colors.text, colors.background),
    backgroundOnPrimary: contrastRatio(colors.background, colors.primary),
    accentOnPrimary: contrastRatio(colors.accent, colors.primary),
  };
}

export function contentBrandPaletteIssues(colors: ContentBrandKitSnapshot["colors"]): readonly string[] {
  const contrast = contentBrandPaletteContrast(colors);
  return [
    ...(contrast.textOnBackground < 4.5 ? ["text/background contrast must be at least 4.5:1"] : []),
    ...(contrast.backgroundOnPrimary < 4.5 ? ["background/primary contrast must be at least 4.5:1"] : []),
    ...(contrast.accentOnPrimary < 3 ? ["accent/primary contrast must be at least 3:1"] : []),
  ];
}

export function assertContentBrandPalette(colors: ContentBrandKitSnapshot["colors"]): void {
  if (contentBrandPaletteIssues(colors).length > 0) throw new Error("CONTENT_BRAND_KIT_PALETTE_CONTRAST_INVALID");
}

function contrastRatio(left: string, right: string): number {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  return (Math.max(leftLuminance, rightLuminance) + 0.05) / (Math.min(leftLuminance, rightLuminance) + 0.05);
}

function relativeLuminance(hex: string): number {
  const normalized = hex.replace("#", "");
  if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) throw new Error("CONTENT_BRAND_KIT_COLOR_INVALID");
  const channels = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

export function enabledFormatMix(snapshot: ContentBrandKitSnapshot): readonly {
  readonly format: LinkedinContentFormat;
  readonly target: number;
}[] {
  assertContentBrandKit(snapshot);
  return snapshot.enabledFormats.map((format) => ({ format, target: snapshot.weeklyMix[format] }));
}

export function selectNextContentFormat(snapshot: ContentBrandKitSnapshot, recentFormats: readonly LinkedinContentFormat[]): LinkedinContentFormat {
  const mix = enabledFormatMix(snapshot);
  const counts = new Map<LinkedinContentFormat, number>();
  for (const format of recentFormats) counts.set(format, (counts.get(format) ?? 0) + 1);
  return [...mix].sort((left, right) => {
    const leftProgress = (counts.get(left.format) ?? 0) / left.target;
    const rightProgress = (counts.get(right.format) ?? 0) / right.target;
    if (leftProgress !== rightProgress) return leftProgress - rightProgress;
    if (left.target !== right.target) return right.target - left.target;
    return linkedinContentFormats.indexOf(left.format) - linkedinContentFormats.indexOf(right.format);
  })[0]!.format;
}
