import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { getChatModel, chatCompletionCreateAudited } from "@/lib/llm";
import type { ResolvedLlmConfig } from "@/lib/llm-config";
import { assertLlmConfigured } from "@/lib/llm-config";
import { getPmgptFailureRootAbsolute } from "@/lib/repo-paths";

/** Repo folder: one directory per task (`task_*`), each containing `run*.json` transcripts. */
export function getPmgptFailureAnalysisRoot(): string {
  return getPmgptFailureRootAbsolute();
}

export function getPmgptFailureReportsDir(): string {
  return path.join(getPmgptFailureAnalysisRoot(), "reports");
}

/** Cross-task summary written next to per-task `task_*.md` reports. */
export const PMGPT_FAILURE_OVERVIEW_BASENAME = "pmgpt-failure-overview.md";

export function getPmgptFailureOverviewReportPath(): string {
  return path.join(getPmgptFailureReportsDir(), PMGPT_FAILURE_OVERVIEW_BASENAME);
}

export async function getPmgptFailureOverviewStatus(): Promise<{
  exists: boolean;
  updatedAtIso: string | null;
}> {
  const p = getPmgptFailureOverviewReportPath();
  if (!existsSync(p)) {
    return { exists: false, updatedAtIso: null };
  }
  const st = await stat(p);
  return { exists: true, updatedAtIso: st.mtime.toISOString() };
}

export function isSafeTaskDirName(name: string): boolean {
  const t = name.trim();
  if (!t.startsWith("task_")) return false;
  if (t.includes("/") || t.includes("\\") || t.includes("..")) return false;
  if (t.length > 280) return false;
  return /^task_[a-zA-Z0-9_-]+$/.test(t);
}

export type PmgptTaskStatus = {
  taskId: string;
  runFiles: string[];
  reportPath: string | null;
  reportUpdatedAtIso: string | null;
};

export async function listPmgptFailureTasks(): Promise<PmgptTaskStatus[]> {
  const root = getPmgptFailureAnalysisRoot();
  if (!existsSync(root)) {
    return [];
  }
  const entries = await readdir(root, { withFileTypes: true });
  const reportsDir = getPmgptFailureReportsDir();
  const out: PmgptTaskStatus[] = [];

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const taskId = ent.name;
    if (!isSafeTaskDirName(taskId)) continue;
    const taskPath = path.join(root, taskId);
    const files = await readdir(taskPath);
    const runFiles = files
      .filter((f) => /^run\d+\.json$/i.test(f))
      .sort((a, b) => {
        const na = Number.parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
        const nb = Number.parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
        return na - nb;
      });
    const reportPath = path.join(reportsDir, `${taskId}.md`);
    let reportUpdatedAtIso: string | null = null;
    if (existsSync(reportPath)) {
      const st = await stat(reportPath);
      reportUpdatedAtIso = st.mtime.toISOString();
    }
    out.push({
      taskId,
      runFiles,
      reportPath: existsSync(reportPath) ? reportPath : null,
      reportUpdatedAtIso,
    });
  }
  out.sort((a, b) => a.taskId.localeCompare(b.taskId));
  return out;
}

type TranscriptMsg = {
  role?: string;
  content?: string | null;
  created_at?: string;
  position?: number;
  tool_calls?: Array<{
    function?: { name?: string; arguments?: string };
  }> | null;
  metadata?: {
    reasoning_trace?: string;
    usage?: unknown;
  } | null;
};

function parseTranscriptMessages(raw: unknown): TranscriptMsg[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => x && typeof x === "object") as TranscriptMsg[];
}

/** First user message in transcript = task prompt for the agent. */
export function extractTaskPromptFromTranscript(raw: unknown): string | null {
  for (const m of parseTranscriptMessages(raw)) {
    if (m.role !== "user") continue;
    const c = typeof m.content === "string" ? m.content.trim() : "";
    if (c.length > 0) return c;
  }
  return null;
}

/**
 * Heuristic outline of **workflow steps / obligations** in the PM task prompt for LLM context.
 * Prefer numbered / substantive bullet lines; otherwise fall back to paragraph chunks.
 * The model should **refine** this in the report (merge, fix noise, add implied steps).
 */
export function extractPromptWorkflowOutlineForLlm(
  taskPrompt: string | null,
): string {
  if (!taskPrompt || !taskPrompt.trim()) {
    return "_No task prompt text available to extract steps from._";
  }
  const text = taskPrompt.replace(/\r\n/g, "\n").trim();
  const lines = text.split("\n");
  const picked: string[] = [];
  const seen = new Set<string>();

  const push = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (t.length < 12) return;
    const k = t.slice(0, 120).toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    picked.push(t.length > 360 ? `${t.slice(0, 357)}…` : t);
  };

  const numbered = /^\s*(\d+)[.)]\s+(.+)$/;
  const bullet = /^\s*[-*•]\s+(.+)$/;
  for (const line of lines) {
    const nm = line.match(numbered);
    if (nm) {
      push(`${nm[1]}. ${nm[2]}`);
      continue;
    }
    const bm = line.match(bullet);
    if (bm && bm[1].trim().length >= 18) {
      push(`• ${bm[1]}`);
    }
  }

  if (picked.length < 3) {
    const paras = text
      .split(/\n\s*\n+/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter((p) => p.length > 70);
    for (const p of paras) {
      push(p);
      if (picked.length >= 14) break;
    }
  }

  if (picked.length === 0) {
    return "_Could not auto-segment the prompt — infer steps manually from the full task prompt._";
  }
  return picked
    .slice(0, 28)
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");
}

function orderedTranscriptMessages(raw: unknown): TranscriptMsg[] {
  const arr = parseTranscriptMessages(raw);
  return [...arr].sort((a, b) => {
    const pa = typeof a.position === "number" ? a.position : Number.NaN;
    const pb = typeof b.position === "number" ? b.position : Number.NaN;
    if (!Number.isNaN(pa) && !Number.isNaN(pb) && pa !== pb) return pa - pb;
    const ta = Date.parse(String(a.created_at ?? ""));
    const tb = Date.parse(String(b.created_at ?? ""));
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb;
    return 0;
  });
}

/**
 * Steps = assistant turns (each model response, with or without tool calls).
 * Duration = span between earliest and latest `created_at` in the transcript.
 */
export function computeRunStepsAndDuration(raw: unknown): {
  assistantSteps: number;
  durationMs: number | null;
  durationLabel: string;
} {
  const ordered = orderedTranscriptMessages(raw);
  const assistantSteps = ordered.filter((m) => m.role === "assistant").length;
  const times = ordered
    .map((m) => Date.parse(String(m.created_at ?? "")))
    .filter((t) => !Number.isNaN(t));
  let durationMs: number | null = null;
  if (times.length >= 2) {
    durationMs = Math.max(0, Math.max(...times) - Math.min(...times));
  } else if (times.length === 1) {
    durationMs = 0;
  }
  return {
    assistantSteps,
    durationMs,
    durationLabel: formatDurationMs(durationMs),
  };
}

function formatDurationMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms <= 0) return ms === 0 ? "0s" : "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remS = sec % 60;
  if (min < 60) return remS > 0 ? `${min}m ${remS}s` : `${min}m`;
  const h = Math.floor(min / 60);
  const remM = min % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

