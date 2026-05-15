import type { PrismaClient } from "@/generated/prisma/client";
import {
  type CoachingInsightReport,
  mergeExcellentBodiesIntoReport,
  parseCoachingInsightLlmResponse,
} from "@/lib/coaching-insight-report";
import { getDatasetImportedTasksGuidelineId } from "@/lib/guideline-scope";
import { filterRowsByEnv } from "@/lib/filter-prompts-by-env";
import { filterRowsByProject } from "@/lib/filter-prompts-by-project";
import {
  supportsChatJsonObjectResponseFormat,
  type ResolvedLlmConfig,
} from "@/lib/llm-config";
import { chatCompletionCreateAudited, getChatModel } from "@/lib/llm";
import { INSIGHTS_ELIGIBLE_SCORES } from "@/lib/prompt-score-insights";
import {
  type EnvFilter,
  getEnvFilterDescription,
  getEnvFilterShortLabel,
  getEnvironmentLabel,
} from "@/lib/task-environment";
import {
  getProjectFilterShortLabel,
  type ProjectFilter,
} from "@/lib/task-project";
import { taskLifecycleEligibleForLlmAnalysis } from "@/lib/task-lifecycle";

/**
 * Generates **coaching insight** reports: samples eligible prompts, calls the LLM with a structured
 * rubric, and merges results for the insights UI. Respects environment / project filters and dataset
 * guideline scope like other reporting flows.
 */
