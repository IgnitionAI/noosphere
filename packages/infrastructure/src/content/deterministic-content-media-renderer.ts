import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import type { ContentMediaRenderer } from "@outbound/application/content/content-media";
import type { ContentBrandKitSnapshot } from "@outbound/domain/content/content-brand-kit";
import type { ContentMediaPlan } from "@outbound/domain/content/content-asset";

const WIDTH = 1080;
const HEIGHT = 1350;
type CarouselLayout = "cover" | "insight" | "checklist" | "framework" | "comparison" | "process" | "closing";
type CarouselItem = { readonly label: string; readonly text: string };

export class DeterministicContentMediaRenderer implements ContentMediaRenderer {
  constructor(private readonly ffmpegBinary = "ffmpeg") {}

  async render(input: Parameters<ContentMediaRenderer["render"]>[0]): ReturnType<ContentMediaRenderer["render"]> {
    await mkdir(input.outputDirectory, { recursive: true });
    try {
      if (input.format === "linkedin_image") {
        const bytes = await renderCard({
          brandKit: input.brandKit,
          eyebrow: input.brandKit.brandName,
          title: required(input.plan.title, "CONTENT_MEDIA_TITLE_REQUIRED"),
          body: input.plan.subtitle ?? excerpt(input.body, 180),
          index: null,
          total: null,
          variant: "single",
          layout: "insight",
          kicker: input.plan.visualTone,
          callout: null,
          items: [],
          ...(input.logoBytes ? { logoBytes: input.logoBytes } : {}),
        });
        return mediaResult(bytes, "image/png", "linkedin-image.png", { renderer: "sharp-svg-v3", cards: 1, logo: Boolean(input.logoBytes) }, 1);
      }
      if (input.format === "linkedin_document") return await this.#renderDocument(input.plan, input.brandKit, input.logoBytes);
      return await this.#renderVideo(input.plan, input.brandKit, input.outputDirectory, input.logoBytes);
    } finally {
      await rm(input.outputDirectory, { recursive: true, force: true });
    }
  }

  async #renderDocument(plan: ContentMediaPlan, brandKit: ContentBrandKitSnapshot, logoBytes?: Uint8Array) {
    const pdf = await PDFDocument.create();
    const layouts: CarouselLayout[] = [];
    for (const [index, slide] of plan.slides.entries()) {
      const layout = resolveSlideLayout(slide, index, plan.slides.length);
      layouts.push(layout);
      const png = await renderCard({
        brandKit,
        eyebrow: brandKit.brandName,
        title: slide.title,
        body: slide.body,
        index: index + 1,
        total: plan.slides.length,
        variant: index === 0 ? "opening" : index === plan.slides.length - 1 ? "closing" : "step",
        layout,
        kicker: slide.kicker ?? null,
        callout: slide.callout ?? null,
        items: slide.items ?? [],
        ...(logoBytes ? { logoBytes } : {}),
      });
      const embedded = await pdf.embedPng(png);
      const page = pdf.addPage([WIDTH, HEIGHT]);
      page.drawImage(embedded, { x: 0, y: 0, width: WIDTH, height: HEIGHT });
    }
    const bytes = await pdf.save({ useObjectStreams: false });
    return {
      bytes,
      mimeType: "application/pdf" as const,
      filename: safeFilename(plan.title ?? brandKit.brandName, "pdf"),
      width: WIDTH,
      height: HEIGHT,
      pageCount: plan.slides.length,
      durationSeconds: null,
      manifest: { renderer: "pdf-lib-sharp-v4", slides: plan.slides.length, ratio: "4:5", narrativeLayouts: layouts, logo: Boolean(logoBytes) },
    };
  }

  async #renderVideo(plan: ContentMediaPlan, brandKit: ContentBrandKitSnapshot, outputDirectory: string, logoBytes?: Uint8Array) {
    const lines: string[] = [];
    let durationSeconds = 0;
    for (const [index, scene] of plan.scenes.entries()) {
      const path = join(outputDirectory, `scene-${String(index).padStart(3, "0")}.png`);
      await writeFile(path, await renderCard({
        brandKit,
        eyebrow: brandKit.brandName,
        title: scene.title,
        body: scene.body,
        index: index + 1,
        total: plan.scenes.length,
        variant: index === 0 ? "opening" : index === plan.scenes.length - 1 ? "closing" : "step",
        layout: index === 0 ? "cover" : index === plan.scenes.length - 1 ? "closing" : "insight",
        kicker: null,
        callout: null,
        items: [],
        ...(logoBytes ? { logoBytes } : {}),
      }));
      lines.push(`file '${escapeConcatPath(path)}'`, `duration ${scene.durationSeconds}`);
      durationSeconds += scene.durationSeconds;
    }
    const finalScene = join(outputDirectory, `scene-${String(plan.scenes.length - 1).padStart(3, "0")}.png`);
    lines.push(`file '${escapeConcatPath(finalScene)}'`);
    const manifestPath = join(outputDirectory, "scenes.ffconcat");
    const outputPath = join(outputDirectory, "linkedin-video.mp4");
    await writeFile(manifestPath, `ffconcat version 1.0\n${lines.join("\n")}\n`, "utf8");
    const process = Bun.spawn([
      this.ffmpegBinary,
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "concat", "-safe", "0", "-i", manifestPath,
      "-vf", `fps=30,scale=${WIDTH}:${HEIGHT}:flags=lanczos,format=yuv420p`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-movflags", "+faststart",
      outputPath,
    ], { stdout: "pipe", stderr: "pipe" });
    const exitCode = await process.exited;
    if (exitCode !== 0) {
      const detail = await new Response(process.stderr).text();
      throw new Error(`CONTENT_VIDEO_RENDER_FAILED: ${detail.slice(0, 1_000)}`);
    }
    const bytes = new Uint8Array(await readFile(outputPath));
    return {
      bytes,
      mimeType: "video/mp4" as const,
      filename: safeFilename(plan.title ?? brandKit.brandName, "mp4"),
      width: WIDTH,
      height: HEIGHT,
      pageCount: null,
      durationSeconds,
      manifest: { renderer: "ffmpeg-motion-graphics-v1", scenes: plan.scenes.length, ratio: "4:5", codec: "h264" },
    };
  }
}

