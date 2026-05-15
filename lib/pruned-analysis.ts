import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  supportsChatJsonObjectResponseFormat,
  type ResolvedLlmConfig,
} from "@/lib/llm-config";
import { chatCompletionCreateAudited, getChatModel } from "@/lib/llm";
import type { EnvFilter } from "@/lib/task-environment";

/**
 * **Pruned task** analysis: reads exported pruned-status inputs, asks the LLM for themes and
 * evidence-backed summaries for the pruned-analysis report UI. Paths and truncation limits are
 * sized for typical model context windows.
 */
const PRUNED_SOURCE_DIR = "all_prompt_status";
const MAX_PROMPTS_FOR_ANALYSIS = 80;
const MAX_PROMPT_CHARS = 2400;
const MAX_CORE_NOTES_CHARS = 3000;
const MAX_ADDITIONAL_CONTEXT_CHARS = 12000;
const MAX_GUIDELINE_CHARS = 3500;

const evidencePromptSchema = z.object({
  key: z.string().min(1),
  prompt: z.string().min(1),
  /** Truncated reviewer notes from pruned-details CSV when present */
  coreNotes: z.string().min(1).optional(),
});

const themeSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  evidenceTaskKeys: z.array(z.string().min(1)).min(1).max(6),
  evidencePrompts: z.array(evidencePromptSchema).optional(),
});

const recommendationSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
});

export const prunedTasksAnalysisSchema = z.object({
  overview: z.string().min(1),
  commonThemes: z.array(themeSchema).min(3).max(6),
  recurringTargets: z.array(z.string().min(1)).min(3).max(10),
  recommendations: z.array(recommendationSchema).min(3).max(6),
});

export type PrunedTasksAnalysis = z.infer<typeof prunedTasksAnalysisSchema>;

type PrunedSourceRow = {
  id?: unknown;
  key?: unknown;
  created_at?: unknown;
  eval_task_versions?: {
    prompt?: unknown;
    env_key?: unknown;
    version_no?: unknown;
  } | null;
};

type PromptSample = {
  id: string;
  key: string;
  createdAt: string;
  envKey: string;
  versionNo: string;
  promptForLlm: string;
  fullPrompt: string;
  coreNotes?: string;
};

