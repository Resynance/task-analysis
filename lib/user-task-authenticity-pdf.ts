import type { UserTaskAuthenticityTaskResult } from "@/lib/user-task-authenticity-analysis";

type Risk = "low" | "medium" | "high";
type AhtFeasibility = "yes" | "borderline" | "no" | "unknown";

export type UserTaskAuthenticityPdfInput = {
  generatedAtIso: string;
  summary: {
    total: number;
    highProbabilityScore: number;
    aiGeneratedHighProbabilityCount: number;
    llmSummary: {
      overall_risk: Risk;
      rationale: string;
      recommendations: string[];
    } | null;
  };
  tasks: UserTaskAuthenticityTaskResult[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function scoreText(n: number | null | undefined): string {
  return n == null ? "-" : `${Math.round(n)}`;
}

function ahtText(task: UserTaskAuthenticityTaskResult): string | null {
  if (!task.aht) return null;
  return task.aht.seconds == null
    ? task.aht.raw
    : `${task.aht.raw} (${Math.round(task.aht.seconds)}s)`;
}

function riskClass(risk: Risk): string {
  if (risk === "high") return "risk-high";
  if (risk === "medium") return "risk-medium";
  return "risk-low";
}

function riskFromScore(score: number): Risk {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function modelLabel(index: number): string {
  return `Model ${String.fromCharCode(65 + index)}`;
}

function ahtFeasibilityText(
  feasibility: AhtFeasibility,
  rationale: string,
): string | null {
  const trimmedRationale = rationale.trim();
  if (feasibility === "unknown" && !trimmedRationale) return null;
  return trimmedRationale ? `${feasibility} - ${trimmedRationale}` : feasibility;
}

function ahtFeasibilityHtml(
  label: string,
  feasibility: AhtFeasibility,
  rationale: string,
  className?: string,
): string {
  const text = ahtFeasibilityText(feasibility, rationale);
  if (!text) return "";
  const classAttr = className ? ` class="${escapeHtml(className)}"` : "";
  return `<p${classAttr}><strong>${escapeHtml(label)}:</strong> ${escapeHtml(text)}</p>`;
}

function listHtml(items: string[]): string {
  if (items.length === 0) return "";
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function buildTaskHtml(task: UserTaskAuthenticityTaskResult): string {
  const aiSignals = task.signals.filter((signal) => signal.kind === "ai_generated");
  const aiScore = task.llm?.ai_generated ?? aiSignals[0]?.score ?? 0;
  const signalItems = aiSignals
    .map((signal) => {
      const evidence = listHtml(signal.evidence);
      return `<li><strong>${escapeHtml(signal.label)}:</strong> ${signal.score}${evidence}</li>`;
    })
    .join("");

  const llmScores = task.llm
    ? `<div class="scores">
        <span>AI-generated score ${scoreText(task.llm.ai_generated)}</span>
      </div>`
    : "";

  const aiDetails = task.llm?.ai_generated_rationale?.trim()
    ? `<p><strong>AI-generated rationale:</strong> ${escapeHtml(
        task.llm.ai_generated_rationale.trim(),
      )}</p>`
    : "";

  const aiEvidenceList = task.llm ? listHtml(task.llm.ai_generated_evidence) : "";
  const aiEvidence = aiEvidenceList
    ? `<p><strong>AI-generated evidence</strong></p>${aiEvidenceList}`
    : "";

  const llmRationale = task.llm
    ? `<p><strong>Consensus rationale:</strong> ${escapeHtml(task.llm.rationale)}</p>${listHtml(
        task.llm.evidence,
      )}`
    : "";
  const consensusAht = task.llm
    ? ahtFeasibilityHtml(
        "Consensus AHT feasibility",
        task.llm.aht_feasibility,
        task.llm.aht_rationale,
      )
    : "";
  const aht = ahtText(task);
  const modelDetails = task.llmReviews
    .map((review) => {
      const label = modelLabel(review.modelIndex);
      return `<div class="model-review">
        <p><strong>${label}:</strong> AI-generated score ${scoreText(review.ai_generated)}</p>
        <p>${escapeHtml(review.rationale)}</p>
        ${ahtFeasibilityHtml(
          "AHT feasibility",
          review.aht_feasibility,
          review.aht_rationale,
          "muted",
        )}
        ${
          review.ai_generated_rationale
            ? `<p class="muted">${escapeHtml(review.ai_generated_rationale)}</p>`
            : ""
        }
        ${listHtml(review.ai_generated_evidence)}
      </div>`;
    })
    .join("");

  return `<section class="task">
    <div class="task-head">
      <span class="pill ${riskClass(riskFromScore(aiScore))}">${escapeHtml(
        riskFromScore(aiScore),
      )}</span>
      <code>${escapeHtml(task.id)}</code>
      <span>AI score ${scoreText(aiScore)}</span>
      ${aht ? `<span>AHT ${escapeHtml(aht)}</span>` : ""}
    </div>
    ${llmScores}
    <h3>Full prompt</h3>
    <pre class="prompt">${escapeHtml(task.text)}</pre>
    <h3>Evidence</h3>
    ${signalItems ? `<ul>${signalItems}</ul>` : "<p>No deterministic signals flagged.</p>"}
    ${aiDetails}
    ${aiEvidence}
    ${llmRationale}
    ${consensusAht}
    ${modelDetails ? `<h3>Model Details</h3>${modelDetails}` : ""}
  </section>`;
}

export function buildUserTaskAuthenticityReportHtml(
  input: UserTaskAuthenticityPdfInput,
): string {
  const generated = new Date(input.generatedAtIso);
  const generatedText = Number.isNaN(generated.getTime())
    ? input.generatedAtIso
    : generated.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });

  const summary = input.summary.llmSummary;
  const recommendations =
    summary && summary.recommendations.length > 0
      ? listHtml(summary.recommendations)
      : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>User task authenticity report</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { color: #18181b; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 10.5pt; line-height: 1.45; margin: 0; padding: 10mm 12mm; }
  h1 { font-size: 18pt; margin: 0 0 5pt; }
  h2 { border-bottom: 1px solid #e4e4e7; font-size: 12pt; margin: 18pt 0 8pt; padding-bottom: 4pt; }
  h3 { color: #52525b; font-size: 10pt; margin: 10pt 0 5pt; text-transform: uppercase; letter-spacing: 0.04em; }
  p { margin: 6pt 0; }
  ul { margin: 4pt 0 8pt 16pt; padding: 0; }
  code { background: #f4f4f5; border-radius: 3px; font-size: 9pt; padding: 1px 4px; }
  .meta { color: #52525b; font-size: 9.5pt; margin-bottom: 14pt; }
  .summary-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8pt; margin: 10pt 0 12pt; }
  .metric { border: 1px solid #e4e4e7; border-radius: 6px; padding: 8pt; }
  .metric strong { display: block; font-size: 16pt; }
  .metric span { color: #71717a; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.04em; }
  .task { border: 1px solid #e4e4e7; border-radius: 7px; margin: 0 0 14pt; padding: 10pt 12pt; page-break-inside: avoid; }
  .task-head { align-items: center; display: flex; flex-wrap: wrap; gap: 6pt; margin-bottom: 8pt; }
  .pill { border-radius: 999px; border: 1px solid currentColor; font-size: 8pt; padding: 2px 7px; text-transform: uppercase; }
  .risk-high { color: #be123c; }
  .risk-medium { color: #b45309; }
  .risk-low { color: #047857; }
  .scores { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5pt; margin: 8pt 0; }
  .scores span { background: #fafafa; border: 1px solid #e4e4e7; border-radius: 5px; padding: 5pt; }
  .model-review { background: #fafafa; border: 1px solid #e4e4e7; border-radius: 5px; margin: 6pt 0; padding: 7pt; }
  .muted { color: #71717a; font-size: 9.5pt; }
  .prompt { background: #fafafa; border: 1px solid #e4e4e7; border-radius: 5px; color: #27272a; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 8.8pt; line-height: 1.35; margin: 0; padding: 8pt; white-space: pre-wrap; word-break: break-word; }
  .hint { border: 1px dashed #d4d4d8; border-radius: 6px; color: #71717a; font-size: 9pt; margin-top: 18pt; padding: 8pt; }
  @media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .hint { display: none; }
  }
</style>
</head>
<body>
  <h1>User task authenticity report</h1>
  <p class="meta">Generated: ${escapeHtml(generatedText)}</p>
  <h2>Summary</h2>
  <div class="summary-grid">
    <div class="metric"><span>High-probability AI generation</span><strong>${scoreText(
      input.summary.aiGeneratedHighProbabilityCount,
    )}</strong></div>
    <div class="metric"><span>JSON tasks</span><strong>${scoreText(
      input.summary.total,
    )}</strong></div>
  </div>
  <p class="meta">High probability means the AI-generated score is ${input.summary.highProbabilityScore} or higher.</p>
  ${
    summary
      ? `<p><strong>AI generation risk:</strong> ${escapeHtml(summary.overall_risk)}</p><p>${escapeHtml(
          summary.rationale,
        )}</p>${recommendations}`
      : "<p>No LLM summary was included for this export.</p>"
  }
  <h2>Task Details</h2>
  ${input.tasks.map(buildTaskHtml).join("\n")}
  <p class="hint">Use your browser's print dialog and choose <strong>Save as PDF</strong> to download a PDF file.</p>
</body>
</html>`;
}

export function downloadUserTaskAuthenticityPdf(
  input: UserTaskAuthenticityPdfInput,
): void {
  const html = buildUserTaskAuthenticityReportHtml(input);
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const printWindow = window.open(url, "_blank");
  if (!printWindow) {
    URL.revokeObjectURL(url);
    throw new Error(
      "Could not open print window. Allow pop-ups for this site and try again.",
    );
  }

  const cleanup = () => URL.revokeObjectURL(url);
  let printed = false;
  const triggerPrint = () => {
    if (printed) return;
    printed = true;
    printWindow.focus();
    printWindow.print();
    setTimeout(cleanup, 60_000);
  };

  printWindow.addEventListener("load", () => setTimeout(triggerPrint, 200), {
    once: true,
  });
  setTimeout(triggerPrint, 1200);
}
