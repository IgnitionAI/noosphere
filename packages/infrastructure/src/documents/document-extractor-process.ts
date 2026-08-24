/**
 * Cohesive subprocess security boundary, intentionally kept in one bundle.
 * Every parser is instantiated per process and dies with it; splitting parser
 * modules would not improve isolation and would complicate the standalone Bun
 * bundle copied into the runtime image.
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { unzipSync, type UnzipFileInfo, type Unzipped } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { NodeHtmlMarkdown } from "node-html-markdown";
import { parse } from "node-html-parser";
import { extractText } from "unpdf";
import type {
  DocumentExtractionSection,
  DocumentTextExtraction,
} from "@outbound/application/documents/document-text-extractor";

const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_COMPRESSION_RATIO = 100;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_XLSX_SHEETS = 200;
const MAX_XLSX_NON_EMPTY_CELLS = 100_000;
const decoder = new TextDecoder();

const [inputPath, filename, contentType] = process.argv.slice(2);
if (!inputPath || !filename || !contentType) {
  await emit({ ok: false, code: "DOCUMENT_FORMAT_INVALID" });
  process.exit(1);
}

try {
  const bytes = new Uint8Array(await readFile(inputPath));
  const extraction = await extractDocument(filename, contentType, bytes);
  validateOutput(extraction);
  await emit({ ok: true, extraction });
} catch (error) {
  const code = normalizeError(error);
  await emit({ ok: false, code });
  process.exitCode = 1;
}

async function extractDocument(
  filenameValue: string,
  contentTypeValue: string,
  bytes: Uint8Array,
): Promise<DocumentTextExtraction> {
  const started = Date.now();
  if (contentTypeValue === "application/pdf") return extractPdf(bytes, started);
  if (contentTypeValue === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return extractDocx(bytes, started);
  }
  if (contentTypeValue === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return extractPptx(bytes, started);
  }
  if (contentTypeValue === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return extractXlsx(bytes, started);
  }
  if (contentTypeValue === "text/html") return extractHtml(bytes, started);
  if (contentTypeValue === "text/markdown" || contentTypeValue === "text/plain") {
    return extractNativeText(bytes, contentTypeValue === "text/markdown" ? extname(filenameValue) : ".txt", started);
  }
  throw new Error("UNSUPPORTED_DOCUMENT_TYPE");
}

async function extractPdf(bytes: Uint8Array, started: number): Promise<DocumentTextExtraction> {
  const inputBytes = bytes.byteLength;
  let parsed: Awaited<ReturnType<typeof extractText>>;
  try {
    parsed = await extractText(bytes, { mergePages: false });
  } catch (error) {
    if (isPasswordError(error)) throw new Error("DOCUMENT_ENCRYPTED_UNSUPPORTED");
    throw new Error("DOCUMENT_FORMAT_INVALID");
  }
  const rawPages = Array.isArray(parsed.text) ? parsed.text : [parsed.text];
  const pageTexts = Array.from({ length: parsed.totalPages }, (_, index) => normalize(rawPages[index] ?? ""));
  const visibleLengths = pageTexts.map((page) => visibleText(page).length);
  const characters = visibleLengths.reduce((sum, length) => sum + length, 0);
  const usefulPages = visibleLengths.filter((length) => length >= 32).length;
  const usefulRatio = usefulPages / Math.max(1, parsed.totalPages);
  const shortUsable = parsed.totalPages <= 2 && usefulPages > 0;
  const ocrRequired = parsed.totalPages > 0 && (
    characters === 0 || (!shortUsable && usefulRatio < 0.5 && (characters / parsed.totalPages < 48 || usefulRatio < 0.25))
  );
  const sections = pageTexts.map((content, index) => ({
    locator: `page:${index + 1}`,
    title: `Page ${index + 1}`,
    content,
  }));
  const warnings = visibleLengths
    .map((length, index) => length === 0 ? `page:${index + 1}:empty` : null)
    .filter((warning): warning is string => Boolean(warning));
  return {
    provider: "unpdf",
    status: ocrRequired ? "ocr_required" : warnings.length ? "partial" : "complete",
    markdown: sectionsToMarkdown(sections),
    warnings: ocrRequired ? [...warnings, "DOCUMENT_OCR_REQUIRED"] : warnings,
    durationMs: Date.now() - started,
    sections,
    metrics: {
      bytes: inputBytes,
      characters,
      sections: sections.length,
      pages: parsed.totalPages,
    },
  };
}

async function extractDocx(bytes: Uint8Array, started: number): Promise<DocumentTextExtraction> {
  const archive = readOfficeArchive(bytes, "word/document.xml");
  void archive;
  let result: Awaited<ReturnType<typeof mammoth.convertToHtml>>;
  try {
    result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  } catch (error) {
    if (isPasswordError(error)) throw new Error("DOCUMENT_ENCRYPTED_UNSUPPORTED");
    throw new Error("DOCUMENT_FORMAT_INVALID");
  }
  const safeHtml = stripUnsafeHtml(result.value);
  const markdown = normalize(NodeHtmlMarkdown.translate(safeHtml));
  const sections = markdownSections(markdown);
  const warnings = result.messages.map((message) => `${message.type}:${message.message}`).slice(0, 100);
  assertHasText(markdown);
  return {
    provider: "docx",
    status: warnings.length ? "partial" : "complete",
    markdown,
    warnings,
    durationMs: Date.now() - started,
    sections,
    metrics: baseMetrics(bytes, markdown, sections),
  };
}

async function extractPptx(bytes: Uint8Array, started: number): Promise<DocumentTextExtraction> {
  const archive = readOfficeArchive(bytes, "ppt/presentation.xml");
  const slidePaths = presentationSlideOrder(archive);
  if (!slidePaths.length) throw new Error("DOCUMENT_TEXT_EMPTY");
  const sections: DocumentExtractionSection[] = [];
  const warnings: string[] = [];
  for (const [index, slidePath] of slidePaths.entries()) {
    const slideXml = archive[slidePath];
    if (!slideXml) {
      warnings.push(`slide:${index + 1}:missing`);
      sections.push({ locator: `slide:${index + 1}`, title: `Slide ${index + 1}`, content: "" });
      continue;
    }
    const slideText = extractOfficeText(decoder.decode(slideXml));
    const notesPath = notesPathForSlide(archive, slidePath);
    const notesText = notesPath && archive[notesPath]
      ? extractOfficeText(decoder.decode(archive[notesPath]!)).filter((line) => !/^\d+$/.test(line))
      : [];
    const title = slideText[0] || `Slide ${index + 1}`;
    const contentParts = [slideText.join("\n\n")];
    if (notesText.length) contentParts.push(`### Notes présentateur\n\n${notesText.join("\n\n")}`);
    sections.push({ locator: `slide:${index + 1}`, title, content: normalize(contentParts.join("\n\n")) });
  }
  const markdown = sectionsToMarkdown(sections);
  assertHasText(markdown);
  return {
    provider: "pptx",
    status: warnings.length ? "partial" : "complete",
    markdown,
    warnings,
    durationMs: Date.now() - started,
    sections,
    metrics: { ...baseMetrics(bytes, markdown, sections), slides: sections.length },
  };
}

async function extractXlsx(bytes: Uint8Array, started: number): Promise<DocumentTextExtraction> {
  readOfficeArchive(bytes, "xl/workbook.xml");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as never);
  } catch (error) {
    if (isPasswordError(error)) throw new Error("DOCUMENT_ENCRYPTED_UNSUPPORTED");
    throw new Error("DOCUMENT_FORMAT_INVALID");
  }
  const visibleWorksheets = workbook.worksheets.filter((sheet) => sheet.state === "visible");
  if (visibleWorksheets.length > MAX_XLSX_SHEETS) throw new Error("DOCUMENT_CONTENT_LIMIT_EXCEEDED");
  let nonEmptyCells = 0;
  const sections: DocumentExtractionSection[] = [];
  for (const worksheet of visibleWorksheets) {
    const rows: { row: number; values: Map<number, string> }[] = [];
    let minColumn = Number.POSITIVE_INFINITY;
    let maxColumn = 0;
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values = new Map<number, string>();
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        const value = spreadsheetCellText(cell.value);
        if (!value) return;
        nonEmptyCells += 1;
        if (nonEmptyCells > MAX_XLSX_NON_EMPTY_CELLS) throw new Error("DOCUMENT_CONTENT_LIMIT_EXCEEDED");
        values.set(columnNumber, value);
        minColumn = Math.min(minColumn, columnNumber);
        maxColumn = Math.max(maxColumn, columnNumber);
      });
      if (values.size) rows.push({ row: rowNumber, values });
    });
    for (let offset = 0; offset < rows.length; offset += 200) {
      const batch = rows.slice(offset, offset + 200);
      if (!batch.length || !Number.isFinite(minColumn)) continue;
      const startRow = batch[0]!.row;
      const endRow = batch.at(-1)!.row;
      const locator = `sheet:${worksheet.name}!${columnName(minColumn)}${startRow}:${columnName(maxColumn)}${endRow}`;
      const content = spreadsheetMarkdown(batch, minColumn, maxColumn);
      sections.push({ locator, title: worksheet.name, content });
    }
  }
  const markdown = sectionsToMarkdown(sections);
  assertHasText(markdown);
  return {
    provider: "xlsx",
    status: "complete",
    markdown,
    warnings: [],
    durationMs: Date.now() - started,
    sections,
    metrics: {
      ...baseMetrics(bytes, markdown, sections),
      sheets: visibleWorksheets.length,
      nonEmptyCells,
    },
  };
}

function extractHtml(bytes: Uint8Array, started: number): DocumentTextExtraction {
  const markdown = normalize(NodeHtmlMarkdown.translate(stripUnsafeHtml(decoder.decode(bytes))));
  assertHasText(markdown);
  const sections = markdownSections(markdown);
  return {
    provider: "html",
    status: "complete",
    markdown,
    warnings: [],
    durationMs: Date.now() - started,
    sections,
    metrics: baseMetrics(bytes, markdown, sections),
  };
}

function extractNativeText(bytes: Uint8Array, extension: string, started: number): DocumentTextExtraction {
  const markdown = normalize(decoder.decode(bytes));
  assertHasText(markdown);
  const sections = extension === ".md" ? markdownSections(markdown) : [{ locator: "section:1", title: null, content: markdown }];
  return {
    provider: "text",
    status: "complete",
    markdown,
    warnings: [],
    durationMs: Date.now() - started,
    sections,
    metrics: baseMetrics(bytes, markdown, sections),
  };
}

function readOfficeArchive(bytes: Uint8Array, requiredPath: string): Unzipped {
  rejectEncryptedZip(bytes);
  let entries = 0;
  let expandedBytes = 0;
  let archive: Unzipped;
  try {
    archive = unzipSync(bytes, {
      filter(info: UnzipFileInfo) {
        entries += 1;
        expandedBytes += info.originalSize;
        if (entries > MAX_ARCHIVE_ENTRIES || expandedBytes > MAX_ARCHIVE_BYTES) {
          throw new Error("DOCUMENT_CONTENT_LIMIT_EXCEEDED");
        }
        if (info.originalSize > 0 && info.originalSize / Math.max(1, info.size) > MAX_COMPRESSION_RATIO) {
          throw new Error("DOCUMENT_CONTENT_LIMIT_EXCEEDED");
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("DOCUMENT_")) throw error;
    throw new Error("DOCUMENT_FORMAT_INVALID");
  }
  if (!archive["[Content_Types].xml"] || !archive[requiredPath]) throw new Error("DOCUMENT_FORMAT_INVALID");
  return archive;
}

function rejectEncryptedZip(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 30 <= bytes.byteLength; offset += 1) {
    if (view.getUint32(offset, true) !== 0x04034b50) continue;
    const flags = view.getUint16(offset + 6, true);
    if ((flags & 0x1) !== 0) throw new Error("DOCUMENT_ENCRYPTED_UNSUPPORTED");
    const filenameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const compressedSize = view.getUint32(offset + 18, true);
    offset += 29 + filenameLength + extraLength + compressedSize;
  }
}

function presentationSlideOrder(archive: Unzipped): string[] {
  const presentation = parseXml(archive, "ppt/presentation.xml");
  const relationships = relationshipMap(archive, "ppt/_rels/presentation.xml.rels", "ppt/");
  const ids = collectAttributeValues(presentation, "sldId", "r:id");
  return ids.map((id) => relationships.get(id)).filter((path): path is string => Boolean(path));
}

function notesPathForSlide(archive: Unzipped, slidePath: string): string | null {
  const slash = slidePath.lastIndexOf("/");
  const directory = slidePath.slice(0, slash + 1);
  const basename = slidePath.slice(slash + 1);
  const relationshipsPath = `${directory}_rels/${basename}.rels`;
  const relationships = relationshipMap(archive, relationshipsPath, directory);
  for (const [id, target] of relationships) {
    const xml = decoder.decode(archive[relationshipsPath] ?? new Uint8Array());
    if (new RegExp(`Id=["']${escapeRegExp(id)}["'][^>]+Type=["'][^"']+/notesSlide["']`).test(xml)) return target;
  }
  return null;
}

function relationshipMap(archive: Unzipped, path: string, base: string): Map<string, string> {
  const xml = archive[path];
  if (!xml) return new Map();
  const document = parseXml(archive, path);
  const relationships = collectNodes(document, "Relationship");
  return new Map(relationships.map((relationship) => [
    String(relationship["@_Id"] ?? ""),
    normalizeZipPath(base, String(relationship["@_Target"] ?? "")),
  ]));
}

function parseXml(archive: Unzipped, path: string): unknown {
  const bytes = archive[path];
  if (!bytes) throw new Error("DOCUMENT_FORMAT_INVALID");
  try {
    return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(decoder.decode(bytes));
  } catch {
    throw new Error("DOCUMENT_FORMAT_INVALID");
  }
}

function collectNodes(value: unknown, localName: string): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  const result: Record<string, unknown>[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key.split(":").at(-1) === localName) {
      for (const item of Array.isArray(child) ? child : [child]) {
        if (item && typeof item === "object") result.push(item as Record<string, unknown>);
      }
    }
    result.push(...collectNodes(child, localName));
  }
  return result;
}

function collectAttributeValues(value: unknown, localName: string, attribute: string): string[] {
  return collectNodes(value, localName)
    .map((node) => node[`@_${attribute}`])
    .filter((item): item is string => typeof item === "string");
}

function extractOfficeText(xml: string): string[] {
  const document = new XMLParser({ ignoreAttributes: false, trimValues: true }).parse(xml);
  return collectTextNodes(document, "t").map(normalize).filter(Boolean);
}

function collectTextNodes(value: unknown, localName: string): string[] {
  if (typeof value === "string" || typeof value === "number") return [];
  if (!value || typeof value !== "object") return [];
  const result: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key.split(":").at(-1) === localName) {
      for (const item of Array.isArray(child) ? child : [child]) {
        if (typeof item === "string" || typeof item === "number") result.push(String(item));
        else if (item && typeof item === "object" && "#text" in item) result.push(String((item as Record<string, unknown>)["#text"]));
      }
    } else {
      result.push(...collectTextNodes(child, localName));
    }
  }
  return result;
}

function markdownSections(markdown: string): DocumentExtractionSection[] {
  const parts = markdown.split(/(?=^#{1,6}\s+)/m).filter((part) => part.trim());
  return parts.map((content, index) => ({
    locator: `section:${index + 1}`,
    title: content.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() ?? null,
    content: normalize(content),
  }));
}

function sectionsToMarkdown(sections: readonly DocumentExtractionSection[]): string {
  return normalize(sections.map((section) => {
    const heading = section.title ? `## ${section.title}` : `## ${section.locator}`;
    return `${heading}\n\n<!-- ${section.locator} -->\n\n${section.content}`;
  }).join("\n\n"));
}

function spreadsheetCellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("formula" in value) {
      const formula = String(value.formula);
      return value.result === null || value.result === undefined ? `=${formula}` : spreadsheetCellText(value.result);
    }
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return String(value.text);
    if ("error" in value) return String(value.error);
  }
  return String(value);
}

function spreadsheetMarkdown(rows: readonly { row: number; values: Map<number, string> }[], min: number, max: number): string {
  const header = Array.from({ length: max - min + 1 }, (_, index) => columnName(min + index));
  const lines = [
    `| Ligne | ${header.join(" | ")} |`,
    `| --- | ${header.map(() => "---").join(" | ")} |`,
  ];
  for (const row of rows) {
    const values = header.map((_, index) => escapeTableCell(row.values.get(min + index) ?? ""));
    lines.push(`| ${row.row} | ${values.join(" | ")} |`);
  }
  return lines.join("\n");
}

function columnName(column: number): string {
  let result = "";
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) {
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  }
  return result;
}

function normalizeZipPath(base: string, target: string): string {
  const parts = `${base}${target}`.split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  return normalized.join("/");
}

function stripUnsafeHtml(value: string): string {
  const root = parse(value, {
    comment: false,
    blockTextElements: { script: false, style: false, pre: true },
  });
  for (const element of root.querySelectorAll("script,style,iframe,object,embed,svg,math,template")) {
    element.remove();
  }
  for (const element of root.querySelectorAll("*")) {
    for (const [name, rawValue] of Object.entries(element.attributes)) {
      const attribute = name.toLowerCase();
      if (attribute.startsWith("on") || attribute === "style") {
        element.removeAttribute(name);
        continue;
      }
      if (["href", "src", "xlink:href", "formaction"].includes(attribute)) {
        const normalized = rawValue.replace(/[\u0000-\u0020\u007f]+/g, "").toLowerCase();
        if (/^(javascript|data|vbscript):/.test(normalized)) element.removeAttribute(name);
      }
    }
  }
  return root.toString();
}

function baseMetrics(bytes: Uint8Array, markdown: string, sections: readonly DocumentExtractionSection[]) {
  return { bytes: bytes.byteLength, characters: visibleText(markdown).length, sections: sections.length };
}

function validateOutput(extraction: DocumentTextExtraction): void {
  if (new TextEncoder().encode(JSON.stringify(extraction)).byteLength > MAX_OUTPUT_BYTES) {
    throw new Error("DOCUMENT_CONTENT_LIMIT_EXCEEDED");
  }
  if (extraction.status !== "ocr_required") assertHasText(extraction.markdown);
}

function assertHasText(value: string): void {
  if (!visibleText(value)) throw new Error("DOCUMENT_TEXT_EMPTY");
}

function visibleText(value: string): string {
  return stripHtmlComments(value).replace(/[#|*_`\s-]+/g, " ").trim();
}

function stripHtmlComments(value: string): string {
  let output = "";
  let offset = 0;
  while (offset < value.length) {
    const start = value.indexOf("<!--", offset);
    if (start === -1) return output + value.slice(offset);
    output += value.slice(offset, start);
    const end = value.indexOf("-->", start + 4);
    if (end === -1) return output;
    offset = end + 3;
  }
  return output;
}

function normalize(value: string): string {
  return value.replace(/\u0000/g, "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function escapeTableCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r\n?|\n/g, "<br>");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPasswordError(error: unknown): boolean {
  return /password|encrypted/i.test(error instanceof Error ? error.message : String(error));
}

function normalizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^DOCUMENT_[A-Z0-9_]+$/.test(message) || message === "UNSUPPORTED_DOCUMENT_TYPE"
    ? message
    : "DOCUMENT_FORMAT_INVALID";
}

async function emit(value: unknown): Promise<void> {
  await Bun.write(Bun.stdout, JSON.stringify(value));
}
