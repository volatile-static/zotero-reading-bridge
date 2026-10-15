/**
 * Generates the tiny, valid, text-only PDF used as the stored and linked fixture attachments.
 *
 * ASCII only (standard Helvetica, WinAnsi) so the file needs no embedded fonts, and PDF.js can extract
 * the text layer the reader-selection tests rely on. Page labels start at PDF_FIRST_PAGE_LABEL.
 */
import { PDF_FIRST_PAGE_LABEL, PDF_PAGES } from "./data.js";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const FONT_SIZE = 14;
const LINE_HEIGHT = 24;
const TOP_BASELINE = 720;

function escapePdfText(text: string): string {
  if (!/^[\x20-\x7e]*$/.test(text)) {
    throw new Error(`Fixture PDF text must be printable ASCII: ${JSON.stringify(text)}`);
  }
  return text.replace(/[\\()]/g, (ch) => `\\${ch}`);
}

function contentStream(lines: readonly string[]): string {
  const ops = [`BT /F1 ${FONT_SIZE} Tf ${LINE_HEIGHT} TL 72 ${TOP_BASELINE} Td`];
  lines.forEach((line, index) => {
    ops.push(`${index === 0 ? "" : "T* "}(${escapePdfText(line)}) Tj`);
  });
  ops.push("ET");
  return ops.join("\n");
}

/** Build the PDF bytes. Object numbers: 1 catalog, 2 pages, 3 font, 4 info, then page/content pairs. */
export function buildFixturePdf(pages: readonly (readonly string[])[] = PDF_PAGES): Uint8Array {
  const objects: string[] = [];
  const pageObjectNumbers = pages.map((_, index) => 5 + index * 2);
  objects[1] =
    `<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /D /St ${PDF_FIRST_PAGE_LABEL} >>] >> >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Title (Zotero AI Bridge fixture) /Producer (zab-harness) >>";
  pages.forEach((lines, index) => {
    const pageNumber = 5 + index * 2;
    const stream = contentStream(lines);
    objects[pageNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageNumber + 1} 0 R >>`;
    objects[pageNumber + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  // Offsets are byte offsets; everything is ASCII, so string length equals byte length.
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = out.length;
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xrefOffset = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objects.length; n++) {
    out += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** Text of a page as the reader's text layer is expected to expose it (lines joined by spaces). */
export function pageText(pageIndex: number): string {
  return (PDF_PAGES[pageIndex] ?? []).join(" ");
}
