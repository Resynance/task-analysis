import type { PromptAnalysisProblemArea } from "@/lib/analyze-prompt";
import type { WriterPrecheckPriorAudit } from "@/lib/openclaw-writer-precheck-prior-audit";

/**
 * Printable HTML for the **writer draft pre-check** report (trace-export tooling).
 *
 * `downloadWriterPrecheckPdf` opens this HTML in a new tab and calls `window.print()` so operators
 * can choose **Save as PDF** in the browser — no bundled PDF generator dependency.
 */
export type WriterPrecheckPdfInput = {
  guidelineName: string;
  worldLabel: string;
  userStorySource: string;
  generatedAtIso: string;
  summary: {
    total: number;
    excellent: number;
    average: number;
    poor: number;
    failed: number;
  };
  stoppedEarly?: boolean;
  parseWarnings: string[];
  results: Array<{
    rowIndex: number;
    externalId: string | null;
    writerName: string | null;
    score: string | null;
    rationale: string | null;
    error: string | null;
    problemAreas?: PromptAnalysisProblemArea[];
    priorAudit: WriterPrecheckPriorAudit | null;
  }>;
};

/** Entity-escape dynamic strings embedded in the static report template. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function problemSourceLabel(
  source: PromptAnalysisProblemArea["source"],
): string {
  switch (source) {
    case "prompt":
      return "Prompt";
    case "writer_rubric":
      return "Writer rubric";
    case "guideline_overlap":
      return "Guidelines";
    case "user_story":
      return "World / persona";
    case "notes":
      return "Notes";
    default:
      return "Other";
  }
}

/** Self-contained HTML (inline CSS) for printing or “Save as PDF” from the browser. */
export function buildWriterPrecheckReportHtml(
  input: WriterPrecheckPdfInput,
  docTitle: string,
): string {
  const gen = new Date(input.generatedAtIso);
  const dateStr = Number.isNaN(gen.getTime())
    ? escapeHtml(input.generatedAtIso)
    : escapeHtml(
        gen.toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      );

  const summaryLines = [
    `Guideline: ${escapeHtml(input.guidelineName)}`,
    `World / persona: ${escapeHtml(input.worldLabel || "(none)")}`,
    `User-story source: ${escapeHtml(input.userStorySource)}`,
    `Rows: ${input.summary.total}`,
    `Scores — excellent: ${input.summary.excellent}, average: ${input.summary.average}, poor: ${input.summary.poor}`,
    input.summary.failed > 0
      ? `Errors (LLM / parse): ${input.summary.failed}`
      : null,
  ].filter(Boolean);

  const warningsBlock =
    input.parseWarnings.length > 0
      ? `<h2>CSV parse warnings</h2><ol>${input.parseWarnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ol>`
      : "";

  const stoppedNote = input.stoppedEarly
    ? "<p><strong>Note:</strong> The run was stopped before all rows finished. This report includes only completed rows.</p>"
    : "";

  const rowsHtml = input.results
    .map((r) => {
      const head: string[] = [`<strong>Row ${r.rowIndex}</strong>`];
      if (r.externalId?.trim()) head.push(`Id: ${escapeHtml(r.externalId.trim())}`);
      if (r.writerName?.trim()) {
        head.push(`Author: ${escapeHtml(r.writerName.trim())}`);
      }

      let body = "";
      if (r.error) {
        body += `<p class="err">Error: ${escapeHtml(r.error)}</p>`;
      } else {
        body += `<p><strong>Score:</strong> ${escapeHtml(r.score ?? "—")}</p>`;
        if (r.rationale?.trim()) {
          body += `<p><strong>Rationale</strong></p><pre class="rationale">${escapeHtml(r.rationale.trim())}</pre>`;
        }
        const areas = r.problemAreas ?? [];
        if (areas.length === 0) {
          body += "<p><strong>Problem spots:</strong> None flagged.</p>";
        } else {
          body += "<p><strong>Problem spots</strong></p><ul>";
          for (const p of areas) {
            const quote = p.excerpt?.trim()
              ? `<blockquote>${escapeHtml(p.excerpt.trim())}</blockquote>`
              : "";
            body += `<li><span class="src">[${escapeHtml(problemSourceLabel(p.source))}]</span> ${escapeHtml(p.concern.trim())}${quote}</li>`;
          }
          body += "</ul>";
        }
      }

      const pa = r.priorAudit;
      if (pa) {
        const liAudited = pa.auditedAt
          ? `<li>Audited at: ${escapeHtml(pa.auditedAt)}</li>`
          : "";
        const liWorld = pa.targetWorld
          ? `<li>Trace target: ${escapeHtml(pa.targetWorld)}</li>`
          : "";
        body += `<p><strong>Workflow audit (recorded trace)</strong></p><ul class="compact">
          <li>Verdict: <strong>${escapeHtml(pa.verdict)}</strong></li>
          <li>Task key: <code>${escapeHtml(pa.taskKey)}</code></li>
          <li>Report: <code>${escapeHtml(pa.reportFileName)}</code></li>
          <li>Match: ${escapeHtml(pa.matchType === "task_key" ? "task id from sheet" : "normalized prompt prefix (≤140 chars, YAML)")}</li>
          ${liAudited}
          ${liWorld}
        </ul>`;
      } else {
        body +=
          "<p><strong>Workflow audit (recorded trace):</strong> no matching <code>task_*.md</code> report under trace-exports/reports.</p>";
      }

      return `<section class="row-block"><h3>${head.join(" · ")}</h3>${body}</section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(docTitle)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 10.5pt; line-height: 1.4; color: #18181b; margin: 0; padding: 10mm 12mm; }
  h1 { font-size: 16pt; margin: 0 0 6pt; }
  h2 { font-size: 12pt; margin: 18pt 0 8pt; border-bottom: 1px solid #e4e4e7; padding-bottom: 4pt; }
  h3 { font-size: 10.5pt; margin: 0 0 8pt; color: #3f3f46; }
  p { margin: 6pt 0; }
  pre.rationale { white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, monospace; font-size: 9pt; background: #fafafa; border: 1px solid #e4e4e7; padding: 8pt; border-radius: 4px; margin: 6pt 0; }
  .meta { color: #52525b; font-size: 9.5pt; margin-bottom: 14pt; }
  .row-block { page-break-inside: avoid; margin-bottom: 16pt; padding: 10pt 12pt; border: 1px solid #e4e4e7; border-radius: 6px; background: #fafafa; }
  .err { color: #b91c1c; }
  ul { margin: 4pt 0 8pt 16pt; padding: 0; }
  ul.compact { margin-top: 2pt; }
  blockquote { margin: 4pt 0 4pt 8pt; padding-left: 8pt; border-left: 2px solid #d4d4d8; color: #71717a; font-style: italic; font-size: 9pt; }
  code { font-size: 9pt; background: #f4f4f5; padding: 1px 4px; border-radius: 3px; }
  .src { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.04em; color: #a16207; }
  .hint { font-size: 9pt; color: #71717a; margin-top: 18pt; padding: 8pt; border: 1px dashed #d4d4d8; border-radius: 6px; }
  @media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .hint { display: none; }
  }
</style>
</head>
<body>
  <h1>Writer draft pre-check report</h1>
  <p class="meta">Generated: ${dateStr}</p>
  <h2>Run summary</h2>
  <p>${summaryLines.join("<br />")}</p>
  ${stoppedNote}
  ${warningsBlock}
  <h2>Results by row</h2>
  ${rowsHtml}
  <p class="hint">Use your browser’s print dialog and choose <strong>Save as PDF</strong> to download a PDF file.</p>
</body>
</html>`;
}

/**
 * Opens a printable HTML report in a new tab and triggers the print dialog.
 * The user can choose “Save as PDF” — no extra npm packages required.
 * Client-only (requires `window`).
 */
export function downloadWriterPrecheckPdf(
  input: WriterPrecheckPdfInput,
  filenameBase?: string,
): void {
  const docTitle =
    filenameBase?.replace(/\.pdf$/i, "") ??
    `openclaw-writer-precheck-${input.generatedAtIso.slice(0, 10)}`;
  const html = buildWriterPrecheckReportHtml(input, docTitle);

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) {
    URL.revokeObjectURL(url);
    throw new Error(
      "Could not open print window (popup blocked). Allow popups for this site and try again.",
    );
  }

  const cleanup = () => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  };

  let printed = false;
  const triggerPrint = () => {
    if (printed) return;
    printed = true;
    try {
      w.focus();
      w.print();
    } finally {
      setTimeout(cleanup, 60_000);
    }
  };

  w.addEventListener("load", () => setTimeout(triggerPrint, 200), { once: true });
  setTimeout(triggerPrint, 1200);
}
