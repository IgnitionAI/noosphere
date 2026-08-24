import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { strToU8, zipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";

type Fixture = { name: string; contentType: string; bytes: Uint8Array };

const directory = await mkdtemp(join(tmpdir(), "noosphere-extraction-benchmark-"));
const processPath = resolve(process.cwd(), "dist/document-extractor/document-extractor-process.js");

try {
  const fixtures = await createFixtures();
  const results = [];
  for (const fixture of fixtures) {
    const inputPath = join(directory, fixture.name);
    await writeFile(inputPath, fixture.bytes);
    const started = performance.now();
    const child = Bun.spawn([
      Bun.which("bun") ?? process.execPath,
      processPath,
      inputPath,
      fixture.name,
      fixture.contentType,
    ], { stdout: "pipe", stderr: "pipe", env: {} });
    let peakRssKiB = 0;
    const sampler = setInterval(async () => {
      try {
        const sample = Bun.spawn(["ps", "-o", "rss=", "-p", String(child.pid)], { stdout: "pipe", stderr: "ignore" });
        const rss = Number.parseInt((await new Response(sample.stdout).text()).trim(), 10);
        if (Number.isFinite(rss)) peakRssKiB = Math.max(peakRssKiB, rss);
      } catch {
        // A short extraction may finish between samples.
      }
    }, 5);
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    clearInterval(sampler);
    if (exitCode !== 0) throw new Error(`${fixture.name}: ${stderr || stdout}`);
    const envelope = JSON.parse(stdout) as { extraction: { provider: string; status: string; metrics: unknown } };
    results.push({
      fixture: fixture.name,
      bytes: fixture.bytes.byteLength,
      provider: envelope.extraction.provider,
      status: envelope.extraction.status,
      durationMs: Math.round(performance.now() - started),
      peakRssMiB: Math.round((peakRssKiB / 1024) * 10) / 10,
      metrics: envelope.extraction.metrics,
    });
  }
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    runtime: `Bun ${Bun.version}`,
    concurrency: 1,
    results,
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function createFixtures(): Promise<Fixture[]> {
  return [
    { name: "benchmark.pdf", contentType: "application/pdf", bytes: await createPdf() },
    { name: "benchmark.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: createDocx() },
    { name: "benchmark.pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes: createPptx() },
    { name: "benchmark.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: await createXlsx() },
  ];
}

async function createPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let pageNumber = 1; pageNumber <= 20; pageNumber += 1) {
    pdf.addPage().drawText(`Page ${pageNumber}: preuve produit, segment, objection et proposition de valeur Noosphere.`, { x: 40, y: 700, font });
  }
  return pdf.save();
}

function createDocx(): Uint8Array {
  const paragraphs = Array.from({ length: 250 }, (_, index) => `<w:p><w:r><w:t>Paragraphe ${index + 1}: contexte produit et preuve exploitable.</w:t></w:r></w:p>`).join("");
  return zipSync({
    "[Content_Types].xml": strToU8("<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>"),
    "_rels/.rels": strToU8("<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>"),
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`),
  });
}

function createPptx(): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8("<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/></Types>"),
  };
  const ids: string[] = [];
  const relationships: string[] = [];
  for (let index = 1; index <= 30; index += 1) {
    ids.push(`<p:sldId id="${255 + index}" r:id="rId${index}"/>`);
    relationships.push(`<Relationship Id="rId${index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index}.xml"/>`);
    files[`ppt/slides/slide${index}.xml`] = strToU8(`<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide ${index}: résultat, preuve et prochaine action.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  }
  files["ppt/presentation.xml"] = strToU8(`<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${ids.join("")}</p:sldIdLst></p:presentation>`);
  files["ppt/_rels/presentation.xml.rels"] = strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join("")}</Relationships>`);
  return zipSync(files);
}

async function createXlsx(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  for (let sheetNumber = 1; sheetNumber <= 5; sheetNumber += 1) {
    const sheet = workbook.addWorksheet(`Segment ${sheetNumber}`);
    sheet.addRow(["Entreprise", "Score", "Projection"]);
    for (let row = 1; row <= 2_000; row += 1) {
      sheet.addRow([`Compte ${row}`, row % 100, { formula: `B${row + 1}*2`, result: (row % 100) * 2 }]);
    }
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