function trunc(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… [truncated ${s.length - max} chars]`;
}

/**
 * Linear transcript digest for the LLM (per run), bounded in size.
 */
export function compactRunTranscript(
  raw: unknown,
  maxChars: number,
): string {
  if (!Array.isArray(raw)) {
    return "(Run file is not a JSON array of messages.)";
  }
  const lines: string[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const m = item as TranscriptMsg;
    const role = typeof m.role === "string" ? m.role : "?";
    if (role === "system") {
      const c = typeof m.content === "string" ? m.content : "";
      lines.push(`[system] ${trunc(c, 500)}\n`);
      continue;
    }
    if (role === "user") {
      const c = typeof m.content === "string" ? m.content : "";
      lines.push(`[user] ${trunc(c, 3500)}\n`);
      continue;
    }
    if (role === "assistant") {
      const text =
        typeof m.content === "string" && m.content.trim().length > 0
          ? trunc(m.content.trim(), 1200)
          : "";
      const tools = Array.isArray(m.tool_calls)
        ? m.tool_calls
            .map((tc) => {
              const name = tc?.function?.name ?? "?";
              const args = trunc(
                typeof tc?.function?.arguments === "string"
                  ? tc.function.arguments
                  : "",
                400,
              );
              return `${name}(${args})`;
            })
            .join("; ")
        : "";
      const trace =
        typeof m.metadata?.reasoning_trace === "string"
          ? trunc(m.metadata.reasoning_trace, 800)
          : "";
      let block = "[assistant]";
      if (text) block += ` text: ${text}`;
      if (tools) block += `\n  tools: ${tools}`;
      if (trace) block += `\n  reasoning_trace: ${trace}`;
      block += "\n";
      lines.push(block);
      continue;
    }
    if (role === "tool") {
      const c = typeof m.content === "string" ? m.content : "";
      const preview = c.length > 900 ? trunc(c, 900) : c;
      lines.push(`[tool] ${preview}\n`);
      continue;
    }
    const c = typeof m.content === "string" ? m.content : "";
    lines.push(`[${role}] ${trunc(c, 600)}\n`);
  }

  return trunc(lines.join("\n"), maxChars);
}

type VerifierExecution = {
  score?: unknown;
  success?: unknown;
  stdout?: string;
  execution_time_ms?: unknown;
  result?: {
    result?: unknown;
    error?: unknown;
    stdout?: string;
    success?: unknown;
  };
};

function effectiveVerifierStdout(ex: VerifierExecution): string {
  const nested =
    ex.result &&
    typeof ex.result === "object" &&
    typeof (ex.result as { stdout?: string }).stdout === "string"
      ? (ex.result as { stdout: string }).stdout
      : "";
  const top = typeof ex.stdout === "string" ? ex.stdout : "";
  return nested.length >= top.length ? nested : top;
}

function extractStdoutAccumulator(stdout: string, name: string): string {
  const open = `>>> ${name} >>>`;
  const close = `<<< ${name} <<<`;
  let idx = 0;
  const chunks: string[] = [];
  while (idx < stdout.length) {
    const a = stdout.indexOf(open, idx);
    if (a === -1) break;
    const b = stdout.indexOf(close, a + open.length);
    if (b === -1) break;
    const inner = stdout.slice(a + open.length, b).trim();
    if (inner.length > 0) chunks.push(inner);
    idx = b + close.length;
  }
  return chunks.join("\n\n");
}

/**
 * Compact verifier JSON (`runN-verifier.json`) for the LLM — emphasizes stdout
 * CHECK/ERROR lines; omits huge embedded Python (`runtime_display_src`).
 */
export function compactVerifierOutput(raw: unknown, maxChars: number): string {
  if (!raw || typeof raw !== "object") {
    return "(Verifier file is not a JSON object.)";
  }
  const executions = (raw as { executions?: unknown }).executions;
  if (!Array.isArray(executions) || executions.length === 0) {
    return "(No `executions` array in verifier file.)";
  }

  const parts: string[] = [];

  for (let i = 0; i < executions.length; i++) {
    const ex = executions[i] as VerifierExecution;
    const stdout = effectiveVerifierStdout(ex);
    const ms = ex.execution_time_ms;
    const score = ex.score;
    const topSuccess = ex.success;
    const nested = ex.result && typeof ex.result === "object" ? ex.result : null;
    const numericResult =
      nested && "result" in nested ? (nested as { result?: unknown }).result : undefined;
    const err =
      nested && "error" in nested && (nested as { error?: unknown }).error != null
        ? String((nested as { error?: unknown }).error)
        : "";

    parts.push(
      `#### Execution ${i + 1}`,
      `- score: ${String(score)} · top-level success: ${String(topSuccess)} · execution_time_ms: ${String(ms)}`,
      `- nested result code: ${String(numericResult ?? "—")}`,
    );
    if (err) parts.push(`- nested error: ${trunc(err, 600)}`);

    const combined = stdout
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /combined result/i.test(l));
    if (combined) parts.push(`- ${combined}`);

    const errAcc = extractStdoutAccumulator(stdout, "ERROR_ACCUMULATOR");
    if (errAcc) {
      parts.push(
        "**ERROR_ACCUMULATOR (excerpt)**",
        trunc(errAcc, Math.min(4500, Math.floor(maxChars * 0.55))),
      );
    } else {
      const bad = stdout
        .split("\n")
        .filter((l) => l.includes("[X]"))
        .slice(0, 30);
      if (bad.length > 0) {
        parts.push("**Lines with [X]**", bad.join("\n"));
      }
    }

    const succAcc = extractStdoutAccumulator(stdout, "SUCCESS_ACCUMULATOR");
    if (succAcc && succAcc.length < 3500) {
      parts.push(
        "**SUCCESS_ACCUMULATOR (truncated)**",
        trunc(succAcc, 2200),
      );
    } else if (succAcc) {
      parts.push(
        "**SUCCESS_ACCUMULATOR**",
        trunc(succAcc, 1800) +
          "\n_(truncated — many checks passed.)_",
      );
    }

    if (stdout.length > 0 && parts.join("\n").length < maxChars * 0.4) {
      parts.push(
        "**Raw stdout (tail)**",
        trunc(stdout.slice(-Math.min(2500, stdout.length)), 2500),
      );
    }

    parts.push(
      "_Verifier Python source (`runtime_display_src`) omitted — use accumulators and stdout above._",
    );
  }

  return trunc(parts.join("\n\n"), maxChars);
}

/** Single cell for the run statistics table (short). */
function buildVerifierTableSummary(raw: unknown): string {
  const full = compactVerifierOutput(raw, 6000);
  const combined = full.match(/Combined result:\s*[^\n]+/i);
  const xLine = full.match(/\[X\][^\n]+/);
  const parts: string[] = [];
  if (combined) parts.push(combined[0].trim());
  if (xLine) parts.push(trunc(xLine[0].trim(), 110));
  return parts.length > 0
    ? trunc(parts.join(" · "), 220)
    : "Verifier output present (see body)";
}

type RunLoaded = {
  name: string;
  digest: string;
  assistantSteps: number;
  durationLabel: string;
  raw: unknown;
  /** Short markdown-safe fragment for the statistics table; "—" if no verifier file. */
  verifierSummaryCell: string;
};

async function loadRunJsons(
  taskDir: string,
  runFiles: string[],
): Promise<RunLoaded[]> {
  const out: RunLoaded[] = [];
  const perRunBudget = Math.max(
    6000,
    Math.floor(32000 / Math.max(1, runFiles.length)),
  );
  for (const rf of runFiles) {
    const runBase = rf.replace(/\.json$/i, "");
    const p = path.join(taskDir, rf);
    const raw = JSON.parse(await readFile(p, "utf8")) as unknown;
    const { assistantSteps, durationLabel } = computeRunStepsAndDuration(raw);

    const verifierPath = path.join(taskDir, `${runBase}-verifier.json`);
    let verifierRaw: unknown | null = null;
    if (existsSync(verifierPath)) {
      try {
        verifierRaw = JSON.parse(
          await readFile(verifierPath, "utf8"),
        ) as unknown;
      } catch {
        verifierRaw = { parse_error: true };
      }
    }

    const verifierBudget = verifierRaw ? Math.min(7500, perRunBudget) : 0;
    const transcriptBudget = Math.max(
      4000,
      perRunBudget - verifierBudget - (verifierRaw ? 400 : 0),
    );
    let digest = compactRunTranscript(raw, transcriptBudget);
    let verifierSummaryCell = "—";
    if (verifierRaw && !(verifierRaw as { parse_error?: boolean }).parse_error) {
      verifierSummaryCell = buildVerifierTableSummary(verifierRaw);
      digest += `\n\n### Verifier output (${runBase}-verifier.json)\n\n${compactVerifierOutput(verifierRaw, verifierBudget)}`;
    } else if (verifierRaw && (verifierRaw as { parse_error?: boolean }).parse_error) {
      verifierSummaryCell = "(parse error)";
      digest += `\n\n### Verifier output (${runBase}-verifier.json)\n\n_(Could not parse JSON.)_`;
    }

    out.push({
      name: runBase,
      digest,
      assistantSteps,
      durationLabel,
      raw,
      verifierSummaryCell,
    });
  }
  return out;
}

const MAX_TASK_PROMPT_FOR_LLM = 10_000;

function escapeMdTableCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function buildRunStatisticsTable(
  runs: Pick<
    RunLoaded,
    "name" | "assistantSteps" | "durationLabel" | "verifierSummaryCell"
  >[],
): string {
  const header =
    "| Run | Steps (assistant turns) | Duration | Verifier summary |\n| --- | ---: | --- | --- |";
  const rows = runs.map(
    (r) =>
      `| ${r.name} | ${r.assistantSteps} | ${r.durationLabel} | ${escapeMdTableCell(r.verifierSummaryCell)} |`,
  );
  return [header, ...rows].join("\n");
}

function buildReportPreamble(
  taskId: string,
  taskPrompt: string | null,
  runs: Pick<
    RunLoaded,
    | "name"
    | "assistantSteps"
    | "durationLabel"
    | "verifierSummaryCell"
  >[],
): string {
  const promptBlock =
    taskPrompt && taskPrompt.length > 0
      ? taskPrompt
      : "_No user/task prompt found in run transcripts._";
  const table = buildRunStatisticsTable(runs);
  return [
    `# PM GPT failure analysis — ${taskId}`,
    "",
    "## Task prompt",
    "",
    promptBlock,
    "",
    "## Run statistics",
    "",
    table,
    "",
  ].join("\n");
}

const REPORT_SYSTEM = `You write the **analysis body** of a Markdown report for operator review of GPT agent runs on simulated product tasks.

The **title, full task prompt, and run statistics table** are already written for you — do **not** repeat them. Do **not** output a top-level \`# \` heading.

The user message includes: exact per-run **step counts** (assistant turns) and **durations** — treat those numbers as authoritative when comparing runs. It also includes an **Auto-extracted prompt structure** — a rough segmentation of the task prompt; **refine, merge, or correct** it in your **Expected workflow** section (it may be noisy around email templates).

Each run block is a **digest** of the real transcript (truncated): system prompt, user task, assistant steps, tool calls, tool results, and optional reasoning traces. When a **Verifier output** subsection is present for that run (\`runN-verifier.json\`), it contains **automated grading stdout** (CHECK/ERROR accumulators, per-app results). **Cross-reference** transcript behavior with verifier failures—verifier \`[X]\` lines and \`Combined result\` are strong signals for what actually failed vs what looked fine in chat.

**Verifier lines and tool fields (mandatory whenever you discuss a failure or \`[X]\`):**

- **Quote verifier granularity:** For every \`[X]\` / ERROR line you analyze, restate it using the **exact identifiers** printed in stdout—**table** name, **primary key** or row id if given, **field/column** name, and **expected vs actual** values (e.g. \`messages\`, \`importance\`, \`expected 'normal', got 'high'\`). Do **not** paraphrase into vague phrases like “unexpected database changes,” “priority mismatch,” or “wrong priority level” unless the verifier output literally says that. **Never conflate domains:** Jira issue **priority** (e.g. Highest/High/Medium) is **not** the same thing as an Outlook/email row field such as \`messages.importance\` (\`high\`/\`normal\`)—if the verifier names \`importance\`, you must say **importance**, not “email priority” or “message priority” without that field name.

- **Map to transcript tools:** Name the **tool** (e.g. \`outlook__send_email\`) and the **JSON argument key** or behavior in the digest that produced the row/field the verifier flags (e.g. \`"importance":"high"\` in tool arguments). If the digest truncates arguments, say **truncated in digest** and still infer only from visible fragments.

- **Prompt binding (required per \`[X]\`):** For each decisive \`[X]\`, classify the graded dimension as either:
  - **Prompt-constrained** — the task prompt **explicitly** requires this value or an equivalent (quote the **shortest obligating** phrase); then judge pass/fail vs that text; or
  - **Prompt-silent** — the task text **does not** mention this tool argument, UI flag, or DB column. **State explicitly that the prompt is silent here.** **Default agent behavior:** for optional flags the prompt does not name (e.g. email \`importance\`, sensitivity, categories), the agent should **omit the argument or use the tool/schema default**—setting a **non-default** value without instruction is **over-specification** (“doing more than the prompt”), typically **Model run**, **not** **Poor prompt / ambiguity**. Then explain: whether the agent’s value was nevertheless **plausible** from strong cue words (e.g. explicit “mark as urgent”); how **passing vs failing runs** differ on this argument if visible; and whether the failure is best labeled **Model run** (agent chose an optional arg that diverges from reference/passing runs), **Elsewhere (verifier or rubric)** (grading encodes conventions not in the prompt), or **Writer or recording inaccuracy** (reference trace used a default). You must pick **one** primary failure origin for that \`[X]\` with this logic—do not default to **Model run** without naming the silent field and comparing to passing runs when applicable.

**Prompt ambiguity vs model over-specification (cross-cutting):** **Ambiguity** = multiple defensible interpretations of **required** substance (recipients, projects, required steps, identities agents must resolve). **Not ambiguity** = prompt silence on an optional parameter and the agent **supplies extra** non-default settings—frame as **model over-specification** / **Model run** (should use defaults), **not** as “implicit expectations missing from the task copy.” In any **Task / rubric design signals**-style synthesis, **do not** bucket silent \`importance\`-style failures under “ambiguous prompts” unless the **required** email content or routing was genuinely underspecified.

**Operational failure modes (human-analyst lenses — scan every run for these):** Beyond origin taxonomy, tag **concrete mechanisms** when the digest supports them (use bold **Pattern:** labels in **Detailed analysis** or **Root cause**). Common gaps in shallow “model failed” summaries—actively look for:

1. **JQL / query fragility** — Unquoted UUIDs, wrong JQL operators, or filters that return **0 rows with no error**; agent then treats empty as “no issues” and **wrong branch** (create stub, skip transitions). Note if this looks like **simulator/mock silent failure** vs real Jira validation (**Elsewhere (tooling or infra)** vs **Model run**).

2. **Optional nested API fields omitted** — e.g. Jira \`additional_fields\`, \`priority\`, \`issueTypeName\` / issue type: prompt may **explicitly** demand “Highest” or “Task” but tool call omits nested payload → defaults wrong. This is still **Model run** (implementation slip), **not** “prompt was vague”—say **nested field omitted**.

3. **Collective vs distributive operations** — Prompt requires **one** email/meeting/notification covering **all** recipients (or all issues); agent completes part of the graph (e.g. calendar to A+B) but **collapses** recipients or items on another step (email only to A). Call out **partial collapse**.

4. **Conditional branch & state tracking** — Upstream tool **returned valid data** (e.g. issue count ≥ threshold) but assistant **took the wrong branch**, used wrong template, or called a **different tool variant** than specified (e.g. \`reply_to_email\` vs \`create_reply_draft\`, send vs draft). Distinct from “JQL returned nothing.”

5. **Wrong entity after broad recovery** — After failed search, agent runs broad \`text ~\` or heuristics and **locks onto wrong issue/ticket**, then cascades correct-looking actions on wrong id.

6. **Prompt vs verifier semantics** — Natural language (“task”, “child task”) vs strict API enums (**Task** vs **Sub-task**); **both** models same failure → flag **Poor prompt / dataset** or **Elsewhere (verifier or rubric)** mismatch, not only “model.”

7. **Verifier strictness / unwritten rubric** — Verifier requires **literal** substring or action **not** stated in prompt (e.g. “mark as read”, magic word only in a comment). Quote prompt absence → **Elsewhere (verifier or rubric)**.

8. **Environment or MCP quirk** — Tool applies filter on **empty-string** param, drops rows, returns empty list without error—agent followed schema defaults (**Elsewhere (tooling or infra)**).

**Multiple \`[X]\` lines:** If verifier lists several failures, **rank** them: which is the **dominant** user-visible break vs **secondary** (e.g. calendar id mismatch secondary to Jira issue type)—do not analyze only the first line in stdout.

**Failure origin is mandatory.** Classify **where the failure stems from** using the taxonomy below. Pick the **single best primary** origin per run (and for the task-level root cause), and use **Mixed** only when two or more origins are genuinely tied—say which tied and why. Label uncertain judgments **Unclear** with the missing evidence you would need.

**Primary origins (use these exact labels in prose and tables):**

1. **Poor prompt / task copy** — Instructions are ambiguous, contradictory, underspecified, or impossible to operationalize from text alone; reasonable agents disagree on what “done” means; **workflow conformance diverges across runs for that reason**. Not for “agent slipped once” when the prompt was objectively clear. **Do not** use Poor prompt solely because the model set a **non-default optional** tool argument (e.g. \`importance: high\`) the text never asked for—that is **Model run** (over-specification; should default) unless multiple **required** interpretations truly conflict. For calendars, “underspecified” means the scenario should clarify **which calendar in natural language** (work vs personal, named account, etc.)—**not** that operators should fix grading by pasting a numeric \`calendarId\` into the prompt (see **Reasoning-first tasks** below).

2. **Writer or recording inaccuracy** — The **written scenario** and the **human reference traces / QA validation baseline** disagree, or the verifier encodes expectations from recordings that do not match the prompt. **Typical signal:** \`calendarId\` / expected-vs-got mismatch **while** the transcript shows the agent selecting the **named** calendar or entity the **prompt** specifies (e.g. Work Calendar). **Do not** call this **Seeded environment** when the likelier story is author/QA captured actions against a different calendar or app state than the verifier checks. **Whenever you attribute a calendar or baseline failure to writer/QA (not model), you must show the evidence bundle** in the report body (see **Verifier + calendar rules** below)—prompt quote + tool args/results + verifier line; otherwise use **Hypothesis:** or **Unclear**.

3. **Model run** — The agent had enough information in the prompt + digest to succeed but **chose wrong tools or arguments**, skipped required steps, hallucinated IDs, misread an unambiguous instruction, stopped early, **over-specified** optional parameters (set non-default \`importance\`, flags, etc. when the prompt did not ask and **defaults** or passing-run behavior would suffice), or **omitted nested required fields** in tool JSON (e.g. Jira \`additional_fields\` / priority / issue type) **even when the prompt text was explicit**—still **Model run** (implementation / API-shape slip). Cite transcript lines / tool calls. **Prompt-silent tool args** that break verifier/reference (e.g. optional \`importance\` on send-email) still count as **Model run** when the agent **introduced** a value that passing runs did not use and the rubric is consistent—not when the only issue is an unstated field and you have shown the rubric contradicts the written prompt (**Elsewhere (verifier or rubric)**) or the reference baseline alone (**Writer or recording inaccuracy**).

4. **Elsewhere** — Use a **secondary tag in parentheses** after **Elsewhere** so operators know what you mean:
   - **Elsewhere (seeded environment)** — Fixtures/DB state objectively contradict the **written** prompt (not merely “verifier disagrees”); missing seeded rows; wrong default data **with no** plausible writer/recording story.
   - **Elsewhere (verifier or rubric)** — Grading logic or expected keys contradict the prompt or observable sim state; false \`[X]\` when transcript matches prompt. Includes **over-strict literal** requirements (substring only in comments), **unwritten** steps (e.g. mark-as-read) not in task copy, or strict enum checks that conflict with natural-language scenario (**Task** vs **Sub-task**).
   - **Elsewhere (tooling or infra)** — API errors, empty/malformed tool payloads, rate limits, truncated digests hiding critical context (name the limitation). Includes **silent empty results** from malformed queries/filters, or tools that mis-handle **default/empty parameters** (e.g. filter applied on empty string) so agents see “no data” without a validation error.

**Verifier + calendar rules:** Before labeling a calendar \`[X]\` as **Elsewhere (seeded environment)**, check **which calendar** the agent chose in tools. If it matches prompt wording and verifier still fails on ID, prefer **Writer or recording inaccuracy** and explain (reference traces vs verifier expectation).

**Evidence bundle (mandatory for “writer/QA / recording—not model” on calendar or baseline \`[X]\`):** To **prove** the failure is on author/QA rather than the model, your analysis must tie three strands together (short quotes/fragments from the digest—**not** invention): (1) **Prompt strand** — quote the **smallest obligating substring** from the **user task** in the digest that names or implies which calendar to use (e.g. “Work Calendar”, “work calendar”, “your work account”); (2) **Transcript strand** — cite **tool name(s)** and paste a **brief** fragment from **tool \`arguments\`** (\`calendarId\`, \`calendar\`, etc.) **and/or** from the **immediately related tool result** (e.g. list calendars response showing id+name, create meeting payload) showing what the agent actually selected; (3) **Verifier strand** — the exact \`[X]\` line with **expected vs got** ids. Then one sentence: **why** (2) satisfies (1) but (3) disagrees → baseline/recording mismatch. If the digest omits calendar tool args or results, state **Transcript evidence incomplete in digest** and downgrade to **Hypothesis:** or **Unclear**—do not assert writer/QA with **Confidence: high**.

**Reasoning-first tasks — calendar ID recommendations (mandatory tone):** These tasks intentionally require **reasoning** (infer the right calendar, folder, or entity from scenario text), **not** rote copying of internal IDs from the prompt. When analysis involves **calendarId** / “expected \`N\`, got \`M\`” verifier lines: (1) **Primary operational recommendation** — ensure the **task creator’s reference recording / golden trace** was captured on the **same** calendar the verifier grades against (re-record or rebaseline so writer execution and verifier expected IDs align with the **named** calendar in the scenario). (2) **Do not** recommend as the default or first-line fix “put calendarId \`N\` in the task prompt” or “require the agent to use internal id \`N\`” — that undermines reasoning. Only mention **literal IDs in copy** as a last resort when the transcript shows the agent **ignored** an unambiguous in-prompt calendar identity, or when the scenario gives **no** reasonable way to infer which calendar to use **and** recordings are already aligned. Prefer **writer/QA** and **verifier/fixture alignment** over **prompt stuffing IDs**.

Use evidence from the digest; prefix shaky conclusions with **Hypothesis:** when appropriate.

Your job — output **Markdown only** (no outer code fence), using **exactly** these \`##\` / \`###\` headings in order (do not skip sections; use “None clearly indicated.” only when truly absent):

1. \`## Task overview\` — 1 short paragraph: what the agent was asked to do (align with the task prompt; do not contradict the metrics table).

2. \`## Expected workflow (from prompt)\` — **Logical steps / sub-goals** the prompt requires (refined from the auto-extracted outline). For each major step, note **what “correct” looks like** in the simulators: e.g. which Jira project or filters, issue states, email subjects/recipients, **calendar identity** (name vs id if visible), meeting time window, etc. Call out **ordering dependencies** (e.g. must find issues before emailing). Where email or messaging is involved, briefly note **dimensions the prompt does not specify** (e.g. Outlook **importance**, categories, sensitivity) if a verifier might plausibly touch them—so later \`[X]\` analysis can say **prompt-silent** without inventing requirements.

3. \`## Run summaries\` — For each run, a subsection \`### runN\` with **5–11 bullets**:
   - Outcome guess (success / partial / likely failure) and **verifier headline** if present.
   - If the verifier stdout for this run contains any \`[X]\` / ERROR line you treat as relevant: **Verifier \`[X]\` breakdown** — one sub-line **per** such line: paste or tightly quote **table**, **field/column**, **expected → got** (and pk/id if present). **No vague restatement.**
   - If you attribute any \`[X]\` to **Writer or recording inaccuracy** and it involves **calendarId** or calendar selection: **Evidence (prompt ↔ transcript ↔ verifier)** — three short lines: **Prompt:** quoted substring from the task in the digest; **Transcript:** \`tool\` + fragment from arguments and/or tool **result** showing calendar id/name; **Verifier:** expected vs got. If transcript strand missing in digest, say **Transcript evidence incomplete in digest** and avoid claiming writer/QA as fact.
   - **Primary failure origin (hypothesis)** — exactly one of: **Poor prompt / task copy** | **Writer or recording inaccuracy** | **Model run** | **Elsewhere (seeded environment)** | **Elsewhere (verifier or rubric)** | **Elsewhere (tooling or infra)** | **Mixed** | **Unclear** — plus **one short clause** of evidence (tool name + argument key, prompt quote, or verbatim verifier fragment).
   - **Tool strategy** (which apps/tools dominated).
   - **Value targeting** — Did the transcript show the agent **searching for / selecting** the entities and fields the prompt implies (issue keys, priorities, statuses, folders, threads, calendar names/ids, dates)? Cite **tool names** and **short argument excerpts** when possible. Flag **wrong filters**, **hallucinated ids**, or **skipping required discovery**. If tool JSON includes keys **not** mentioned in the prompt (e.g. \`importance\`, \`saveAsDraft\`), mention them when they relate to a verifier DB diff.
   - Notable mistakes; **step count and duration** from the metrics line; token/cost hints if visible.

4. \`## Workflow conformance\` — For **each run** (short \`### runN\` or compact bullets): does the trajectory **cover** the expected workflow steps in a **sensible order**? Missing steps, premature stops, duplicated work, or **steps done without required inputs**? Flag **conditional-branch errors** (data present in tool results but wrong branch or wrong tool variant). When prompts require **collective** actions (one artifact covering **all** recipients/issues), note **partial collapse** if only a subset is covered. When runs diverge, note whether divergence points to **Poor prompt** (interpretation spread) vs **Model run** (clear prompt, bad execution). If the prompt is ambiguous, say so and how different runs interpreted it.

5. \`## Detailed analysis by run\` — Same run order; per run \`### runN\` with:
   - **Issues encountered** — concrete problems. **If verifier output is included** and the run failed or partially failed: for **each** decisive \`[X]\` you discuss, use a mini-block: **Verifier line:** (verbatim or minimal edit); **Field meaning:** (e.g. Outlook \`messages.importance\` vs Jira priority—be precise); **Prompt binding:** **Prompt-constrained** (quote) or **Prompt-silent** (state omission); **Transcript:** tool name + argument fragment or “not visible in digest.” **Pattern (if applicable):** one label from **Operational failure modes** (e.g. **JQL / query fragility**, **Optional nested API fields omitted**, **Collective vs distributive**, **Conditional branch & state tracking**, **Wrong entity after broad recovery**, **Verifier strictness**, **Environment or MCP quirk**). **Cross-run:** if other runs pass, say what they did differently on the same field/arg when visible. For **calendarId** / calendar selection \`[X]\` where you lean **Writer or recording inaccuracy**, extend the mini-block with **Prompt evidence:** (quoted task substring naming calendar) and **Transcript evidence:** tool + args **and/or** tool **result** snippet showing the calendar id/name the agent used; then **Conclusion:** one sentence tying prompt + transcript vs verifier expected id. If you cannot fill **Prompt evidence** and **Transcript evidence** from the digest, label **Hypothesis:** or **Unclear**, not proven writer/QA. For **calendarId** errors without writer/QA claim, still note **which calendar the agent selected** (name/id from tools). If agent matched prompt intent but verifier expected another ID, describe **writer/recording vs verifier expectation** (not a vague “environment” label).

   - **Failure origin** — **Primary:** one label from the taxonomy above (same wording). **Why:** 1–3 sentences tied to evidence, including **prompt binding** for the main \`[X]\` if any. For **Writer or recording inaccuracy** on calendars, the **Why** must reference the same **prompt + transcript + verifier** strands as the mini-block (or say evidence incomplete). If **Mixed**, list **both** origins and the split reasoning. Apply calendar rules from the system prompt.

6. \`## Root cause summary\` — **Single consolidated diagnosis for this task across all runs.** Open with a **bold** line: **Primary failure origin:** \`<one taxonomy label>\` — then **one tight paragraph** expanding on that choice; if the failure was driven by specific \`[X]\` lines, name **table.field** (or verifier wording) and whether that dimension was **prompt-constrained** or **prompt-silent**. If multiple \`[X]\` lines exist, state **Dominant verifier failure:** (which line/pattern drives user impact) and **Secondary:** (others). Add a line **Primary operational pattern:** with one of the **Operational failure modes** labels when fit is clear (or **None clearly indicated**). Add **Secondary factors:** only if needed (bulleted sub-lines, each tagged with an origin label). Then **2–5 bullets** on **what to fix first** — name the owning team: **task author** (prompt), **writer/QA** (recordings, baseline alignment), **model / eval** (agent behavior), **platform** (seed data, verifier, tooling). For **calendarId** mismatches where you assign **Writer or recording inaccuracy** or lead with **writer/QA**, include **one compact sentence** in the paragraph or first fix bullet that repeats the **evidence bundle** (prompt quote + tool arg/result fragment + verifier expected/got)—or explicitly **Evidence incomplete in digest** and lower confidence. For **calendarId** mismatches where the agent plausibly followed a **named** calendar from the scenario, lead with **writer/QA** (re-record on correct calendar; align verifier expected id with scenario)—**not** “add numeric calendarId to prompt” per **Reasoning-first tasks** above. If runs disagree on origin, say which run is the **best reference** and why. End with one line **Confidence:** \`high\` / \`medium\` / \`low\` and what would raise it. Do **not** summarize verifier failures as generic “database” or “priority” issues without naming the verifier’s field/column.

Tone: precise, neutral, actionable. Synthetic company names and data are expected.`;

