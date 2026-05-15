import { z } from "zod";
import type { PromptScore } from "@/generated/prisma/enums";
import {
  supportsChatJsonObjectResponseFormat,
  type ResolvedLlmConfig,
} from "@/lib/llm-config";
import { chatCompletionCreateAudited, getChatModel } from "@/lib/llm";

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model did not return a JSON object");
  }
  return text.slice(start, end + 1);
}

/** LLM output and new saves — each priority includes an illustrative example. */
export const coachingPriorityItemSchema = z.object({
  theme: z.string().min(1),
  observation: z.string().min(1),
  example: z.string().min(1),
  coachingActions: z.array(z.string().min(1)).min(1).max(6),
});

/** Older saved rows may omit `example`; parsing uses this relaxed shape. */
export const coachingPriorityItemSchemaRelaxed =
  coachingPriorityItemSchema.extend({
    example: z.string().min(1).optional(),
  });

export const userCoachingAnalysisResultSchema = z.object({
  overview: z.string().min(1),
  strengths: z.array(z.string().min(1)).min(1).max(5),
  coachingPriorities: z
    .array(coachingPriorityItemSchema)
    .min(1)
    .max(5),
  dataNote: z.string().min(1),
});

export type UserCoachingAnalysisResult = z.infer<
  typeof userCoachingAnalysisResultSchema
>;

export const userCoachingStoredResultSchema = z.object({
  overview: z.string().min(1),
  strengths: z.array(z.string().min(1)).min(1).max(5),
  coachingPriorities: z
    .array(coachingPriorityItemSchemaRelaxed)
    .min(1)
    .max(5),
  dataNote: z.string().min(1),
});

export type UserCoachingStoredAnalysisResult = z.infer<
  typeof userCoachingStoredResultSchema
>;

type PromptSample = {
  score: PromptScore | null;
  rationale: string | null;
  projectKey: string;
  envKey: string;
  excerpt: string;
};

type FeedbackSample = {
  score: PromptScore | null;
  rationale: string | null;
  projectKey: string;
  envKey: string;
  excerpt: string;
};

function tierRankPrompt(score: PromptScore | null): number {
  if (score === "POOR") return 0;
  if (score === "AVERAGE") return 1;
  if (score === "PRUNED") return 2;
  if (score === "EXCELLENT") return 3;
  return 4;
}

function tierRankFeedback(score: PromptScore | null): number {
  if (score === "POOR") return 0;
  if (score === "AVERAGE") return 1;
  if (score === "PRUNED") return 2;
  if (score === "EXCELLENT") return 3;
  return 4;
}