const MAX_BODY_CHARS = 1200;
const MAX_PER_TIER = 14;
const MAX_TOTAL_SAMPLES = 42;
const MAX_ADDITIONAL_CONTEXT_CHARS = 12000;
/** Per prompt in LLM user message (full text is merged into the saved report). */
const MAX_EXCELLENT_REF_CHARS_FOR_LLM = 4500;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… [truncated]`;
}

function noScoredMessage(
  _project: ProjectFilter,
  _filter: EnvFilter,
  hasGuidelineFilter: boolean,
): string {
  return hasGuidelineFilter
    ? "No scored prompts match the current project, environment, and rubric scope. Adjust filters or run scoring on more tasks in this scope."
    : "No scored prompts found for this project and environment. Run scoring on at least a few tasks in this scope first.";
}

function filterByGuidelineIds<T extends { guidelineId: string }>(
  rows: T[],
  ids: string[],
  datasetImportedGuidelineId: string | null,
): T[] {
  if (ids.length === 0) return rows;
  const set = new Set(ids);
  return rows.filter(
    (r) =>
      set.has(r.guidelineId) ||
      (datasetImportedGuidelineId != null &&
        r.guidelineId === datasetImportedGuidelineId),
  );
}

/**
 * Stratified sample of scored prompts for meta-analysis without blowing the context window.
 */
type InsightPromptHeavy = Awaited<
  ReturnType<
    PrismaClient["prompt"]["findMany"]
  >
>[number] & {
  guideline: { name: string; content: string };
};

export async function loadSampleForInsights(
  prisma: PrismaClient,
  projectFilter: ProjectFilter,
  envFilter: EnvFilter,
  guidelineIds: string[],
) {
  const datasetImportedGuidelineId =
    await getDatasetImportedTasksGuidelineId(prisma);
  /** Avoid loading every scored prompt body + full guideline text into RAM. */
  const light = await prisma.prompt.findMany({
    where: { score: { in: INSIGHTS_ELIGIBLE_SCORES } },
    select: {
      id: true,
      projectKey: true,
      envKey: true,
      guidelineId: true,
      analyzedAt: true,
      score: true,
      createdAt: true,
      sourceKey: true,
      extra: true,
    },
    orderBy: { analyzedAt: "desc" },
  });

  let all = filterRowsByProject(light, projectFilter);
  all = filterRowsByEnv(all, envFilter);
  all = filterByGuidelineIds(
    all,
    guidelineIds,
    datasetImportedGuidelineId,
  );
  all = all.filter((p) => taskLifecycleEligibleForLlmAnalysis(p.extra));

  if (all.length === 0) {
    return {
      samples: [] as InsightPromptHeavy[],
      counts: { EXCELLENT: 0, AVERAGE: 0, POOR: 0 },
    };
  }

  const buckets = {
    EXCELLENT: all.filter((p) => p.score === "EXCELLENT"),
    AVERAGE: all.filter((p) => p.score === "AVERAGE"),
    POOR: all.filter((p) => p.score === "POOR"),
  };

  const sampleIds: string[] = [];
  const used = new Set<string>();

  for (const tier of ["EXCELLENT", "AVERAGE", "POOR"] as const) {
    let tierCount = 0;
    for (const p of buckets[tier]) {
      if (tierCount >= MAX_PER_TIER || sampleIds.length >= MAX_TOTAL_SAMPLES) {
        break;
      }
      sampleIds.push(p.id);
      used.add(p.id);
      tierCount += 1;
    }
  }

  for (const p of all) {
    if (sampleIds.length >= MAX_TOTAL_SAMPLES) break;
    if (!used.has(p.id)) {
      sampleIds.push(p.id);
      used.add(p.id);
    }
  }

  const heavy =
    sampleIds.length === 0
      ? []
      : await prisma.prompt.findMany({
          where: { id: { in: sampleIds } },
          include: { guideline: { select: { name: true, content: true } } },
        });
  const byId = new Map(heavy.map((r) => [r.id, r] as const));
  const samples = sampleIds
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r != null);

  const counts = {
    EXCELLENT: buckets.EXCELLENT.length,
    AVERAGE: buckets.AVERAGE.length,
    POOR: buckets.POOR.length,
  };

  return { samples, counts };
}

async function fetchThreeExcellentPromptBodies(
  prisma: PrismaClient,
  projectFilter: ProjectFilter,
  envFilter: EnvFilter,
  guidelineIds: string[],
): Promise<[string, string, string]> {
  const datasetImportedGuidelineId =
    await getDatasetImportedTasksGuidelineId(prisma);
  const light = await prisma.prompt.findMany({
    where: { score: "EXCELLENT" },
    select: {
      id: true,
      projectKey: true,
      envKey: true,
      guidelineId: true,
      analyzedAt: true,
      extra: true,
    },
    orderBy: { analyzedAt: "desc" },
    take: 500,
  });

  let all = filterRowsByProject(light, projectFilter);
  all = filterRowsByEnv(all, envFilter);
  all = filterByGuidelineIds(
    all,
    guidelineIds,
    datasetImportedGuidelineId,
  );
  all = all.filter((p) => taskLifecycleEligibleForLlmAnalysis(p.extra));

  if (all.length < 3) {
    throw new Error(
      "Coaching insights require at least three EXCELLENT scored prompts in this scope (for the excellent-examples section). You may have enough AVERAGE/POOR tasks but not enough EXCELLENT; PRUNED rows never count; rows with task_lifecycle_status other than production are excluded. Widen rubrics, pick a single environment with more EXCELLENT tasks, or score more prompts.",
    );
  }

  const top = all.slice(0, 3);
  const bodies = await prisma.prompt.findMany({
    where: { id: { in: top.map((r) => r.id) } },
    select: { id: true, body: true },
  });
  const byId = new Map(bodies.map((r) => [r.id, r.body] as const));
  return [
    byId.get(top[0].id) ?? "",
    byId.get(top[1].id) ?? "",
    byId.get(top[2].id) ?? "",
  ];
}

export async function runCoachingInsights(
  prisma: PrismaClient,
  llmConfig: ResolvedLlmConfig,
  projectFilter: ProjectFilter,
  envFilter: EnvFilter,
  guidelineIds: string[],
  additionalContext?: string | null,
): Promise<{ report: CoachingInsightReport; summary: string }> {
  if (projectFilter === "all") {
    throw new Error(
      "Select a specific project (JSON import source) to generate insights.",
    );
  }
  if (envFilter === "all") {
    throw new Error("Select a specific evaluation environment (not “all”) to generate insights.");
  }

  const hasGuidelineFilter = guidelineIds.length > 0;
  const { samples, counts } = await loadSampleForInsights(
    prisma,
    projectFilter,
    envFilter,
    guidelineIds,
  );

  if (samples.length === 0) {
    throw new Error(noScoredMessage(projectFilter, envFilter, hasGuidelineFilter));
  }

  const excellentBodiesTuple = await fetchThreeExcellentPromptBodies(
    prisma,
    projectFilter,
    envFilter,
    guidelineIds,
  );

  const projectLabel = getProjectFilterShortLabel(projectFilter);
  const scopeLabel = getEnvFilterShortLabel(envFilter);
  const envDescription = getEnvFilterDescription(envFilter);
  const guidelineScopeNote = hasGuidelineFilter
    ? " Only the selected scoring rubrics apply."
    : " All relevant scoring rubrics in this environment are in scope.";

  const scopeNarrative = `All samples are from project **${projectLabel}**, evaluation environment **${scopeLabel}** (${envDescription || "context from task data"}).${guidelineScopeNote} Every section of your JSON must be specific to this project and environment only.

