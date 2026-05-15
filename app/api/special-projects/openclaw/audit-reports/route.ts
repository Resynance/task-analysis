import JSZip from "jszip";
import { NextResponse } from "next/server";
import {
  buildAuditOverviewMarkdown,
  listAuditReportFiles,
  OPENCLAW_AUDIT_OVERVIEW_BASENAME,
  readAuditReportFile,
  readLatestAuditReport,
  summarizeAuditReports,
} from "@/lib/openclaw-audit-report-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — JSON list + latest preview (default, no query).
 * GET ?summary=1 — { total, byVerdict, newest } for all saved reports.
 * GET ?file=task_….md — JSON for one report (body markdown).
 * GET ?file=…&download=1 — attachment: raw .md (full frontmatter + body).
 * GET ?export=zip — attachment: all report .md files in one zip.
 * GET ?overview=1 — JSON { markdown, generatedAt } (built from current task reports).
 * GET ?overview=1&download=1 — attachment openclaw_audit_overview.md
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  if (url.searchParams.get("overview") === "1") {
    const generatedAt = new Date();
    const markdown = buildAuditOverviewMarkdown(generatedAt);
    if (url.searchParams.get("download") === "1") {
      return new NextResponse(markdown, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${OPENCLAW_AUDIT_OVERVIEW_BASENAME}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json({
      markdown,
      generatedAt: generatedAt.toISOString(),
    });
  }

  if (url.searchParams.get("summary") === "1") {
    return NextResponse.json(summarizeAuditReports());
  }

  if (url.searchParams.get("export") === "zip") {
    const infos = listAuditReportFiles();
    if (!infos.length) {
      return NextResponse.json(
        { error: "No reports to export." },
        { status: 404 },
      );
    }
    const zip = new JSZip();
    for (const info of infos) {
      const data = readAuditReportFile(info.fileName);
      if (data) {
        zip.file(data.fileName, data.raw);
      }
    }
    const overviewMd = buildAuditOverviewMarkdown();
    zip.file(OPENCLAW_AUDIT_OVERVIEW_BASENAME, overviewMd);
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    return new NextResponse(Buffer.from(buf), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="openclaw-audit-reports.zip"',
        "Cache-Control": "no-store",
      },
    });
  }

  const wantFile = url.searchParams.get("file")?.trim();
  const wantDownload = url.searchParams.get("download") === "1";

  if (wantFile && wantDownload) {
    const data = readAuditReportFile(wantFile);
    if (!data) {
      return NextResponse.json({ error: "Report not found." }, { status: 404 });
    }
    return new NextResponse(data.raw, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${data.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (wantFile) {
    const data = readAuditReportFile(wantFile);
    if (!data) {
      return NextResponse.json({ error: "Report not found." }, { status: 404 });
    }
    return NextResponse.json({
      fileName: data.fileName,
      modifiedAt: new Date(data.mtimeMs).toISOString(),
      meta: data.meta,
      markdown: data.bodyMarkdown,
    });
  }

  const data = readLatestAuditReport();
  if (!data) {
    return NextResponse.json({
      latest: null,
      files: listAuditReportFiles().map((f) => ({
        fileName: f.fileName,
        modifiedAt: new Date(f.mtimeMs).toISOString(),
      })),
    });
  }

  return NextResponse.json({
    latest: {
      fileName: data.fileName,
      modifiedAt: new Date(data.mtimeMs).toISOString(),
      meta: data.meta,
      markdown: data.bodyMarkdown,
    },
    files: listAuditReportFiles().map((f) => ({
      fileName: f.fileName,
      modifiedAt: new Date(f.mtimeMs).toISOString(),
    })),
  });
}