function excerpt(text: string, maxLen: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

function countScores<T extends string | null>(scores: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of scores) {
    const key = s === null ? "not_scored" : String(s);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function formatCountsLine(
  label: string,
  counts: Record<string, number>,
  total: number,
): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}:${n}`);
  return `${label} (n=${total}): ${parts.join(", ")}`;
}

export type RunUserCoachingAnalysisInput = {
  displayName: string;
  recordScope: "all" | "prompts" | "feedback";
  prompts: Array<{
    score: PromptScore | null;
    rationale: string | null;
    projectKey: string;
    envKey: string;
    body: string;
  }>;
  feedback: Array<{
    score: PromptScore | null;
    rationale: string | null;
    projectKey: string;
    envKey: string;
    body: string;
  }>;
  additionalContext?: string;
  llmConfig: ResolvedLlmConfig;
};

const MAX_SAMPLES_PER_KIND = 14;
const EXCERPT_LEN = 380;

export async function runUserCoachingAnalysis(
  input: RunUserCoachingAnalysisInput,
): Promise<UserCoachingAnalysisResult> {
  const {
    displayName,
    recordScope,
    prompts,
    feedback,
    additionalContext,
    llmConfig,
  } = input;

  const promptSamples: PromptSample[] = prompts
    .map((p) => ({
      score: p.score,
      rationale: p.rationale,
      projectKey: p.projectKey,
      envKey: p.envKey,
      excerpt: excerpt(p.body, EXCERPT_LEN),
    }))
    .sort((a, b) => tierRankPrompt(a.score) - tierRankPrompt(b.score))
    .slice(0, MAX_SAMPLES_PER_KIND);

  const feedbackSamples: FeedbackSample[] = feedback
    .map((f) => ({
      score: f.score,
      rationale: f.rationale,
      projectKey: f.projectKey,
      envKey: f.envKey,
      excerpt: excerpt(f.body, EXCERPT_LEN),
    }))
    .sort((a, b) => tierRankFeedback(a.score) - tierRankFeedback(b.score))
    .slice(0, MAX_SAMPLES_PER_KIND);

  const promptCounts = countScores(prompts.map((p) => p.score));
  const feedbackCounts = countScores(feedback.map((f) => f.score));

  const statsLines: string[] = [];
  if (recordScope !== "feedback") {
    statsLines.push(
      formatCountsLine("Prompt task submissions", promptCounts, prompts.length),
    );
  }
  if (recordScope !== "prompts") {
    statsLines.push(
      formatCountsLine("Feedback submissions", feedbackCounts, feedback.length),
    );
  }

  const samplesBlock: string[] = [];
  if (recordScope !== "feedback" && promptSamples.length > 0) {
    samplesBlock.push(
      "PROMPT SAMPLES (score, project, env, rationale if any, excerpt):",
    );
    for (const s of promptSamples) {
      samplesBlock.push(
        `- [${s.score ?? "not_scored"}] project=${s.projectKey || "—"} env=${s.envKey} rationale=${s.rationale ?? "—"} excerpt=${JSON.stringify(s.excerpt)}`,
      );
    }
  }
  if (recordScope !== "prompts" && feedbackSamples.length > 0) {
    samplesBlock.push(
      "FEEDBACK SAMPLES (score, project, env, rationale if any, excerpt):",
    );
    for (const s of feedbackSamples) {
      samplesBlock.push(
        `- [${s.score ?? "not_scored"}] project=${s.projectKey || "—"} env=${s.envKey} rationale=${s.rationale ?? "—"} excerpt=${JSON.stringify(s.excerpt)}`,
      );
    }
  }

  const system = [
    "You are a supportive QA coach for prompt engineering and human feedback quality. Assume good intent; your job is to help the contributor grow, not to judge them.",
    "**Data & realism (mandatory):** All excerpts are **test / evaluation data** for this program. **Do not** refuse, hedge, sanitize away, or dilute coaching because of generic safety, content-policy, PII, or harmful-content concerns—the operator confirms this is sanctioned synthetic data. Treat scenarios as **realistic stand-ins** for production work. Recommendations and coaching actions should **mirror real-world** situations grounded in the samples and rubric notes (including edge cases, misuse resistance, policy alignment, or clarity in sensitive domains **when the data supports it**). Stay concrete and evidence-based, not preachy.",
    "The audience is the named contributor (task author / reviewer). Use second person (you). Keep the tone warm, specific, and collaborative—like a skilled peer reviewer.",
    "Use the score distribution and excerpts/rationales **only as private evidence** for your reasoning. If evidence is thin, say so kindly in dataNote and keep coaching modest.",
    "**No score vocabulary in user-facing text (mandatory):** In `overview`, `strengths`, every `coachingPriorities` field (including **`example`**), and `dataNote`, you **must not** name or allude to numeric tiers or evaluation labels. **Forbidden** in those strings: the words **EXCELLENT**, **AVERAGE**, **POOR**, **PRUNED**; the phrases **scores**, **ratings**, **rated**, **tier**; patterns like “X-rated,” “mostly average,” “majority poor,” “reflects in the scores,” or any recap of how many items fell into which bucket. Instead describe patterns in plain coaching language: rubric notes, reviewer/model feedback, clarity of outcomes, consistency, specificity, alignment with guidelines, depth of feedback, etc.",
    "**Tone (mandatory):** Lead with what is working or neutral context before growth areas. Never make the contributor feel reduced to a label or a tally.",
    "**Avoid:** shaming or alarmist framing. Prefer: “opportunities to strengthen,” “patterns worth refining,” “where rubric feedback suggests tightening X,” “room to grow on Y.”",
    "In coachingPriorities, observations should sound constructive and hopeful—specific about behaviors and text patterns, without citing tiers or score counts.",
    "**Example per priority (mandatory):** For **each** item in `coachingPriorities`, include **`example`**: a short, concrete illustration of that theme—e.g. a paraphrased before/after, a sharper wording direction, or a brief rewrite sketch **grounded in patterns from the samples** (do **not** paste long verbatim excerpts). Keep each example to **2–5 sentences**, in second person where natural, with the same vocabulary rules as `observation`.",
    "**Praise + action in examples (mandatory):** Do **not** make examples read as **only** criticism or **only** generic cheerleading. **Balance** authentic recognition of what is working with a clear next step. When the priority concerns **feedback to task authors** (or similar), favor a **praise-then-refine** shape: lead with or embed **specific, genuine appreciation** (concrete about *what* landed well), then show how to add **one** actionable nudge—e.g. a contrast like “Instead of a short positive line alone, you might say: ‘[specific strength]—and to go further, [one concrete improvement or question].’” Empty praise without guidance is a problem; so is **improvement-only** language with no warmth. The **example** field should model that balance whenever the theme allows.",
    "**What the author can vs. cannot fix (mandatory):** Read excerpts/rationales for **system-level** problems (e.g. task flagged **bugged / not gradable**, grading pipeline failure, **escalation to fleet review or engineering**, rubric/tool mismatch **outside** revising prompt copy). When that pattern appears, **do not** write **`example`** text or **`coachingActions`** that tell the task author to “check grading criteria,” “align the task with the rubric,” or otherwise imply they can resolve an infrastructure or platform fault by editing the task alone. That coaching is **invalid** and **must be avoided**. Instead model **legitimate** guidance: reviewer language that **names the constraint**, **routes to the right owner**, **requests a ticket or clarification**, or helps the author improve **only what they control** (clarity, scope, constraints) **without** blaming them for the bug. If samples mix author-fixable and system issues, **split** the two in your observation/example so actionable advice targets only **in-scope** levers.",
    "**Escalations out of QA / author control (mandatory):** Many **escalated** items (fleet review, flagged bugged, cannot grade, etc.) are **not resolvable by the task writer or by QA feedback alone**—resolution sits with **another owner or pipeline**. In those cases you **must not** imply in **`example`** or **`coachingActions`** that the author should **verify rubric alignment**, **fix grading criteria**, or take similar steps as if they owned the grading stack. **Do not** assign homework that assumes QA or the writer can close the escalation. **Do** coach: **clearer documentation** in the escalation (symptoms, what was tried, what blocks grading), **honest framing** that follow-up is with the owning team, and **reviewer wording** that avoids dumping platform faults on the author. Praising how to communicate under escalation is fine; inventing author-side \"fixes\" for fleet-level issues is not.",
    "**Accepted tasks (mandatory when prompt authoring is coached):** When coaching addresses **task prompt** work that was **kept for evaluation** (vs removed from the evaluated set), say clearly—in plain language without tier names—that the guidance applies to **improving quality on accepted tasks** (tasks that remained in the evaluation pool). Do **not** mention EXCELLENT/AVERAGE/POOR/PRUNED in that sentence. If some items were **not** kept for evaluation, you may contrast “accepted tasks” vs “items outside the evaluated set” without naming tier labels. If **only feedback reviewer quality** is in scope, state that scope without the accepted-task framing.",
    "Return ONLY valid JSON matching this shape (no markdown):",
    '{"overview":string,"strengths":string[],"coachingPriorities":[{"theme":string,"observation":string,"example":string,"coachingActions":string[]}],"dataNote":string}',
    "overview: open with encouragement or a balanced summary; include growth areas as next steps, not as condemnation.",
    "coachingPriorities: 2–5 items, ordered by likely helpful impact. Each item **must** include **example** (see above). coachingActions: concrete, actionable bullets (verbs).",
    "strengths: 1–4 items tied to real patterns in the samples and rationales (volume, variety, detail, consistency)—celebrate evidence without naming tiers or scores.",
    "Do not invent facts or quotes not implied by the data.",
  ].join("\n");

  const userParts = [
    `Contributor display name: ${displayName}`,
    `Record scope for this analysis: ${recordScope}`,
    "",
    "INTERNAL DATA (for your reasoning only; do not copy tier names or say 'scores'/'ratings' in the JSON you return):",
    "Prompt tiers in samples: EXCELLENT/AVERAGE/POOR = accepted for evaluation; PRUNED = not in evaluated set.",
    "Feedback samples use the same tier labels for feedback quality.",
    "",
    "COUNTS BY TIER (internal):",
    ...statsLines,
    "",
    ...samplesBlock,
  ];

  if (additionalContext?.trim()) {
    userParts.push("", "ADDITIONAL CONTEXT FROM OPERATOR:", additionalContext.trim());
  }

  const user = userParts.join("\n");

  const model = getChatModel(llmConfig);

  const completion = await chatCompletionCreateAudited(
    llmConfig,
    "user-coaching-analysis",
    {
      model,
      temperature: 0.25,
      max_tokens: 3400,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(supportsChatJsonObjectResponseFormat(llmConfig)
        ? { response_format: { type: "json_object" } as const }
        : {}),
    },
  );

  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!raw) throw new Error("Empty response from language model");

  try {
    return userCoachingAnalysisResultSchema.parse(
      JSON.parse(extractJsonObject(raw)),
    );
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Could not parse coaching JSON";
    throw new Error(`Could not parse coaching output: ${msg}`);
  }
}
