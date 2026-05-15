import { NextResponse } from "next/server";
import { z } from "zod";
import { DATASET_IMPORTED_TASKS_GUIDELINE_NAME } from "@/lib/dataset/guideline-names";
import {
  defaultGuidelineNameFromPdfFilename,
  extractTextFromPdfBuffer,
  MAX_GUIDELINE_PDF_BYTES,
  MIN_GUIDELINE_EXTRACTED_CHARS,
} from "@/lib/pdf-text";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(200, "Name is too long");

function isPdfFile(file: File): boolean {
  const t = file.type.toLowerCase();
  if (t === "application/pdf" || t === "application/x-pdf") return true;
  return /\.pdf$/i.test(file.name);
}

export async function POST(request: Request) {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Expected multipart/form-data with a PDF file field named file." },
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
    return NextResponse.json(
      { error: "Only PDF files are supported." },
      { status: 400 },
    );
  }

  if (fileEntry.size > MAX_GUIDELINE_PDF_BYTES) {
    return NextResponse.json(
      {
        error: `PDF is too large (max ${Math.round(MAX_GUIDELINE_PDF_BYTES / (1024 * 1024))} MB).`,
      },
      { status: 400 },
    );
  }

  const nameField = form.get("name");
  let displayName: string;
  if (typeof nameField === "string" && nameField.trim()) {
    const parsed = nameSchema.safeParse(nameField.trim());
    if (!parsed.success) {
      const msg =
        parsed.error.issues[0]?.message ?? "Invalid name.";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    displayName = parsed.data;
  } else {
    displayName = defaultGuidelineNameFromPdfFilename(fileEntry.name);
  }

  if (displayName === DATASET_IMPORTED_TASKS_GUIDELINE_NAME) {
    return NextResponse.json(
      {
        error: `That name is reserved for the system import rubric. Choose another name.`,
      },
      { status: 400 },
    );
  }

  let buffer: Buffer;
  try {
    const ab = await fileEntry.arrayBuffer();
    buffer = Buffer.from(ab);
  } catch {
    return NextResponse.json({ error: "Could not read uploaded file." }, { status: 400 });
  }

  let content: string;
  try {
    content = await extractTextFromPdfBuffer(buffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "PDF parse failed.";
    return NextResponse.json(
      {
        error:
          msg.includes("password") || msg.includes("encrypt")
            ? "This PDF appears encrypted or password-protected; extract text manually instead."
            : `Could not read PDF text: ${msg}`,
      },
      { status: 400 },
    );
  }

  if (content.length < MIN_GUIDELINE_EXTRACTED_CHARS) {
    return NextResponse.json(
      {
        error:
          "Very little text was extracted from this PDF (it may be scan-only or image-based). Add rubric text manually or use an OCR’d PDF.",
      },
      { status: 400 },
    );
  }

  const guideline = await prisma.guideline.create({
    data: { name: displayName, content },
  });

  return NextResponse.json(guideline, { status: 201 });
}