export async function generatePmgptFailureReportMarkdown(
  llmConfig: ResolvedLlmConfig,
  taskId: string,
  runs: RunLoaded[],
  taskPromptForLlm: string | null,
): Promise<string> {
  assertLlmConfigured(llmConfig);
  if (runs.length === 0) {
    throw new Error("No run*.json files found for this task.");
  }

  const promptForContext =
    taskPromptForLlm && taskPromptForLlm.length > 0
      ? trunc(taskPromptForLlm, MAX_TASK_PROMPT_FOR_LLM)
      : "(No user prompt extracted.)";

  const promptOutline = extractPromptWorkflowOutlineForLlm(taskPromptForLlm);

  const userParts = [
    `Task directory id: \`${taskId}\``,
    "",
    "When judging failures, use the **failure origin** taxonomy in the system message: **Poor prompt / task copy**, **Writer or recording inaccuracy**, **Model run**, **Elsewhere** (with seeded vs verifier vs tooling sub-tags), **Mixed**, or **Unclear**. Distinguish **true seeded-environment bugs** from **writer/QA baseline** mismatches (e.g. calendarId failures where the transcript shows the prompt-correct calendar).",
    "**Product default:** tasks reward **reasoning** (infer calendar/context from scenario)—for calendarId mismatches, recommend fixing **task creator recordings / baseline** to match verifier, not stuffing numeric calendar IDs into the prompt unless the system message’s exception applies.",
    "**Optional tool args:** when the prompt is silent on a flag (e.g. email importance), agents should use **defaults** or match passing runs—non-default values are **over-specification (Model run)**, not prompt ambiguity.",
    "**Writer/QA (calendar):** when claiming author/QA fault, include **prompt quote + tool arg/result + verifier line** from the digest; if missing, Hypothesis/Unclear.",
    "**Operational patterns:** actively scan digests for JQL/UUID fragility, omitted nested Jira fields, collective-vs-distributive collapse, wrong branch despite tool data, wrong tool variant (draft vs send), verifier-only requirements, env/MCP quirks; tag in detailed analysis and root cause.",
    "For each verifier \`[X]\` you discuss: quote **table / field / expected / got** from stdout; map to **prompt-constrained** vs **prompt-silent** tool args before choosing failure origin; do not conflate Jira **priority** with Outlook **importance** or other DB columns.",
    "",
    "### Task prompt (for this request; full prompt is in the saved file)",
    "",
    promptForContext,
    "",
    "### Auto-extracted prompt structure (refine in Expected workflow — may be noisy)",
    "",
    promptOutline,
    "",
    "### Per-run metrics (authoritative)",
    "",
    ...runs.map(
      (r) =>
        `- **${r.name}**: ${r.assistantSteps} assistant steps, duration ${r.durationLabel}${r.verifierSummaryCell !== "—" ? ` · verifier: ${r.verifierSummaryCell}` : ""}`,
    ),
    "",
    "### Transcript + optional verifier digests (truncated)",
    "",
  ];
  for (const r of runs) {
    userParts.push(
      "---",
      `## ${r.name} (${r.assistantSteps} steps, ${r.durationLabel}${r.verifierSummaryCell !== "—" ? "; verifier file present" : ""})`,
      "",
      r.digest,
      "",
    );
  }

  const model = getChatModel(llmConfig);
  const completion = await chatCompletionCreateAudited(
    llmConfig,
    "pmgpt-failure-task-report",
    {
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: REPORT_SYSTEM },
        { role: "user", content: userParts.join("\n") },
      ],
    },
  );

  const text = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new Error("Empty response from language model.");
  }
  return text;
}