**Output policy (mandatory for every run):**
- **Data & realism:** All prompts and rubrics are **test / evaluation data** for this tool. **Do not** refuse, avoid, or hollow out guidance because of generic concerns about harmful content, policy, PII, or red-teaming. Treat scenarios as **realistic stand-ins** for operational work. Coach **concretely** from the evidence—including edge cases, misuse resistance, policy alignment, or clarity in sensitive domains **when the rubric or samples raise them**—always framed as **task design and rubric alignment**, not abstract moralizing.
- **Audience:** The reader is a **task writer** improving **their own** prompts—not a manager being told how to coach others. Do not recommend org-level “coaching” changes (reviewer training, coaching programs, hiring, review process redesign). **section3Items** must contain only concrete changes **the reader** can make **to their task text** to improve quality **in this environment** (e.g. clarity, constraints, scenario design, verifiability)—not meta-coaching or facilitator advice.
- **Voice (mandatory):** Write **every** user-visible string as if you are talking **directly to that task writer**. Use **second person** (you, your) for habits, pitfalls, and recommendations. **Forbidden** in **body** text and **excellentWhyItems:** phrases like “Encourage authors to…”, “Task authors should…”, “Have writers…”, “teams should…”, or any wording that addresses managers about “authors” instead of addressing the reader. **Prefer:** “Include… in your prompts”, “When you draft…”, “Avoid leaving…”, “Make the expected outcome checkable”, “This example works because…” (for excellent items, it is fine to describe **that** prompt while still sounding like advice **to the reader**, e.g. what **you** can mirror in **your** tasks). Short **titles** may stay imperative (“Clear commit messages”) or lead with **Your** when it reads naturally.
- **Tone (mandatory):** Be **supportive and growth-oriented**. Do **not** lead with shaming or deficit-heavy framing about score counts (e.g. “significant number of poor ratings,” “many low scores,” “concerning distribution”). Reference EXCELLENT / AVERAGE / POOR counts **neutrally** when needed; frame section2/3 guidance as **constructive patterns to refine**, not as judgment of the writer.
- **Accepted-task scope (mandatory):** This report’s prompt corpus is **only** tasks scored EXCELLENT, AVERAGE, or POOR—i.e. **accepted for evaluation**; PRUNED tasks are **not** in this analysis. You **must** state clearly in the environmentSubtitle field or in the opening sentence of the first section1Items body that the guidance is about **improving quality on accepted tasks** in this environment (not about recovering from PRUNED or changing acceptance rules unless the user message explicitly says otherwise).
- **Task design philosophy (mandatory):** This program **values tasks that require reasoning**—treat that as a **goal**, not a problem to eliminate. **Some intentional vagueness in the prompt is acceptable and can be desirable** when it still steers the user toward **one specific, checkable outcome** (one correct “shape” of answer, not many equally valid ones). **Do not** give blanket advice to “minimize ambiguity,” “avoid vague language,” or make every task maximally explicit **unless** the samples/rubric show that **true ambiguity** (multiple valid interpretations or outcomes) is the actual failure mode. **Distinguish:** (1) open or underspecified wording that still yields a **single** expected result and invites reasoning vs (2) wording that leaves **multiple** plausible tasks or answers. Praise or recommend reasoning-heavy prompts when the evidence supports it. **Discourage** treating **step-by-step hand-holding** (micro-managing every user action in the prompt) as the default definition of “excellent”—that style is **not** what we optimize for unless the rubric or scenario truly requires procedural fidelity. Prefer tasks that make the user/model **think**, not just follow a script.`;

  const guidelineNames = new Map<string, string>();
  for (const p of samples) {
    if (!guidelineNames.has(p.guidelineId)) {
      guidelineNames.set(
        p.guidelineId,
        `${p.guideline.name}\n---\n${truncate(p.guideline.content, 2000)}`,
      );
    }
  }

  const blocks = samples.map((p, i) => {
    const envLine = getEnvironmentLabel(p.envKey);
    return `### Sample ${i + 1} · ${p.score}\n**Evaluation environment:** ${envLine}\n**Guideline:** ${p.guideline.name}\n**Task id / key:** ${p.sourceKey ?? p.id}\n**Model rationale:** ${p.rationale ? truncate(p.rationale, 400) : "(none)"}\n**Prompt:**\n${truncate(p.body, MAX_BODY_CHARS)}\n`;
  });

  const scopeSummary = `Project **${projectLabel}**, environment **${scopeLabel}** only.${hasGuidelineFilter ? " Selected rubrics only." : ""}`;

  const trimmedAuthorContext =
    typeof additionalContext === "string"
      ? additionalContext.trim().slice(0, MAX_ADDITIONAL_CONTEXT_CHARS)
      : "";

  const authorContextBlock =
    trimmedAuthorContext.length > 0
      ? `

---
Author-provided context (facts about how tasks were authored, reviewed, or constrained — treat as authoritative when interpreting samples and writing recommendations; examples: scoring conventions, instructions to raters, or that prompts did not need to align with user stories):

${trimmedAuthorContext}
`
      : "";

  const excellentRefsForLlm = excellentBodiesTuple
    .map((fullBody, i) => {
      const shown =
        fullBody.length > MAX_EXCELLENT_REF_CHARS_FOR_LLM
          ? `${fullBody.slice(0, MAX_EXCELLENT_REF_CHARS_FOR_LLM)}… [truncated for context — full text appears in the saved report]`
          : fullBody;
      return `### EXCELLENT reference ${i + 1} (use only for writing excellentWhyItems[${i}], ranked newest-first in scope)\n${shown}`;
    })
    .join("\n\n");

  const excellentInstructions = `
Three prompts below are **EXCELLENT** in this scope (shown for analysis). Your JSON must include **excellentWhyItems**: exactly **three strings**, in the same order as EXCELLENT references 1→3. Each string is **only** the explanation (2–6 sentences): what makes **that** prompt strong **in this environment** for task design (including any risk-handling or policy-alignment strengths **when the prompt or rubric supports that reading**). Do **not** paste the prompt text into excellentWhyItems. Write each explanation **to the task writer** (what they can notice or mirror in **their** work)—never as meta-advice about “authors” or “writers” in the third person.

**excellentWhyItems — what to praise (mandatory):** Do **not** lead with or center “clear step-by-step instructions,” “walks the user through every action,” or similar **hand-holding** as the main virtue—we **discourage** over-specifying micro-steps as the default pattern. Instead, emphasize **reasoning** (what thinking the task elicits), **outcome and constraint clarity**, **one checkable result**, and strategic openness where appropriate. If a reference prompt happens to be procedural, you may note that briefly but still highlight **what you should learn** in terms of reasoning and outcome design—not “always spell out each step for the user.”

${excellentRefsForLlm}
`;

  const userContent = `${scopeSummary}

Corpus counts (full scored set in scope, not just samples):
- EXCELLENT: ${counts.EXCELLENT}
- AVERAGE: ${counts.AVERAGE}
- POOR: ${counts.POOR}
- Stratified sample size: ${samples.length}

Suggested header labels for JSON:
- environmentLabel: "${scopeLabel}"
- environmentSubtitle: a concise one-line tagline for this environment (e.g. product context). You may use: "${envDescription}" as a starting point or refine it from the evidence.

Rubric / scoring criteria referenced:
${[...guidelineNames.values()].join("\n\n---\n\n")}

Scored task samples:
${blocks.join("\n")}
${authorContextBlock}

${excellentInstructions}

Respond with ONLY valid JSON matching the schema in the system message — no markdown fences or commentary outside JSON.`;

  const jsonShape = `{
  "environmentLabel": string,
  "environmentSubtitle": string,
  "section1Items": [ { "title": string, "body": string }, ... ],
  "section2Items": [ ... ],
  "section3Items": [ ... ],
  "excellentWhyItems": [ string, string, string ]
}`;

  const system = `You help task writers improve their own prompt text. Output ONLY valid JSON (no markdown).

Schema:
${jsonShape}

Rules:
- **Voice:** Every "body" in section1–3 and every excellentWhyItems string must read as **direct guidance to the task writer** (you/your). Never write as if briefing a manager about “authors” or “writers.”
- section1Items: exactly 3 or 4 items. Each "title" is a short category (e.g. Scope, Realism, Reasoning / outcome clarity, Boundaries / misuse resistance—**when the rubric or samples warrant**). "body" is a clear paragraph (2–5 sentences) on what separates strong vs weak **task prompts** in **this environment** for that category, addressed **to the reader**. If you use a title like **Precision**, interpret it as **precision of the intended outcome and constraints**, not “make every sentence maximally explicit”: strong tasks may leave room for reasoning and strategic ambiguity while still locking in **one** valid result. These will fill a 2×2 grid (last cell may be empty in the UI if there are 3 items).
- section2Items: 3–6 **task-design** patterns worth watching (e.g. **true** multi-outcome ambiguity, missing constraints where the rubric needs them, unrealistic scenarios, weak boundary handling when the rubric expects it)—same analytical rigor as “failure modes,” but worded **constructively** (what to refine, not what is “wrong with you”). You **may** include risk-handling, policy-alignment, or sensitive-domain clarity themes **when grounded in the samples or rubric**. Do **not** list “vagueness” or “requires reasoning” as failures by themselves. Title + body: what **you** can tighten **in your tasks** and how it would help signal in this environment.
- section3Items: exactly 3–4 items: **only** environment-specific **task authoring** improvements—specific edits or patterns **you** can apply to **your** future task prompts. **No** recommendations about coaching programs, reviewer coaching, or organizational process; **no** generic leadership advice. Do **not** default to “be more explicit in every part of the prompt”; prefer changes that sharpen **the single expected outcome**, **reasoning you want elicited**, or **true** multi-outcome problems—aligned with the task design philosophy in the system narrative.
- excellentWhyItems: exactly **3 strings**, aligned with EXCELLENT references 1–3 in the user message (what makes each excellent **for task design** in this environment, written **to the reader**). Never paste prompt bodies into these strings. **Do not** treat step-by-step hand-holding as the default excellence story; foreground **reasoning**, outcome clarity, and single-outcome alignment per the task design philosophy and the user-message note on excellentWhyItems.
- Ground every point in the samples, scores, and rubric text. Do not invent dataset-wide statistics beyond the counts given.
- If the user message includes **Author-provided context**, honor it when judging patterns (e.g. do not treat intentional divergence from a user story as a flaw if context says that was allowed).
- Do not include other top-level keys. Do not use trailing commas.`;

  const model = getChatModel(llmConfig);

  const completion = await chatCompletionCreateAudited(
    llmConfig,
    "coaching-insights",
    {
      model,
      temperature: 0.35,
      messages: [
        { role: "system", content: `${system}\n\n${scopeNarrative}` },
        { role: "user", content: userContent },
      ],
      ...(supportsChatJsonObjectResponseFormat(llmConfig)
        ? { response_format: { type: "json_object" } as const }
        : {}),
    },
  );

  const raw =
    completion.choices[0]?.message?.content?.trim() ?? "";

  if (!raw) {
    throw new Error("Empty response from language model");
  }

  let report: CoachingInsightReport;
  try {
    const llmPart = parseCoachingInsightLlmResponse(raw);
    report = mergeExcellentBodiesIntoReport(
      llmPart,
      excellentBodiesTuple,
    );
  } catch (e) {
    throw new Error(
      e instanceof Error
        ? `Could not parse coaching report JSON: ${e.message}`
        : "Could not parse coaching report JSON",
    );
  }

  const gSuffix = hasGuidelineFilter ? "; selected rubrics only" : "";

  const summary = `Analyzed ${samples.length} sample tasks (${projectLabel} · ${scopeLabel}${gSuffix}) from ${counts.EXCELLENT + counts.AVERAGE + counts.POOR} scored prompts in scope (EXCELLENT ${counts.EXCELLENT}, AVERAGE ${counts.AVERAGE}, POOR ${counts.POOR}). Report includes three verbatim excellent prompts plus explanations.`;

  return { report, summary };
}
