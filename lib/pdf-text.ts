import { PDFParse } from "pdf-parse";

/** Reasonable cap for rubric PDFs (memory + parse time). */
export const MAX_GUIDELINE_PDF_BYTES = 15 * 1024 * 1024;

export const MIN_GUIDELINE_EXTRACTED_CHARS = 24;

export function normalizeExtractedPdfText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function defaultGuidelineNameFromPdfFilename(filename: string): string {
  const base = filename.replace(/\.pdf$/i, "").trim() || "Imported rubric";
  if (base.length > 200) return `${base.slice(0, 197)}…`;
  return base;
}

/**
 * Extract plain text from a PDF buffer (Node / App Route only).
 */
export async function extractTextFromPdfBuffer(
  buffer: Buffer,
): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return normalizeExtractedPdfText(result.text ?? "");
  } finally {
    try {
      await parser.destroy();
    } catch {
      /* ignore */
    }
  }
}