export type GenerateOneResult =
  | { taskId: string; ok: true; writtenPath: string }
  | { taskId: string; ok: false; error: string };

export async function generateReportForTask(
  llmConfig: ResolvedLlmConfig,
  taskId: string,
): Promise<GenerateOneResult> {
  if (!isSafeTaskDirName(taskId)) {
    return { taskId, ok: false, error: "Invalid task id." };
  }
  const root = getPmgptFailureAnalysisRoot();
  const taskDir = path.join(root, taskId);
  if (!existsSync(taskDir)) {
    return { taskId, ok: false, error: "Task directory not found." };
  }
  const files = await readdir(taskDir);
  const runFiles = files
    .filter((f) => /^run\d+\.json$/i.test(f))
    .sort((a, b) => {
      const na = Number.parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
      const nb = Number.parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
      return na - nb;
    });
  if (runFiles.length === 0) {
    return { taskId, ok: false, error: "No run*.json files in task folder." };
  }

  try {
    const loaded = await loadRunJsons(taskDir, runFiles);
    let taskPrompt: string | null = null;
    for (const r of loaded) {
      const p = extractTaskPromptFromTranscript(r.raw);
      if (p) {
        taskPrompt = p;
        break;
      }
    }
    const analysisMd = await generatePmgptFailureReportMarkdown(
      llmConfig,
      taskId,
      loaded,
      taskPrompt,
    );
    const preamble = buildReportPreamble(taskId, taskPrompt, loaded);
    const reportsDir = getPmgptFailureReportsDir();
    await mkdir(reportsDir, { recursive: true });
    const writtenPath = path.join(reportsDir, `${taskId}.md`);
    const verifierFiles = runFiles
      .map((rf) => rf.replace(/\.json$/i, ""))
      .filter((base) =>
        existsSync(path.join(taskDir, `${base}-verifier.json`)),
      );
    const vfNote =
      verifierFiles.length > 0
        ? ` verifier_json: ${verifierFiles.map((b) => `${b}-verifier.json`).join(", ")}`
        : "";
    const header = `<!-- generated: ${new Date().toISOString()} tool: pmgpt-failure-analysis task: ${taskId} runs: ${runFiles.join(", ")}${vfNote} -->\n\n`;
    const body = `${preamble}\n${analysisMd}\n`;
    await writeFile(writtenPath, header + body, "utf8");
    return { taskId, ok: true, writtenPath };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Generation failed";
    return { taskId, ok: false, error: msg };
  }
}

