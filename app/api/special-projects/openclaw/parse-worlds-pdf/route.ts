import { NextResponse } from "next/server";
import {
  extractTextFromPdfBuffer,
  MAX_GUIDELINE_PDF_BYTES,
} from "@/lib/pdf-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPdfFile(file: File): boolean {
  const t = file.type.toLowerCase();
  if (t === "application/pdf" || t === "application/x-pdf") return true;
  return /\.pdf$/i.test(file.name);
}

export async function POST(request: Request) {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Expected multipart/form-data with field \"file\" (PDF)." },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const fileEntry = form.get("file");
  if (!(fileEntry instanceof File)) {
    return NextResponse.json(
      { error: "Missing PDF file. Use form field name \"file\"." },
      { status: 400 },
    );
  }

  if (!isPdfFile(fileEntry)) {
    return NextResponse.json({ error: "Only PDF files are supported." }, { status: 400 });
  }

  if (fileEntry.size > MAX_GUIDELINE_PDF_BYTES) {
    return NextResponse.json(
      {
        error: `PDF is too large (max ${Math.round(MAX_GUIDELINE_PDF_BYTES / (1024 * 1024))} MB).`,
      },
      { status: 400 },
    );
  }

  try {
    const buf = Buffer.from(await fileEntry.arrayBuffer());
    const text = await extractTextFromPdfBuffer(buf);
    return NextResponse.json({
      filename: fileEntry.name,
      text,
      charCount: text.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to read PDF";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