async function renderCard(input: {
  readonly brandKit: ContentBrandKitSnapshot;
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly index: number | null;
  readonly total: number | null;
  readonly variant: "single" | "opening" | "step" | "closing";
  readonly layout: CarouselLayout;
  readonly kicker: string | null;
  readonly callout: string | null;
  readonly items: readonly CarouselItem[];
  readonly logoBytes?: Uint8Array;
}): Promise<Uint8Array> {
  const primary = escapeAttribute(input.brandKit.colors.primary);
  const accent = escapeAttribute(input.brandKit.colors.accent);
  const background = escapeAttribute(input.brandKit.colors.background);
  const configuredText = escapeAttribute(input.brandKit.colors.text);
  const isCover = input.layout === "cover";
  const isClosing = input.layout === "closing";
  const darkSurface = isCover || (input.brandKit.imageStyle === "bold" && input.layout === "insight");
  const surface = isClosing ? accent : darkSurface ? primary : background;
  const text = isClosing
    ? escapeAttribute(bestContrastColor(input.brandKit.colors.accent, input.brandKit.colors.primary, input.brandKit.colors.background))
    : darkSurface ? background : configuredText;
  const muted = darkSurface ? background : primary;
  const fontFamily = input.brandKit.typography === "space_grotesk"
    ? "Space Grotesk,DejaVu Sans,Arial,sans-serif"
    : input.brandKit.typography === "system"
      ? "DejaVu Sans,Arial,sans-serif"
      : "Inter,DejaVu Sans,Arial,sans-serif";
  const progress = input.index && input.total ? Math.round((input.index / input.total) * 904) : 0;
  const chrome = renderChrome({ input, primary, accent, background, progress });
  const content = renderLayoutContent({ input, primary, accent, background, text, muted, fontFamily });
  const sequence = input.index && input.total ? ` · ${input.index}/${input.total}` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect width="${WIDTH}" height="${HEIGHT}" fill="${surface}"/>
    ${chrome}
    <text x="88" y="104" font-family="${fontFamily}" font-size="24" font-weight="760" letter-spacing="3" fill="${muted}">${escapeText(input.eyebrow.toUpperCase())}${sequence}</text>
    ${content}
    <line x1="88" y1="1190" x2="992" y2="1190" stroke="${muted}" stroke-width="2" opacity="0.18"/>
    <text x="88" y="1255" font-family="${fontFamily}" font-size="25" font-weight="650" fill="${muted}">${escapeText(input.brandKit.tagline ?? input.brandKit.brandName)}</text>
    ${input.index === null ? "" : `<text x="992" y="1255" text-anchor="end" font-family="${fontFamily}" font-size="25" font-weight="760" fill="${muted}">${input.index}</text>`}
  </svg>`;
  const card = sharp(Buffer.from(svg));
  if (!input.logoBytes) return new Uint8Array(await card.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer());
  const logo = await sharp(input.logoBytes)
    .resize({ width: 112, height: 64, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
  const tile = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="88"><rect width="144" height="88" rx="18" fill="#FFFFFF" fill-opacity="0.94"/></svg>`);
  return new Uint8Array(await card.composite([
    { input: tile, left: 848, top: 38 },
    { input: logo, left: 864, top: 50 },
  ]).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer());
}