const OVERVIEW_MAX_INPUT_CHARS = 165_000;
const OVERVIEW_MIN_PER_TASK = 5_000;
const OVERVIEW_MAX_PER_TASK = 22_000;

/** Slice content under the first \`## {title}\` heading until the next \`##\` heading. */
function sliceAfterH2(markdown: string, title: string): string | null {
  const want = title.trim().toLowerCase();
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(/^##\s+(.+)$/);
    if (!m) continue;
    if (m[1].trim().toLowerCase() !== want) continue;
    const out: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^##\s/.test(lines[j].trim())) break;
      out.push(lines[j]);
    }
    const t = out.join("\n").trim();
    return t.length > 0 ? t : null;
  }
  return null;
}

/**
 * Prefer labeled sections so the cross-task model sees stats + prompt + analysis,
 * not a blind truncation of the whole file.
 */
function buildOverviewPerTaskBundle(
  taskId: string,
  strippedReport: string,
  maxTotal: number,
): string {
  const B = maxTotal;
  const stats = sliceAfterH2(strippedReport, "Run statistics");
  const taskPrompt = sliceAfterH2(strippedReport, "Task prompt");
  const taskOverview = sliceAfterH2(strippedReport, "Task overview");
  const expectedWorkflow = sliceAfterH2(
    strippedReport,
    "Expected workflow (from prompt)",
  );
  const runSummaries = sliceAfterH2(strippedReport, "Run summaries");
  const workflowConformance = sliceAfterH2(
    strippedReport,
    "Workflow conformance",
  );
  const detail = sliceAfterH2(strippedReport, "Detailed analysis by run");
  const rootCause = sliceAfterH2(strippedReport, "Root cause summary");

  const overhead = 650;
  const budget = Math.max(2200, B - overhead);

  let nStats = Math.min(3400, Math.floor(budget * 0.11));
  let nPrompt = Math.min(5000, Math.floor(budget * 0.18));
  let nOverview = Math.min(1600, Math.floor(budget * 0.055));
  let nExpected = Math.min(2800, Math.floor(budget * 0.11));
  let nRuns = Math.min(5200, Math.floor(budget * 0.175));
  let nConformance = Math.min(2000, Math.floor(budget * 0.072));
  let nDetail = Math.min(7200, Math.floor(budget * 0.2));
  let nRoot = Math.min(1900, Math.floor(budget * 0.063));

  const sumSlices = () =>
    nStats +
    nPrompt +
    nOverview +
    nExpected +
    nRuns +
    nConformance +
    nDetail +
    nRoot;
  while (sumSlices() > budget && nDetail > 1600) nDetail -= 150;
  while (sumSlices() > budget && nRuns > 2200) nRuns -= 150;
  while (sumSlices() > budget && nPrompt > 2000) nPrompt -= 120;
  while (sumSlices() > budget && nExpected > 1000) nExpected -= 120;
  while (sumSlices() > budget && nStats > 1200) nStats -= 100;
  while (sumSlices() > budget && nConformance > 900) nConformance -= 100;
  while (sumSlices() > budget && nRoot > 800) nRoot -= 80;
  while (sumSlices() > budget && nOverview > 400) nOverview -= 80;

  const blocks = [
    `## Source: ${taskId}`,
    "",
    "### Run statistics (from report)",
    stats ? trunc(stats, nStats) : "_No run statistics section found._",
    "",
    "### Task prompt (excerpt)",
    taskPrompt ? trunc(taskPrompt, nPrompt) : "_No task prompt section found._",
    "",
    "### Task overview (from per-task report)",
    taskOverview ? trunc(taskOverview, nOverview) : "_No task overview section found._",
    "",
    "### Expected workflow (from prompt) (excerpt)",
    expectedWorkflow
      ? trunc(expectedWorkflow, nExpected)
      : "_No expected-workflow section found (regenerate per-task report for this block)._",
    "",
    "### Run summaries (excerpt)",
    runSummaries ? trunc(runSummaries, nRuns) : "_No run summaries section found._",
    "",
    "### Workflow conformance (excerpt)",
    workflowConformance
      ? trunc(workflowConformance, nConformance)
      : "_No workflow-conformance section found (regenerate per-task report for this block)._",
    "",
    "### Detailed analysis by run (excerpt)",
    detail ? trunc(detail, nDetail) : "_No detailed analysis section found._",
    "",
    "### Root cause summary (excerpt)",
    rootCause
      ? trunc(rootCause, nRoot)
      : "_No root-cause summary section found (regenerate per-task report for this block)._",
  ];
  let assembled = blocks.join("\n\n");
  if (
    assembled.length < Math.min(B, strippedReport.length) * 0.25 &&
    !stats &&
    !detail
  ) {
    assembled = [
      `## Source: ${taskId}`,
      "",
      "### Full report (fallback — section parse missed headings)",
      trunc(strippedReport, B),
    ].join("\n\n");
  }
  return trunc(assembled, B);
}