type GuidelineRef = {
  id: string;
  name: string;
  content: string;
};

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}… [truncated]`;
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

/**
 * Remove explicit task identifiers from prose so report text stays pattern-level.
 * Evidence still lives in `evidenceTaskKeys` / `evidencePrompts`.
 */
function removeSpecificTaskMentions(text: string): string {
  return text
    .replace(/\btask[_\s-]*\d+\b/gi, "this task")
    .replace(/\bpruned\s+task\s+\d+\b/gi, "this task")
    .replace(/\bTask\s+\d+\b/g, "this task")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Map model-provided evidence strings to loaded samples. The model often returns
 * placeholders like "task_25" that do not match real "- key:" values.
 */
function resolveSampleForEvidenceKey(
  rawKey: string,
  samples: PromptSample[],
): PromptSample | null {
  const key = rawKey.trim();
  if (!key) return null;

  const byNorm = new Map(
    samples.map((s) => [normalizeKey(s.key), s] as const),
  );
  const norm = normalizeKey(key);
  const direct = byNorm.get(norm);
  if (direct) return direct;

  const ordinal = /^task[_\s-]*(\d+)$/i.exec(key);
  if (ordinal) {
    const n = parseInt(ordinal[1], 10);
    if (n >= 1 && n <= samples.length) return samples[n - 1];
  }

  const digitsOnly = /^(\d+)$/.exec(key);
  if (digitsOnly) {
    const n = parseInt(digitsOnly[1], 10);
    if (n >= 1 && n <= samples.length) return samples[n - 1];
  }

  for (const s of samples) {
    const skn = normalizeKey(s.key);
    if (skn.includes(norm) && norm.length >= 12) return s;
    if (norm.includes(skn) && skn.length >= 12) return s;
  }

  return null;
}

function buildEvidencePromptsForTheme(
  evidenceTaskKeys: string[],
  samples: PromptSample[],
): { key: string; prompt: string; coreNotes?: string }[] {
  const out: { key: string; prompt: string; coreNotes?: string }[] = [];
  const seen = new Set<string>();
  for (const k of evidenceTaskKeys) {
    const sample = resolveSampleForEvidenceKey(k, samples);
    if (!sample) continue;
    const nk = normalizeKey(sample.key);
    if (seen.has(nk)) continue;
    seen.add(nk);
    const notesRaw = sample.coreNotes?.trim();
    const notes =
      notesRaw && notesRaw.length > 0
        ? truncate(notesRaw, MAX_CORE_NOTES_CHARS)
        : undefined;
    const row: { key: string; prompt: string; coreNotes?: string } = {
      key: sample.key,
      prompt: sample.fullPrompt,
    };
    if (notes) row.coreNotes = notes;
    out.push(row);
  }
  return out;
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    const next = i + 1 < content.length ? content[i + 1] : "";
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (ch === "\r") {
      continue;
    }
    cell += ch;
  }

  // Final cell/row
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function loadCoreNotesByTaskKey(
  detailsRelativePath: string,
): Promise<Map<string, string>> {
  const detailsPath = path.join(process.cwd(), detailsRelativePath);
  let raw: string;
  try {
    raw = await readFile(detailsPath, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") return new Map();
    throw e;
  }

  const rows = parseCsv(raw);
  if (rows.length === 0) return new Map();
  const headers = rows[0].map(normalizeHeader);
  const taskKeyIdx = headers.findIndex((h) => h === "task_key");
  const coreNotesIdx = headers.findIndex((h) => h === "core_notes");
  if (taskKeyIdx < 0 || coreNotesIdx < 0) return new Map();

  const out = new Map<string, string>();
  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    const taskKey = (r[taskKeyIdx] ?? "").trim();
    const notes = (r[coreNotesIdx] ?? "").trim();
    if (!taskKey || !notes) continue;
    out.set(normalizeKey(taskKey), truncate(notes, MAX_CORE_NOTES_CHARS));
  }
  return out;
}

function extractJsonObject(text: string): string {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Model did not return a JSON object");
  }
  return cleaned.slice(start, end + 1);
}

async function loadPrunedPromptSamples(
  sourceRelativePath: string,
): Promise<PromptSample[]> {
  const sourcePath = path.join(process.cwd(), sourceRelativePath);
  const raw = await readFile(sourcePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Pruned source file must be an array");
  }

  const rows = parsed as PrunedSourceRow[];
  const samples: PromptSample[] = [];
  for (const row of rows) {
    const promptRaw = row.eval_task_versions?.prompt;
    if (typeof promptRaw !== "string" || promptRaw.trim().length === 0) {
      continue;
    }
    samples.push({
      id: typeof row.id === "string" ? row.id : "(unknown-id)",
      key: typeof row.key === "string" ? row.key : "(unknown-key)",
      createdAt:
        typeof row.created_at === "string" ? row.created_at : "(unknown-date)",
      envKey:
        typeof row.eval_task_versions?.env_key === "string"
          ? row.eval_task_versions.env_key
          : "(unknown-env)",
      versionNo:
        typeof row.eval_task_versions?.version_no === "number"
          ? String(row.eval_task_versions.version_no)
          : "(unknown-version)",
      promptForLlm: truncate(promptRaw, MAX_PROMPT_CHARS),
      fullPrompt: promptRaw.trim(),
    });
    if (samples.length >= MAX_PROMPTS_FOR_ANALYSIS) break;
  }
  return samples;
}

export async function runPrunedTasksAnalysis(
  llmConfig: ResolvedLlmConfig,
  environment: EnvFilter,
  guidelines: GuidelineRef[],
  additionalContext?: string | null,
): Promise<{ report: PrunedTasksAnalysis; sampleCount: number; sourcePath: string }> {
  const envFileStem =
    typeof environment === "object" && environment.kind === "raw_env"
      ? environment.normalized
      : environment;
  if (
    !envFileStem ||
    envFileStem === "all" ||
    envFileStem === "unmapped"
  ) {
    throw new Error(
      "Select a specific environment with ingested prompts to run pruned analysis.",
    );
  }
  const sourceRelativePath = `${PRUNED_SOURCE_DIR}/${envFileStem}-pruned.json`;
  const detailsRelativePath = `${PRUNED_SOURCE_DIR}/${envFileStem}-pruned-details.csv`;

  const samples = await loadPrunedPromptSamples(sourceRelativePath);
  if (samples.length === 0) {
    throw new Error(
      `No prompts found in ${sourceRelativePath} (missing eval_task_versions.prompt).`,
    );
  }
  const coreNotesByTaskKey = await loadCoreNotesByTaskKey(detailsRelativePath);
  const samplesWithNotes = samples.map((s) => ({
    ...s,
    coreNotes: coreNotesByTaskKey.get(normalizeKey(s.key)),
  }));

  const trimmedContext =
    typeof additionalContext === "string"
      ? additionalContext.trim().slice(0, MAX_ADDITIONAL_CONTEXT_CHARS)
      : "";

  const contextBlock =
    trimmedContext.length > 0
      ? `\n\nAdditional operator context (authoritative):\n${trimmedContext}\n`
      : "";

  const guidelineBlock =
    guidelines.length > 0
      ? `\n\nGuidelines below are for your context only (expectations/rubric text). Task writers cannot change rubrics, verifiers, or these documents — do not tell them to. Use this material to interpret failures; all user-facing advice must target edits to the **task prompt / instructions** only.\n${guidelines
          .map(
            (g, i) =>
              `### Guideline ${i + 1}: ${g.name} (${g.id})\n${truncate(g.content, MAX_GUIDELINE_CHARS)}\n`,
          )
          .join("\n")}`
      : "\n\nNo guideline documents were provided for this run.";

  const promptBlock = samplesWithNotes
    .map(
      (s, i) =>
        `### Pruned task ${i + 1}\n- key: ${s.key}\n- id: ${s.id}\n- created_at: ${s.createdAt}\n- env_key: ${s.envKey}\n- version_no: ${s.versionNo}\n\nPrompt:\n${s.promptForLlm}\n${s.coreNotes ? `\nManual reviewer core notes:\n${s.coreNotes}\n` : ""}`,
    )
    .join("\n");

  const userContent = `Analyze this pruned-task dataset as a model-execution failure postmortem and identify cross-task patterns.\n\nSource file: ${sourceRelativePath}\nSelected environment: ${envFileStem}\nSample count provided: ${samples.length}\n\n${promptBlock}${guidelineBlock}${contextBlock}\n\nAudience: task authors. Every theme, overview paragraph, recurring target, and recommendation must be actionable by **editing the task prompt/instructions only** — not rubrics, verifiers, guidelines, the eval platform, infra, or environment.\n\n**Task design goal:** tasks should stay **complex and reasoning-heavy**. Advice must reduce genuine ambiguity and contradictions, not replace reasoning with hand-holding (no "dumb down into tiny numbered steps", no spoon-fed execution playbooks).\nReturn only valid JSON for the requested schema.`;

  const system = `You are analyzing a dataset of task prompts that were pruned because they caused issues in an evaluation environment.
Write from the perspective of a model/agent that fails during execution of these tasks (execution-path perspective, not just writing-quality perspective).

Primary audience: task writers preparing prompts for this environment. **Writer-actionable focus (mandatory):**
- Writers control **only** the task prompt/instructions (wording, structure, clarity). They do **not** control rubrics, verifiers, automated checks, or guideline documents — **never** recommend changing those; never frame advice as "align the rubric", "fix the verifier", or "update the evaluation spec".
- Center patterns the author can influence **in the prompt text** without lowering difficulty: a sharp high-level objective, **non-contradictory** constraints and dependencies, explicit deliverables/done-state, surfacing hidden assumptions that cause *misinterpretation* (not listing every micro-action), scope boundaries, and feasibility of the requested outcome within a typical agent loop. Prefer fixing **confusion and inconsistency** over adding exhaustive step-by-step recipes.
- **Complexity stance (mandatory):** These tasks are meant to require **multi-step reasoning**. Do **not** recommend generic hand-holding: breaking work into trivial sequential micro-steps, numbering every sub-action, "walk through each operation in order", or other patterns that mainly remove reasoning load. If execution failed, attribute it to **fixable specification problems** (missing/incorrect done-state, conflicting requirements, unstated invariants, overloaded instructions) rather than "simplify until the model can follow blindly."
- **De-emphasize or omit** dominant narratives about pure environment/infrastructure failures (e.g. broken sandboxes, flaky hosts, missing system packages, platform outages, evaluator bugs, dataset tooling issues) unless you reframe them as **prompt-side mitigations** (narrower scope, clearer preconditions and outputs spelled out in the instructions, explicit fallbacks) that reduce sensitivity to those conditions.
- If reviewer notes or evidence show a failure is **only** environmental or verifier-side with nothing to improve in the task text, do **not** build themes or recommendations around that case; skip it or briefly acknowledge mixed evidence without blaming writers for platform issues.
- Do not tell writers to "fix the environment", "upgrade the stack", or rely on operational changes they cannot make from a prompt.

Output only valid JSON with this exact shape:
{
  "overview": string,
  "commonThemes": [
    { "title": string, "body": string, "evidenceTaskKeys": [string, ...] }
  ],
  "recurringTargets": [string, ...],
  "recommendations": [
    { "title": string, "body": string }
  ]
}

Rules:
- Focus on concrete cross-task patterns; avoid generic statements.
- Detail level is mandatory: be highly specific about failure mechanics, trigger conditions, and downstream effects **that writers can address by changing the task**.
- If "Manual reviewer core notes" are present, use them to separate (a) issues addressable in **prompt wording** from (b) pure environment or checker-stack issues outside the writer's control. Weight themes and evidence toward (a). For (b), only include content when you can pair it with a concrete **instruction-text** change that reduces impact.
- overview: 1-2 dense paragraphs summarizing dominant **writer-addressable** failure modes, where in execution they tend to surface (planning, tool calls, filesystem/git actions, handoff), and how prompt design choices make success brittle. Avoid centering failures that are only about rubric/verifier implementation.
- commonThemes: 3-6 themes, each with a detailed paragraph (4-8 sentences) explaining how and why failure emerges from a model-execution perspective in ways **task authors can mitigate in the prompt** while keeping tasks **hard and reasoning-driven** — e.g. conflicting constraints, unstated invariants, ambiguous done-state, overloaded or self-contradictory paragraphs, implicit dependencies — **not** "the model needs more explicit step-by-step guidance" as a default diagnosis. Do **not** include "Guideline relation" callouts or name guideline documents as something to change.
- Do not reference specific task ids/ordinals in prose (e.g., "task_21", "Pruned task 5"). Keep body text generalized at the pattern level; use evidenceTaskKeys for task-level references.
- evidenceTaskKeys must list the real task identifiers from this dataset only. Copy each value **exactly** from a "- key: ..." line in the pruned task blocks (full task_key string). **Forbidden:** placeholders like "task_25", "Task 12", numeric-only ids, or invented shorthand — unless you also include the real key string from the same block. If you refer to "Pruned task N" in prose, evidenceTaskKeys must still use that block's actual "- key:" value.
- recurringTargets: 3-10 concise bullets naming **patterns in the tasks** (ambiguous success checks, overloaded multi-repo steps, implicit file layout, etc.) — not bare infra/service names unless tied to what the prompt should spell out or constrain.
- recommendations: 3-6 practical interventions for task writers only. Each body should be detailed (3-6 sentences) and include: what to change **in the task instructions**, why it prevents execution failure, and what failure it mitigates. **Forbidden:** asking writers to change rubrics, verifiers, checks, or guideline docs; recommendations that only ask operators to fix the environment, tooling, or evaluator implementation; recommendations whose main thrust is overscaffolding (e.g. "break into simpler steps", "number every step", "spell out the full procedure") unless the evidence shows a **specific** contradiction or missing invariant that such structure uniquely fixes — and even then, prefer minimal clarifications that preserve reasoning depth.
- Explicitly discuss writer-relevant failure signatures when supported by evidence: contradictory instructions, excessive multi-system coupling, ambiguous success criteria or deliverables **as stated in the prompt**, overlong instruction chains, missing guardrails around paths/branches/outputs described in the task text.
- In recommendations, include at least one action for each of these where evidenced: (a) clarify goals/deliverables/done-state **at the outcome level** without prescribing the full solution path, (b) resolve structural issues in the instructions (contradictions, buried constraints, overloaded paragraphs) **without** turning the task into a micro-step checklist, (c) writer self-checks for internal consistency and feasibility **of the draft instructions** (not of external rubrics).
- Do not include markdown, code fences, or extra keys.
- If evidence is mixed, call that out explicitly in overview/body text.`;

  const model = getChatModel(llmConfig);
  const completion = await chatCompletionCreateAudited(
    llmConfig,
    "pruned-analysis",
    {
      model,
      temperature: 0.25,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      ...(supportsChatJsonObjectResponseFormat(llmConfig)
        ? { response_format: { type: "json_object" } as const }
        : {}),
    },
  );

  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!raw) throw new Error("Empty response from language model");
  const report = prunedTasksAnalysisSchema.parse(
    JSON.parse(extractJsonObject(raw)) as unknown,
  );
  const reportWithEvidence: PrunedTasksAnalysis = {
    ...report,
    overview: removeSpecificTaskMentions(report.overview),
    commonThemes: report.commonThemes.map((theme) => ({
      ...theme,
      body: removeSpecificTaskMentions(theme.body),
      evidencePrompts: buildEvidencePromptsForTheme(
        theme.evidenceTaskKeys,
        samplesWithNotes,
      ),
    })),
    recommendations: report.recommendations.map((r) => ({
      ...r,
      body: removeSpecificTaskMentions(r.body),
    })),
  };
  return {
    report: reportWithEvidence,
    sampleCount: samples.length,
    sourcePath: sourceRelativePath,
  };
}

export function safeParseStoredPrunedTasksAnalysis(
  json: unknown,
): PrunedTasksAnalysis | null {
  const r = prunedTasksAnalysisSchema.safeParse(json);
  return r.success ? r.data : null;
}