function renderChrome(input: {
  readonly input: { readonly brandKit: ContentBrandKitSnapshot; readonly index: number | null; readonly total: number | null; readonly variant: "single" | "opening" | "step" | "closing"; readonly layout: CarouselLayout };
  readonly primary: string;
  readonly accent: string;
  readonly background: string;
  readonly progress: number;
}): string {
  const rail = `<rect x="0" y="0" width="24" height="1350" fill="${input.accent}"/>`;
  if (input.input.layout === "cover") return `${rail}<circle cx="930" cy="1030" r="310" fill="none" stroke="${input.accent}" stroke-width="54" opacity="0.92"/><circle cx="930" cy="1030" r="210" fill="none" stroke="${input.accent}" stroke-width="3" opacity="0.58"/><path d="M760 160H1010" stroke="${input.accent}" stroke-width="10"/>`;
  if (input.input.layout === "closing") return `<path d="M690 0H1080V390L690 0Z" fill="${input.background}" opacity="0.96"/><circle cx="918" cy="248" r="86" fill="${input.primary}"/><circle cx="918" cy="248" r="52" fill="none" stroke="${input.background}" stroke-width="3" opacity="0.75"/>`;
  const progress = `<rect x="88" y="142" width="904" height="6" rx="3" fill="${input.primary}" opacity="0.12"/><rect x="88" y="142" width="${input.progress}" height="6" rx="3" fill="${input.accent}"/>`;
  if (input.input.layout === "framework") return `${progress}<path d="M760 925h240M880 805v240" stroke="${input.accent}" stroke-width="2" opacity="0.18"/>`;
  if (input.input.layout === "process") return `${progress}<circle cx="976" cy="1090" r="120" fill="none" stroke="${input.accent}" stroke-width="24" opacity="0.16"/>`;
  if (input.input.brandKit.imageStyle === "technical") return `${rail}${progress}<path d="M805 1000h190v190H805z M845 1040h110v110H845z" fill="none" stroke="${input.accent}" stroke-width="10" opacity="0.35"/>`;
  if (input.input.brandKit.imageStyle === "minimal") return `${progress}<rect x="938" y="74" width="54" height="54" rx="8" fill="${input.accent}"/>`;
  return `${rail}${progress}`;
}

function renderLayoutContent(input: {
  readonly input: {
    readonly title: string;
    readonly body: string;
    readonly layout: CarouselLayout;
    readonly kicker: string | null;
    readonly callout: string | null;
    readonly items: readonly CarouselItem[];
  };
  readonly primary: string;
  readonly accent: string;
  readonly background: string;
  readonly text: string;
  readonly muted: string;
  readonly fontFamily: string;
}): string {
  const layout = input.input.layout;
  if (layout === "cover") return renderCover(input);
  if (layout === "closing") return renderClosing(input);
  if (layout === "checklist") return renderChecklist(input);
  if (layout === "framework") return renderFramework(input);
  if (layout === "comparison") return renderComparison(input);
  if (layout === "process") return renderProcess(input);
  return renderInsight(input);
}