const OVERVIEW_SYSTEM = `You write a **single cross-task Markdown report** for operators who compare many GPT agent failure analyses.

Each **Source** block is structured: **Run statistics** (verbatim table when present), **Task prompt** excerpt, **Task overview**, **Expected workflow (from prompt)**, **Run summaries**, **Workflow conformance**, **Detailed analysis by run**, and **Root cause summary** excerpts. Use all of these; the statistics table is authoritative for steps/duration per run when present. Prefer the **Root cause summary** (especially its **Primary failure origin** line) and **Workflow conformance** excerpts when stating what actually went wrong per task.

**Failure origins across tasks:** Operators need explicit buckets — not vague “agent vs env.” Use this lens on every excerpt: (1) **Poor prompt / task copy** — ambiguity or bad spec; (2) **Writer or recording inaccuracy** — human traces or verifier expectations misaligned with the written scenario (e.g. agent followed prompt-named calendar, verifier still fails on ID); (3) **Model run** — clear enough instructions and environment signal, but wrong tools/args or skipped steps; (4) **Elsewhere** — **seeded/fixture** vs **verifier/rubric** vs **tooling/infra** (say which). Prefer **Writer or recording inaccuracy** over **Elsewhere (seeded environment)** when calendar or baseline mismatch is the pattern and analysis says the agent matched prompt text. **Calendar ID expected-vs-got** in tables or bullets must **not** be summarized as “seed” or “model wrong id” without excerpt proof—default attribution in prose to **writer/QA recordings / baseline**.

**Operational failure modes (cross-task — mirror human postmortems):** Synthesize across excerpts, not only per-task origins. Look for recurring **mechanisms**: **JQL / query fragility** (empty results, unquoted UUIDs); **optional nested API fields omitted** (Jira priority/issue type in nested payloads while prompt was explicit); **collective vs distributive** (single email/meeting must cover all recipients—partial collapse); **conditional branch & wrong tool variant** (data present but wrong branch; \`reply\` vs \`draft\`); **wrong entity after broad search**; **verifier strictness / unwritten rubric**; **env or MCP quirk** (empty param breaks listing). When **all** models or runs in excerpts fail the same strict enum check, call out **prompt vs verifier semantics** or dataset issue—not only “weak model.”

When excerpts cite verifier or DB diffs, **reuse the exact field/table names** from the per-task report (e.g. \`messages.importance\`, \`expected 'normal', got 'high'\`)—do **not** merge unrelated concepts (e.g. Jira issue priority vs Outlook \`importance\`). When analysis says a field was **prompt-silent**, carry that through to recommendations (prompt vs rubric vs model defaults). **Silent optional args** (agent set non-default \`importance\`, etc.) → frame as **model should use defaults**, **not** as task ambiguity unless required routing/content was unclear.

**Calendar ID mismatches (reasoning-first):** When excerpts describe \`calendarId\` expected-vs-got (e.g. expected \`1\`, got \`5\`) and the agent may have followed a **named** calendar from the scenario, prioritize recommendations to **re-record or realign the task creator’s reference execution** (and verifier golden state) with the intended calendar—**not** “add the numeric calendar id to the task text” as the default fix. Literal IDs in prompts are a **last resort** only when excerpts show no reasonable scenario-based disambiguation or the agent clearly ignored stated calendar identity. **Per-task and cross-task writeups** that blame writer/QA must still include the **evidence bundle** (prompt quote + transcript tool arg/result + verifier line) when the digest supports it.

Output **Markdown only** (no outer code fence). Start with exactly this first line:
\`# PM GPT failure analysis — Cross-task summary\`

Then include these sections (use \`##\` headings in this order):

1. **## Executive summary** — 4–8 bullets. Name **concrete** dominant failure modes (e.g. wrong Jira transition, wrong email thread). Include **1–2 bullets on failure-origin distribution** across tasks when excerpts support it (how many tasks look like **Poor prompt** vs **Writer/recording** vs **Model run** vs **Elsewhere**). Call out **writer/recording** problems when excerpts show prompt-aligned agent behavior but verifier or baseline mismatch. If several tasks show **calendar ID expected-vs-got**, add one bullet that states clearly: **baseline/recording alignment (not model)** unless excerpts prove otherwise. Add **1 bullet on cross-task operational patterns** when two or more tasks share a mechanism (JQL fragility, nested field omissions, collective recipient collapse, verifier-only literals, etc.).

2. **## By-task snapshot** — A **Markdown table** with one row per source \`task_*\` id you were given. Columns (fill from excerpts; use **—** if unknown):
   - **Task** — the \`task_…\` id
   - **Runs (n)** — number of runs if inferable from the statistics table or text; else —
   - **Steps range** — min–max assistant steps across runs if numbers appear; else —
   - **Duration range** — min–max human-readable durations if present; else —
   - **Primary symptom** — 5–12 words: what went wrong for that task
   - **Primary failure origin** — one of: **Poor prompt** / **Writer/recording** / **Model run** / **Elsewhere (seed)** / **Elsewhere (verifier)** / **Elsewhere (tooling)** / **Mixed** / **Unclear** — optionally add a short parenthetical (e.g. calendar baseline)

3. **## Task author, verifier, seeded environment, and QA/recording baseline** — When excerpts mention **\`calendarId\`** or “calendar ID mismatch / expected \`N\`, got \`M\`”, start this **whole section** with one explicit sentence: **By default, treat calendar ID grading mismatches as writer/QA reference and recording alignment—not a model failure and not “bad seeded data”** unless the per-task excerpt shows the agent chose a calendar that **contradicts** the written scenario (then say **Model run** and why). Then two subsections:

   - **### Seeded state vs prompt** — **Only** objective fixture/DB gaps where the **written prompt** requires specific seeded entities or state and the environment **fails to provide** them (missing rows, wrong project data, etc.). **Do not** file **\`calendarId\` / expected-vs-got** items here: that pattern is **not** “seed vs prompt” in the sense of corrupt static data—it almost always reflects **which calendar the human reference trace was recorded on** vs which id the verifier expects. If you have no excerpt-backed **true** seed-vs-prompt contradiction, write **None clearly indicated in excerpts** (or one bullet only for genuine seed issues with \`task_…\` + evidence).

   - **### QA and recording alignment** — Put **every** \`task_…\` whose excerpt describes **calendar ID mismatch** (expected vs got) **here first**. For **each** such task, use a **small fixed template** (not a single vague sentence): **Recording/baseline issue (not model):** \`task_…\` · **Verifier:** paste expected vs got from excerpt. · **Prompt evidence:** quote or tightly paraphrase from the excerpt’s **Task prompt** section the phrase that names or implies which calendar to use (if absent, write **No calendar cue in excerpt**). · **Transcript evidence:** name the **tool** (\`outlook__…\`, etc.) and paste a **short** fragment from the excerpt’s digest showing \`calendarId\` / calendar **name** in **arguments** and/or a **tool result** (list/search calendars, event create—whichever appears). · **Conclusion:** one sentence explaining how prompt + transcript together support “agent matched scenario” while verifier expected another id. If **Transcript evidence** or **Prompt evidence** is missing from excerpts, write **Insufficient excerpt evidence—Hypothesis only** and do **not** claim proven author/QA fault. If no calendar items, say **None clearly indicated in excerpts**. Non-calendar baseline issues: same template where applicable (prompt + transcript + verifier).

4. **## Recurring themes (with evidence)** — Grouped **###** sub-themes spanning **both** agent mistakes **and** verifier/setup issues. **Prefer** subheaders that match **Operational failure modes** when applicable (e.g. \`### JQL / query fragility\`, \`### Optional nested API fields omitted\`, \`### Collective vs distributive recipient collapse\`, \`### Verifier strictness or unwritten rubric\`, \`### Environment or MCP quirks\`). For each theme, include **2+ bullet lines** that each cite a specific **\`task_…\`** id and **one concrete detail** (tool name, wrong parameter, seeded-state mismatch, etc.). Prefer naming tools as they appear (e.g. \`outlook__…\`, \`jira__…\`).

5. **## Tooling and integration** — APIs/tools that mislead agents, missing capabilities, brittle JSON, noisy or empty tool payloads, or repeated retries. Name tools and failure shapes **with examples tied to task ids**.

6. **## Run dynamics** — Where **Run statistics** tables give numbers, summarize cross-task patterns: long runs vs short runs, high step counts vs failures, correlation hints. If numbers are incomplete in excerpts, say **"partial data in excerpt"** and still describe what you can see.

7. **## Task / rubric design signals** — Instruction ambiguity, conflicting goals, hidden ordering dependencies, over-constrained tool use. **Do not** treat **prompt-silent optional** tool fields (e.g. Outlook \`importance\` when the task never mentions urgency) as “ambiguous prompts” or “implicit expectations in copy”—those are **model over-specification** / default-adherence failures; cite **Model run** and **eval** (train agents to omit or default optional args) unless excerpts show genuine **required** ambiguity. Tie to **specific tasks** when possible. Include **prompt vs verifier enum mismatch** (e.g. natural-language “task” vs strict **Task** type) when excerpts show both models failing the same check.

8. **## Failure mode patterns (cross-task)** — A **Markdown table** with columns **Pattern** | **Example tasks** (\`task_…\` ids, comma-separated) | **Notes** (1 sentence: mechanism + whether model vs verifier vs tooling). Include at least **one row** when excerpts support any operational pattern; if none, write **None clearly indicated in excerpts**. Rows should complement (not duplicate verbatim) **Recurring themes**.

9. **## Recommendations** — Numbered list, **most important first**. Include actions for **QA and recording review** (re-record or align **task creator reference** with verifier-expected calendar when \`calendarId\` mismatches appear and the agent followed scenario-named calendars—**before** suggesting literal IDs in prompt copy), **task authors & verifiers** (seed data, fixtures; clarify **natural-language** calendar identity when prompts are ambiguous; align **Task vs Sub-task** wording with verifier), **tooling**, and **eval infra** separately where relevant. Do **not** default to “put calendarId in the prompt” for reasoning tasks. Call out **JQL/UUID handling**, **nested field coverage in evals**, and **verifier literal strictness** when those patterns appeared. Avoid generic platitudes.

Rules:
- **Specificity over vagueness**: prefer named tools, **verifier table/field names**, fields, and \`task_*\` ids over abstract wording.
- **Writer/QA calendar claims:** every \`task_…\` bullet under **QA and recording alignment** for calendarId must include **Prompt evidence** + **Transcript evidence** (tool + fragment) when present in excerpts; otherwise **Insufficient excerpt evidence**.
- Do **not** invent tasks, run counts, or timings that are absent from the excerpts; when unsure, write **unclear from excerpt**.
- Synthetic company names and data are expected.`;

