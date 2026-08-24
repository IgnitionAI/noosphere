import { describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { zipSync, strToU8 } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { StructuredDocumentTextExtractor } from "@outbound/infrastructure/documents/structured-document-text-extractor";
import { documentChunksForExtraction } from "@outbound/infrastructure/documents/research-document-service";

const extractor = new StructuredDocumentTextExtractor();

describe("structured document text extractor", () => {
  test("extracts native HTML as structured Markdown without active content", async () => {
    const result = await extractor.extract({
      filename: "brief.html",
      contentType: "text/html",
      bytes: new TextEncoder().encode("<h1>Produit</h1><script>ignore()</script><p>Recherche &amp; preuve</p>"),
    });
    expect(result.provider).toBe("html");
    expect(result.status).toBe("complete");
    expect(result.markdown).toContain("# Produit");
    expect(result.markdown).toContain("Recherche & preuve");
    expect(result.markdown).not.toContain("ignore");
    expect(result.sections[0]?.locator).toBe("section:1");
  });

  test("preserves physical PDF pages and marks image-only PDFs for OCR", async () => {
    const textPdf = await createTextPdf();
    const text = await extractor.extract({ filename: "offre.pdf", contentType: "application/pdf", bytes: textPdf });
    expect(text.provider).toBe("unpdf");
    expect(text.status).toBe("complete");
    expect(text.metrics.bytes).toBe(textPdf.byteLength);
    expect(text.metrics.pages).toBe(2);
    expect(text.sections.map((section) => section.locator)).toEqual(["page:1", "page:2"]);
    expect(text.markdown).toContain("Preuve produit page une");
    expect(documentChunksForExtraction(text).map((chunk) => chunk.locator)).toEqual(["page:1", "page:2"]);

    const scan = await extractor.extract({ filename: "scan.pdf", contentType: "application/pdf", bytes: await createImageOnlyPdf() });
    expect(scan.status).toBe("ocr_required");
    expect(scan.warnings).toContain("DOCUMENT_OCR_REQUIRED");
    expect(documentChunksForExtraction(scan)).toEqual([]);
  });

  test("extracts DOCX headings, lists and tables through semantic HTML", async () => {
    const result = await extractor.extract({
      filename: "offre.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: createDocx(),
    });
    expect(result.provider).toBe("docx");
    expect(result.markdown).toContain("# Offre Noosphere");
    expect(result.markdown).toContain("Segment juridique");
    expect(result.markdown).toContain("Cabinets");
    expect(result.sections[0]?.locator).toBe("section:1");
  });

  test("extracts PPTX in presentation order with speaker notes", async () => {
    const result = await extractor.extract({
      filename: "deck.pptx",
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      bytes: createPptx(),
    });
    expect(result.provider).toBe("pptx");
    expect(result.sections.map((section) => section.locator)).toEqual(["slide:1", "slide:2"]);
    expect(result.sections[0]?.content).toContain("Deuxième slide dans le ZIP");
    expect(result.sections[0]?.content).toContain("Note confidentielle de présentation");
    expect(result.sections[1]?.content).toContain("Première slide dans le ZIP");
  });

  test("extracts visible XLSX sheets and uses cached formula values", async () => {
    const workbook = new ExcelJS.Workbook();
    const visible = workbook.addWorksheet("Pipeline");
    visible.addRow(["Compte", "MRR"]);
    visible.addRow(["Cabinet A", 1200]);
    visible.getCell("C2").value = { formula: "B2*2", result: 2400 };
    const hidden = workbook.addWorksheet("Interne");
    hidden.state = "hidden";
    hidden.addRow(["secret"]);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    const result = await extractor.extract({
      filename: "pipeline.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes,
    });
    expect(result.provider).toBe("xlsx");
    expect(result.metrics.sheets).toBe(1);
    expect(result.metrics.nonEmptyCells).toBe(5);
    expect(result.sections[0]?.locator).toBe("sheet:Pipeline!A1:C2");
    expect(result.markdown).toContain("2400");
    expect(result.markdown).not.toContain("secret");
  });

  test("rejects corrupted and encrypted Office archives explicitly", async () => {
    await expect(extractor.extract({
      filename: "broken.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]),
    })).rejects.toThrow("DOCUMENT_FORMAT_INVALID");

    const encrypted = createDocx();
    encrypted[6] = (encrypted[6] ?? 0) | 0x1;
    await expect(extractor.extract({
      filename: "encrypted.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: encrypted,
    })).rejects.toThrow("DOCUMENT_ENCRYPTED_UNSUPPORTED");

    const compressedBomb = zipSync({
      "[Content_Types].xml": strToU8("x".repeat(2 * 1024 * 1024)),
      "word/document.xml": strToU8("<w:document/>"),
    }, { level: 9 });
    await expect(extractor.extract({
      filename: "bomb.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: compressedBomb,
    })).rejects.toThrow("DOCUMENT_CONTENT_LIMIT_EXCEEDED");
  });

  test("rejects an XLSX exceeding the non-empty cell budget", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Trop volumineux");
    const row = Array.from({ length: 300 }, (_, index) => `valeur-${index + 1}`);
    for (let index = 0; index < 334; index += 1) sheet.addRow(row);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    await expect(extractor.extract({
      filename: "oversized.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes,
    })).rejects.toThrow("DOCUMENT_CONTENT_LIMIT_EXCEEDED");
  });

  test("kills a transient parser on timeout or cancellation", async () => {
    const processPath = new URL("../fixtures/document-extractor-hang.ts", import.meta.url).pathname;
    const timeoutExtractor = new StructuredDocumentTextExtractor({ processPath, timeoutMs: 25 });
    await expect(timeoutExtractor.extract({
      filename: "brief.txt",
      contentType: "text/plain",
      bytes: new TextEncoder().encode("contenu test"),
    })).rejects.toThrow("DOCUMENT_EXTRACTION_TIMEOUT");

    const controller = new AbortController();
    const pending = new StructuredDocumentTextExtractor({ processPath, timeoutMs: 5_000 }).extract({
      filename: "brief.txt",
      contentType: "text/plain",
      bytes: new TextEncoder().encode("contenu test"),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 25);
    await expect(pending).rejects.toThrow("DOCUMENT_EXTRACTION_CANCELLED");
  });
});

async function createTextPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("Preuve produit page une avec suffisamment de texte exploitable pour la recherche.", { x: 40, y: 700, font });
  pdf.addPage().drawText("Deuxieme page physique avec une autre preuve documentee pour le prospect.", { x: 40, y: 700, font });
  return pdf.save();
}