function renderCover(input: Parameters<typeof renderLayoutContent>[0]): string {
  const title = wrap(input.input.title, 19, 5);
  const body = wrap(input.input.body, 34, 4);
  const kicker = input.input.kicker ?? "DOSSIER PRATIQUE";
  return `
    <rect x="88" y="184" width="${Math.min(430, 72 + kicker.length * 16)}" height="52" rx="26" fill="${input.accent}"/>
    <text x="116" y="218" font-family="${input.fontFamily}" font-size="20" font-weight="780" letter-spacing="1.8" fill="${input.primary}">${escapeText(kicker.toUpperCase())}</text>
    <text x="88" y="340" font-family="${input.fontFamily}" font-size="78" font-weight="790" fill="${input.text}">${tspans(title, 340, 84)}</text>
    <text x="88" y="${390 + title.length * 84}" font-family="${input.fontFamily}" font-size="34" font-weight="460" fill="${input.text}" opacity="0.76">${tspans(body, 390 + title.length * 84, 43)}</text>
    <text x="88" y="1110" font-family="${input.fontFamily}" font-size="21" font-weight="760" letter-spacing="2.2" fill="${input.accent}">FAIRE DÉFILER →</text>`;
}

function renderInsight(input: Parameters<typeof renderLayoutContent>[0]): string {
  const title = wrap(input.input.title, 24, 4);
  const focus = input.input.callout ?? input.input.body;
  const focusLines = wrap(focus, 29, 5);
  const showBody = Boolean(input.input.callout);
  const body = wrap(input.input.body, 45, 3);
  return `
    ${renderKicker(input, 205)}
    <text x="88" y="290" font-family="${input.fontFamily}" font-size="62" font-weight="790" fill="${input.text}">${tspans(title, 290, 68)}</text>
    <rect x="88" y="${410 + title.length * 68}" width="904" height="${Math.max(260, 96 + focusLines.length * 52)}" rx="34" fill="${input.accent}" opacity="0.12"/>
    <rect x="88" y="${410 + title.length * 68}" width="12" height="${Math.max(260, 96 + focusLines.length * 52)}" rx="6" fill="${input.accent}"/>
    <text x="136" y="${485 + title.length * 68}" font-family="${input.fontFamily}" font-size="41" font-weight="690" fill="${input.text}">${tspans(focusLines, 485 + title.length * 68, 52, 136)}</text>
    ${showBody ? `<text x="88" y="1050" font-family="${input.fontFamily}" font-size="29" font-weight="450" fill="${input.text}" opacity="0.72">${tspans(body, 1050, 38)}</text>` : ""}`;
}

function renderChecklist(input: Parameters<typeof renderLayoutContent>[0]): string {
  const title = wrap(input.input.title, 24, 3);
  const items = contentItems(input.input.items, input.input.body, 4);
  const startY = 430;
  const rowHeight = Math.min(172, Math.floor(650 / Math.max(items.length, 1)));
  const rows = items.map((item, index) => {
    const y = startY + index * (rowHeight + 14);
    const text = wrap(item.text, 48, 2);
    return `<rect x="88" y="${y}" width="904" height="${rowHeight}" rx="24" fill="${input.primary}" opacity="0.055"/>
      <circle cx="143" cy="${y + rowHeight / 2}" r="27" fill="${input.accent}"/>
      <path d="M130 ${y + rowHeight / 2}l9 10 19-23" fill="none" stroke="${input.primary}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="198" y="${y + 50}" font-family="${input.fontFamily}" font-size="25" font-weight="780" fill="${input.text}">${escapeText(item.label)}</text>
      <text x="198" y="${y + 91}" font-family="${input.fontFamily}" font-size="28" font-weight="440" fill="${input.text}" opacity="0.72">${tspans(text, y + 91, 34, 198)}</text>`;
  }).join("");
  return `${renderKicker(input, 205)}<text x="88" y="290" font-family="${input.fontFamily}" font-size="62" font-weight="790" fill="${input.text}">${tspans(title, 290, 68)}</text>${rows}`;
}