export async function loadPerTaskReportsForOverview(
  maxCharsPerTask: number,
): Promise<{ taskId: string; body: string }[]> {
  const dir = getPmgptFailureReportsDir();
  if (!existsSync(dir)) {
    return [];
  }
  const files = await readdir(dir);
  const taskMd = files.filter((f) => /^task_[a-zA-Z0-9_-]+\.md$/i.test(f));
  taskMd.sort((a, b) => a.localeCompare(b));
  const out: { taskId: string; body: string }[] = [];
  for (const f of taskMd) {
    const taskId = f.replace(/\.md$/i, "");
    const raw = await readFile(path.join(dir, f), "utf8");
    const stripped = raw.replace(/^<!--[\s\S]*?-->\s*/, "").trim();
    out.push({
      taskId,
      body: buildOverviewPerTaskBundle(taskId, stripped, maxCharsPerTask),
    });
  }
  return out;
}

export async function generatePmgptFailureOverviewMarkdown(
  llmConfig: ResolvedLlmConfig,
  bundle: string,
  sourceTaskCount: number,
): Promise<string> {
  assertLlmConfigured(llmConfig);
  const user = [
    `You are summarizing **${sourceTaskCount}** per-task GPT failure analysis reports.`,
    "Each **## Source: task_…** block is **structured**: run statistics (often a Markdown table), task prompt excerpt, per-task overview, expected workflow excerpt, run summaries (with per-run **failure origin** hints), workflow conformance, detailed analysis excerpt, and root-cause summary (with **Primary failure origin**). Prefer facts from these blocks over guessing.",
    "Treat **Writer or recording inaccuracy** as distinct from **Model run** and from **Elsewhere (seeded environment)**—especially when verifier shows calendarId mismatch but per-task analysis notes the agent chose the prompt-aligned calendar (reference traces or QA baseline may encode a different calendar than the verifier expects).",
    "For calendarId themes across tasks: default recommendations to **align task creator recordings / baseline with verifier**—not adding numeric calendar IDs to prompts (reasoning-first tasks).",
    "In **## Task author, verifier…**, put calendar ID mismatches under **QA and recording alignment** with **Recording/baseline issue (not model):**—not under **Seeded state vs prompt** unless excerpts prove true seed-vs-prompt contradiction.",
    "For writer/QA calendar rows in the overview, each task must include **Prompt evidence** + **Transcript tool/result fragment** + **Verifier expected/got** when excerpts contain them; otherwise state insufficient excerpt evidence.",
    "Do not label **prompt-silent** optional tool fields (e.g. \`importance\`) as cross-task **prompt ambiguity**—treat as **model over-specification** / default adherence unless required substance was unclear.",
    "Synthesize **operational failure modes** across tasks (JQL/UUID, nested Jira fields omitted, collective recipient collapse, wrong branch/tool variant, verifier-only literals, MCP/env quirks)—include the **Failure mode patterns** table in the overview output.",
    "Excerpts may still be truncated per task for context limits — when data is missing, say so explicitly.",
    "",
    bundle,
  ].join("\n");

  const model = getChatModel(llmConfig);
  const completion = await chatCompletionCreateAudited(
    llmConfig,
    "pmgpt-failure-overview",
    {
      model,
      temperature: 0.22,
      messages: [
        { role: "system", content: OVERVIEW_SYSTEM },
        { role: "user", content: user },
      ],
    },
  );

  const text = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new Error("Empty response from language model.");
  }
  return text;
}

export type GenerateOverviewResult =
  | { ok: true; writtenPath: string; sourceTaskCount: number }
  | { ok: false; error: string };

export async function generateOverviewReport(
  llmConfig: ResolvedLlmConfig,
): Promise<GenerateOverviewResult> {
  try {
    const dir = getPmgptFailureReportsDir();
    if (!existsSync(dir)) {
      return {
        ok: false,
        error:
          "Reports directory does not exist yet. Generate at least one per-task report first.",
      };
    }
    const files = (await readdir(dir)).filter((f) =>
      /^task_[a-zA-Z0-9_-]+\.md$/i.test(f),
    );
    if (files.length === 0) {
      return {
        ok: false,
        error:
          "No per-task reports (task_*.md) found. Generate per-task reports before building the cross-task summary.",
      };
    }

    const perTaskBudget = Math.min(
      OVERVIEW_MAX_PER_TASK,
      Math.max(
        OVERVIEW_MIN_PER_TASK,
        Math.floor(OVERVIEW_MAX_INPUT_CHARS / Math.max(1, files.length)),
      ),
    );

    const chunks = await loadPerTaskReportsForOverview(perTaskBudget);
    let bundle = chunks
      .map((c) => `## Source: ${c.taskId}\n\n${c.body}`)
      .join("\n\n---\n\n");
    bundle = trunc(bundle, OVERVIEW_MAX_INPUT_CHARS);

    const markdown = await generatePmgptFailureOverviewMarkdown(
      llmConfig,
      bundle,
      chunks.length,
    );
    await mkdir(dir, { recursive: true });
    const writtenPath = getPmgptFailureOverviewReportPath();
    const header = `<!-- generated: ${new Date().toISOString()} tool: pmgpt-failure-analysis kind: cross-task-overview source_tasks: ${chunks.length} -->\n\n`;
    await writeFile(writtenPath, header + markdown, "utf8");
    return { ok: true, writtenPath, sourceTaskCount: chunks.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Overview generation failed";
    return { ok: false, error: msg };
  }
}

export type PmgptFailureReportsZipResult = {
  buffer: Buffer;
  fileCount: number;
  /** Suggested download filename (ASCII). */
  filename: string;
};

/**
 * Zip every `task_*.md` plus `pmgpt-failure-overview.md` when present under `reports/`.
 */
export async function buildPmgptFailureReportsZip(): Promise<PmgptFailureReportsZipResult | null> {
  const dir = getPmgptFailureReportsDir();
  if (!existsSync(dir)) {
    return null;
  }

  const zip = new JSZip();
  let fileCount = 0;

  const overviewPath = getPmgptFailureOverviewReportPath();
  if (existsSync(overviewPath)) {
    zip.file(
      PMGPT_FAILURE_OVERVIEW_BASENAME,
      await readFile(overviewPath, "utf8"),
    );
    fileCount += 1;
  }

  const taskNames = (await readdir(dir)).filter((f) =>
    /^task_[a-zA-Z0-9_-]+\.md$/i.test(f),
  );
  taskNames.sort((a, b) => a.localeCompare(b));
  for (const name of taskNames) {
    zip.file(name, await readFile(path.join(dir, name), "utf8"));
    fileCount += 1;
  }

  if (fileCount === 0) {
    return null;
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `pmgpt-failure-reports-bundle-${stamp}.zip`;

  return { buffer, fileCount, filename };
}
