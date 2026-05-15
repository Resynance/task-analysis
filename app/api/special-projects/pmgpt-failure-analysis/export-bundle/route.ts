import { NextResponse } from "next/server";
import { buildPmgptFailureReportsZip } from "@/lib/pmgpt-failure-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await buildPmgptFailureReportsZip();
  if (!result) {
    return NextResponse.json(
      {
        error:
          "No report markdown files found. Generate at least one per-task report (or the cross-task summary) first.",
      },
      { status: 404 },
    );
  }

  const copy = new Uint8Array(result.buffer.length);
  copy.set(result.buffer);
  const body = copy.buffer.slice(
    copy.byteOffset,
    copy.byteOffset + copy.byteLength,
  );
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "X-Bundle-File-Count": String(result.fileCount),
    },
  });
}