function renderFramework(input: Parameters<typeof renderLayoutContent>[0]): string {
  const title = wrap(input.input.title, 24, 3);
  const items = contentItems(input.input.items, input.input.body, 4);
  const cards = items.map((item, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 88 + column * 464;
    const y = 460 + row * 310;
    const text = wrap(item.text, 24, 4);
    return `<rect x="${x}" y="${y}" width="440" height="280" rx="30" fill="${index === 0 ? input.primary : input.accent}" opacity="${index === 0 ? 1 : 0.12}"/>
      <text x="${x + 32}" y="${y + 54}" font-family="${input.fontFamily}" font-size="21" font-weight="780" letter-spacing="1.4" fill="${index === 0 ? input.background : input.primary}">${escapeText(item.label.toUpperCase())}</text>
      <text x="${x + 32}" y="${y + 112}" font-family="${input.fontFamily}" font-size="29" font-weight="520" fill="${index === 0 ? input.background : input.text}">${tspans(text, y + 112, 36, x + 32)}</text>`;
  }).join("");
  return `${renderKicker(input, 205)}<text x="88" y="290" font-family="${input.fontFamily}" font-size="62" font-weight="790" fill="${input.text}">${tspans(title, 290, 68)}</text>${cards}`;
}

function renderComparison(input: Parameters<typeof renderLayoutContent>[0]): string {
  const title = wrap(input.input.title, 24, 3);
  const items = contentItems(input.input.items, input.input.body, 2);
  const cards = [items[0] ?? { label: "AVANT", text: input.input.body }, items[1] ?? { label: "APRÈS", text: input.input.callout ?? input.input.body }].map((item, index) => {
    const x = index === 0 ? 88 : 550;
    const fill = index === 0 ? input.primary : input.accent;
    const foreground = index === 0 ? input.background : escapeAttribute(bestContrastColor(input.accent, input.primary, input.background));
    const text = wrap(item.text, 23, 7);
    return `<rect x="${x}" y="470" width="442" height="570" rx="34" fill="${fill}"/>
      <text x="${x + 34}" y="535" font-family="${input.fontFamily}" font-size="22" font-weight="790" letter-spacing="2" fill="${foreground}">${escapeText(item.label.toUpperCase())}</text>
      <line x1="${x + 34}" y1="570" x2="${x + 408}" y2="570" stroke="${foreground}" stroke-width="2" opacity="0.24"/>
      <text x="${x + 34}" y="640" font-family="${input.fontFamily}" font-size="34" font-weight="590" fill="${foreground}">${tspans(text, 640, 43, x + 34)}</text>`;
  }).join("");
  return `${renderKicker(input, 205)}<text x="88" y="290" font-family="${input.fontFamily}" font-size="62" font-weight="790" fill="${input.text}">${tspans(title, 290, 68)}</text>${cards}`;
}

function renderProcess(input: Parameters<typeof renderLayoutContent>[0]): string {
  const title = wrap(input.input.title, 24, 3);
  const items = contentItems(input.input.items, input.input.body, 4);
  const startY = 455;
  const gap = Math.floor(600 / Math.max(items.length, 1));
  const timeline = `<line x1="132" y1="${startY}" x2="132" y2="${startY + gap * Math.max(items.length - 1, 1)}" stroke="${input.primary}" stroke-width="5" opacity="0.15"/>`;
  const rows = items.map((item, index) => {
    const y = startY + index * gap;
    const text = wrap(item.text, 48, 2);
    return `<circle cx="132" cy="${y}" r="31" fill="${input.accent}"/><text x="132" y="${y + 9}" text-anchor="middle" font-family="${input.fontFamily}" font-size="24" font-weight="800" fill="${input.primary}">${index + 1}</text>
      <text x="194" y="${y - 5}" font-family="${input.fontFamily}" font-size="27" font-weight="780" fill="${input.text}">${escapeText(item.label)}</text>
      <text x="194" y="${y + 38}" font-family="${input.fontFamily}" font-size="27" font-weight="440" fill="${input.text}" opacity="0.7">${tspans(text, y + 38, 34, 194)}</text>`;
  }).join("");
  return `${renderKicker(input, 205)}<text x="88" y="290" font-family="${input.fontFamily}" font-size="62" font-weight="790" fill="${input.text}">${tspans(title, 290, 68)}</text>${timeline}${rows}`;
}

