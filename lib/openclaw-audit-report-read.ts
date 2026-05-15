import fs from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { getOpenclawAuditReportsDir } from "@/lib/openclaw-trace-exports";

/**
 * Read and parse workflow audit Markdown under `trace-exports/reports/` (`task_*.md` and overview
 * files). Produced by the trace-export audit tooling in this repo. Writer pre-check reuses this for
 * prior-audit columns (`lib/openclaw-writer-precheck-prior-audit.ts`).
 */
export type AuditReportFileInfo = {
  fileName: string;
  fullPath: string;
  mtimeMs: number;
};

export type AuditReportMeta = Record<string, string>;

/** Safe filename: only *.md under reports dir, no path segments. */
export function sanitizeAuditReportFileName(name: string): string | null {
  const base = path.basename(name.trim());
  if (!base.endsWith(".md") || base.includes("..") || base !== name.trim()) {
    return null;
  }
  if (!/^task_[A-Za-z0-9_.-]+\.md$/.test(base)) {
    return null;
  }
  return base;
}

/** Aggregated markdown for all task audit reports (not a per-task file). */
export const OPENCLAW_AUDIT_OVERVIEW_BASENAME = "openclaw_audit_overview.md";

/** Deletes every `task_*.md` audit report in the reports directory. Returns how many files were removed. */
export async function removeAllAuditReportMarkdownFiles(
  reportsDir = getOpenclawAuditReportsDir(),
): Promise<number> {
  if (!fs.existsSync(reportsDir)) {
    return 0;
  }
  const names = await readdir(reportsDir);
  let removed = 0;
  for (const name of names) {
    if (!sanitizeAuditReportFileName(name)) continue;
    await unlink(path.join(reportsDir, name));
    removed++;
  }
  return removed;
}