async function createImageOnlyPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")));
  const page = pdf.addPage();
  page.drawImage(image, { x: 10, y: 10, width: 400, height: 400 });
  return pdf.save();
}

function createDocx(): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8("<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>"),
    "_rels/.rels": strToU8("<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>"),
    "word/document.xml": strToU8("<?xml version=\"1.0\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>Offre Noosphere</w:t></w:r></w:p><w:p><w:r><w:t>Segment juridique</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Marché</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cabinets</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"),
  });
}

function createPptx(): Uint8Array {
  const slide = (text: string) => strToU8(`<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  return zipSync({
    "[Content_Types].xml": strToU8("<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/></Types>"),
    "ppt/presentation.xml": strToU8("<?xml version=\"1.0\"?><p:presentation xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><p:sldIdLst><p:sldId id=\"256\" r:id=\"rId2\"/><p:sldId id=\"257\" r:id=\"rId1\"/></p:sldIdLst></p:presentation>"),
    "ppt/_rels/presentation.xml.rels": strToU8("<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide\" Target=\"slides/slide1.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide\" Target=\"slides/slide2.xml\"/></Relationships>"),
    "ppt/slides/slide1.xml": slide("Première slide dans le ZIP"),
    "ppt/slides/slide2.xml": slide("Deuxième slide dans le ZIP"),
    "ppt/slides/_rels/slide2.xml.rels": strToU8("<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rIdNotes\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide\" Target=\"../notesSlides/notesSlide2.xml\"/></Relationships>"),
    "ppt/notesSlides/notesSlide2.xml": slide("Note confidentielle de présentation"),
  });
}