function renderClosing(input: Parameters<typeof renderLayoutContent>[0]): string {
  const title = wrap(input.input.title, 16, 5);
  const body = wrap(input.input.body, 34, 5);
  const callout = wrap(input.input.callout ?? "À vous de décider", 32, 2);
  return `<text x="88" y="300" font-family="${input.fontFamily}" font-size="70" font-weight="800" fill="${input.text}">${tspans(title, 300, 76)}</text>
    <text x="88" y="${360 + title.length * 76}" font-family="${input.fontFamily}" font-size="34" font-weight="480" fill="${input.text}" opacity="0.78">${tspans(body, 360 + title.length * 76, 43)}</text>
    <rect x="88" y="900" width="760" height="142" rx="30" fill="${input.background}" opacity="0.94"/>
    <text x="128" y="958" font-family="${input.fontFamily}" font-size="29" font-weight="760" fill="${input.primary}">${tspans(callout, 958, 37, 128)}</text>
    <circle cx="922" cy="971" r="69" fill="${input.primary}"/><path d="M891 971h55m-20-20 20 20-20 20" fill="none" stroke="${input.background}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function renderKicker(input: Parameters<typeof renderLayoutContent>[0], y: number): string {
  if (!input.input.kicker) return "";
  return `<text x="88" y="${y}" font-family="${input.fontFamily}" font-size="20" font-weight="780" letter-spacing="2" fill="${input.accent}">${escapeText(input.input.kicker.toUpperCase())}</text>`;
}

function contentItems(items: readonly CarouselItem[], body: string, maximum: number): readonly CarouselItem[] {
  if (items.length) return items.slice(0, maximum);
  const sentences = body.split(/(?<=[.!?])\s+/).map((value) => value.trim()).filter(Boolean).slice(0, maximum);
  return (sentences.length ? sentences : [body]).map((text, index) => ({ label: `Point ${index + 1}`, text }));
}

function resolveSlideLayout(slide: ContentMediaPlan["slides"][number], index: number, total: number): CarouselLayout {
  if (index === 0) return "cover";
  if (index === total - 1) return "closing";
  if (slide.layout && slide.layout !== "auto" && slide.layout !== "cover" && slide.layout !== "closing") return slide.layout;
  const count = slide.items?.length ?? 0;
  if (count === 2) return "comparison";
  if (count >= 3) return index % 2 === 0 ? "framework" : "process";
  if (slide.callout) return "insight";
  return index % 2 === 0 ? "checklist" : "insight";
}

function mediaResult(bytes: Uint8Array, mimeType: "image/png", filename: string, manifest: Record<string, unknown>, pageCount: number) {
  return { bytes, mimeType, filename, width: WIDTH, height: HEIGHT, pageCount, durationSeconds: null, manifest };
}

function wrap(value: string, maxCharacters: number, maxLines: number): readonly string[] {
  const words = value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || `${current} ${word}`.length > maxCharacters) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
    if (lines.length > maxLines) break;
  }
  const retained = lines.slice(0, maxLines);
  if (lines.length > maxLines && retained.length) retained[retained.length - 1] = `${retained.at(-1)!.replace(/[.…]+$/, "")}…`;
  return retained.length ? retained : [""];
}

function tspans(lines: readonly string[], firstY: number, lineHeight: number, x = 88): string {
  return lines.map((line, index) => `<tspan x="${x}" y="${firstY + index * lineHeight}">${escapeText(line)}</tspan>`).join("");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function escapeConcatPath(value: string): string {
  return value.replace(/'/g, "'\\''");
}

function bestContrastColor(background: string, first: string, second: string): string {
  return contrastRatio(background, first) >= contrastRatio(background, second) ? first : second;
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return 0;
  const channels = [0, 2, 4].map((offset) => Number.parseInt(match[1]!.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function safeFilename(value: string, extension: string): string {
  const stem = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || basename(`linkedin-content.${extension}`, `.${extension}`);
  return `${stem}.${extension}`;
}

function required(value: string | null, code: string): string {
  if (value?.trim()) return value.trim();
  throw new Error(code);
}

function excerpt(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trimEnd()}…`;
}