export function listAuditReportFiles(): AuditReportFileInfo[] {
  const dir = getOpenclawAuditReportsDir();
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((f) => sanitizeAuditReportFileName(f) !== null)
    .map((fileName) => {
      const fullPath = path.join(dir, fileName);
      const st = fs.statSync(fullPath);
      return { fileName, fullPath, mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function parseAuditReportMarkdown(fullText: string): {
  meta: AuditReportMeta;
  body: string;
} {
  if (!fullText.startsWith("---\n")) {
    return { meta: {}, body: fullText };
  }
  const parts = fullText.split("---\n");
  if (parts.length < 3) {
    return { meta: {}, body: fullText };
  }
  const meta: AuditReportMeta = {};
  for (const line of parts[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    meta[k] = v;
  }
  const body = parts.slice(2).join("---\n").trimStart();
  return { meta, body };
}

export function readAuditReportFile(
  fileName: string,
): { fileName: string; raw: string; meta: AuditReportMeta; bodyMarkdown: string; mtimeMs: number } | null {
  const safe = sanitizeAuditReportFileName(fileName);
  if (!safe) return null;
  const dir = getOpenclawAuditReportsDir();
  const fullPath = path.join(dir, safe);
  if (!fs.existsSync(fullPath)) return null;
  const st = fs.statSync(fullPath);
  const raw = fs.readFileSync(fullPath, "utf8");
  const { meta, body } = parseAuditReportMarkdown(raw);
  return {
    fileName: safe,
    raw,
    meta,
    bodyMarkdown: body,
    mtimeMs: st.mtimeMs,
  };
}

export function readLatestAuditReport(): {
  fileName: string;
  raw: string;
  meta: AuditReportMeta;
  bodyMarkdown: string;
  mtimeMs: number;
} | null {
  const files = listAuditReportFiles();
  if (!files.length) return null;
  const first = files[0];
  const raw = fs.readFileSync(first.fullPath, "utf8");
  const { meta, body } = parseAuditReportMarkdown(raw);
  return {
    fileName: first.fileName,
    raw,
    meta,
    bodyMarkdown: body,
    mtimeMs: first.mtimeMs,
  };
}

/** Matches audit_trace_workflow_steps.extract_verdict + ERROR line variant. */
export type AuditVerdict = "PASS" | "FAIL" | "CONDITIONAL" | "UNKNOWN" | "ERROR";

export function extractAuditVerdictFromMarkdown(fullText: string): AuditVerdict {
  if (!fullText.includes("## Verdict")) return "UNKNOWN";
  const parts = fullText.split("## Verdict");
  const tail = parts[parts.length - 1]?.trim() ?? "";
  const section = tail.slice(0, 300).replace(/[*_`]/g, "").toUpperCase();
  if (section.startsWith("CONDITIONAL")) return "CONDITIONAL";
  if (section.startsWith("PASS")) return "PASS";
  if (section.startsWith("FAIL")) return "FAIL";
  if (section.startsWith("ERROR")) return "ERROR";
  return "UNKNOWN";
}

export type AuditReportsSummary = {
  total: number;
  byVerdict: Record<AuditVerdict, number>;
  newest: {
    fileName: string;
    modifiedAt: string;
    verdict: AuditVerdict;
  } | null;
};

/** Aggregate verdict counts across all saved task_*.md reports (newest file first in listing). */
export function summarizeAuditReports(): AuditReportsSummary {
  const verdictOrder: AuditVerdict[] = [
    "PASS",
    "CONDITIONAL",
    "FAIL",
    "UNKNOWN",
    "ERROR",
  ];
  const byVerdict = Object.fromEntries(
    verdictOrder.map((v) => [v, 0]),
  ) as Record<AuditVerdict, number>;

  const infos = listAuditReportFiles();
  let newest: AuditReportsSummary["newest"] = null;

  for (let i = 0; i < infos.length; i++) {
    const info = infos[i];
    const data = readAuditReportFile(info.fileName);
    if (!data) continue;
    const v = extractAuditVerdictFromMarkdown(data.raw);
    byVerdict[v]++;
    if (i === 0) {
      newest = {
        fileName: info.fileName,
        modifiedAt: new Date(info.mtimeMs).toISOString(),
        verdict: v,
      };
    }
  }

  return { total: infos.length, byVerdict, newest };
}

function escapeMdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

const OVERVIEW_VERDICT_SORT: Record<AuditVerdict, number> = {
  FAIL: 0,
  ERROR: 1,
  CONDITIONAL: 2,
  UNKNOWN: 3,
  PASS: 4,
};

/** Build markdown overview from current `task_*.md` files on disk. */
export function buildAuditOverviewMarkdown(
  generatedAt: Date = new Date(),
): string {
  const infos = listAuditReportFiles();
  const rows: {
    fileName: string;
    taskKey: string;
    world: string;
    steps: string;
    auditedAt: string;
    verdict: AuditVerdict;
    promptExcerpt: string;
  }[] = [];

  const byVerdict: Record<AuditVerdict, number> = {
    PASS: 0,
    CONDITIONAL: 0,
    FAIL: 0,
    UNKNOWN: 0,
    ERROR: 0,
  };

  for (const info of infos) {
    const data = readAuditReportFile(info.fileName);
    if (!data) continue;
    const verdict = extractAuditVerdictFromMarkdown(data.raw);
    byVerdict[verdict]++;
    const m = data.meta;
    rows.push({
      fileName: data.fileName,
      taskKey: m.task_key ?? data.fileName.replace(/\.md$/, ""),
      world: m.target_world ?? "",
      steps: m.num_steps ?? "",
      auditedAt: m.audited_at ?? "",
      verdict,
      promptExcerpt: (m.prompt ?? "").slice(0, 120),
    });
  }

  rows.sort((a, b) => {
    const dv = OVERVIEW_VERDICT_SORT[a.verdict] - OVERVIEW_VERDICT_SORT[b.verdict];
    if (dv !== 0) return dv;
    return a.taskKey.localeCompare(b.taskKey);
  });

  const iso = generatedAt.toISOString();

  const lines: string[] = [
    "---",
    `generated_at: ${iso}`,
    "kind: openclaw_audit_overview",
    `report_count: ${rows.length}`,
    "---",
    "",
    "# OpenClaw audit — overview",
    "",
    `Generated **${iso}** from \`task_*.md\` in this reports directory.`,
    "",
    "## Summary",
    "",
    "| Verdict | Count |",
    "| --- | ---: |",
  ];

  for (const v of [
    "PASS",
    "CONDITIONAL",
    "FAIL",
    "UNKNOWN",
    "ERROR",
  ] as AuditVerdict[]) {
    lines.push(`| ${v} | ${byVerdict[v]} |`);
  }
  lines.push(`| **Total** | **${rows.length}** |`, "", "## Task index", "");

  if (rows.length === 0) {
    lines.push("*No task audit reports on disk yet.*", "");
  } else {
    lines.push(
      "| Verdict | Task | World | Steps | Audited (UTC) | Report file |",
      "| --- | --- | --- | ---: | --- | --- |",
    );
    for (const r of rows) {
      lines.push(
        `| ${r.verdict} | \`${escapeMdCell(r.taskKey)}\` | ${escapeMdCell(r.world)} | ${escapeMdCell(r.steps)} | ${escapeMdCell(r.auditedAt)} | \`${escapeMdCell(r.fileName)}\` |`,
      );
    }
    lines.push(
      "",
      "## Prompt excerpts",
      "",
      "| Task | Prompt (frontmatter, truncated) |",
      "| --- | --- |",
    );
    for (const r of rows) {
      const ex =
        r.promptExcerpt.length >= 120 ? `${r.promptExcerpt}…` : r.promptExcerpt;
      lines.push(`| \`${escapeMdCell(r.taskKey)}\` | ${escapeMdCell(ex)} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function writeAuditOverviewReport(
  reportsDir = getOpenclawAuditReportsDir(),
  generatedAt: Date = new Date(),
): { fullPath: string; byteLength: number } {
  const body = buildAuditOverviewMarkdown(generatedAt);
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  const fullPath = path.join(reportsDir, OPENCLAW_AUDIT_OVERVIEW_BASENAME);
  fs.writeFileSync(fullPath, body, "utf8");
  return { fullPath, byteLength: Buffer.byteLength(body, "utf8") };
}
