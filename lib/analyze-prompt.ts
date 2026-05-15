import { z } from "zod";
import type { PromptScore } from "@/generated/prisma/enums";
import { extractOuterJsonObject } from "@/lib/extract-outer-json-object";
import type { ResolvedLlmConfig } from "@/lib/llm-config";
import { chatCompletionCreateAudited, getChatModel } from "@/lib/llm";

/**
 * LLM-backed scoring of a **candidate prompt** against **program guidelines** (and optional user
 * story / extra instructions). Used by task-analysis flows and the writer pre-check feature.
 *
 * The model is instructed to emit a single JSON object (no markdown fences). Parsing uses
 * `extractOuterJsonObject` so occasional leading or trailing prose does not break extraction as
 * easily as taking the substring from the first "{" to the last "}" would (that breaks when braces
 * appear inside JSON string values).
 */
const analysisSchema = z.object({
  score: z.enum(["excellent", "average", "poor"]),
  rationale: z.string().min(1),
});

const problemAreaSourceSchema = z.enum([
  "prompt",
  "writer_rubric",
  "guideline_overlap",
  "user_story",
  "notes",
  "other",
]);

export type PromptAnalysisProblemArea = {
  source: z.infer<typeof problemAreaSourceSchema>;
  excerpt?: string;
  concern: string;
};

const problemAreaSchema = z.object({
  source: problemAreaSourceSchema,
  excerpt: z.string().max(400).optional(),
  concern: z.string().min(1).max(1200),
});

const analysisSchemaWithProblemAreas = analysisSchema.extend({
  problem_areas: z.array(problemAreaSchema).max(15).nullish(),
});

const scoreMap: Record<
  z.infer<typeof analysisSchema>["score"],
  PromptScore
> = {
  excellent: "EXCELLENT",
  average: "AVERAGE",
  poor: "POOR",
};

export async function analyzePromptAgainstGuidelines(
  input: {
    promptBody: string;
    guidelineContent: string;
    /** Optional product / scenario text from `scenarios/{env}.json` for this task’s project. */
    userStory?: string | null;
    /** Optional operator steering for this analysis run (batch or single). */
    extraInstructions?: string | null;
    /**
     * When true, the model returns `problem_areas`: targeted issues tied to the prompt,
     * writer draft rubric (from additional instructions), guidelines overlap, etc.
     */
    includeProblemAreas?: boolean;
  },
  llmConfig: ResolvedLlmConfig,
): Promise<{
  score: PromptScore;
  rationale: string;
  raw: string;
  problemAreas?: PromptAnalysisProblemArea[];
}> {
  const model = getChatModel(llmConfig);

  const problemAreasBlock = input.includeProblemAreas
    ? `

**Structured problem spots (required for this run):** Also include a JSON key "problem_areas" whose value is an array (use [] if there are no material issues—for example score is excellent and alignment is strong). Each element must be an object with:
- "source": one of "prompt" | "writer_rubric" | "guideline_overlap" | "user_story" | "notes" | "other"
  - Use "writer_rubric" for issues tied to the writer-provided draft rubric in ADDITIONAL INSTRUCTIONS (not the official GUIDELINES block).
  - Use "guideline_overlap" when the gap is about how the prompt meets (or misses) the official GUIDELINES.
- "excerpt": optional short quote (≤240 characters) from the PROMPT or writer draft rubric that illustrates the issue; omit if not applicable.
- "concern": one or two sentences stating what is wrong or risky and why it matters for training quality.

For any concern about missing data or missing context, first check whether the USER STORY / world spec supplies the same fact. If it does, do not describe that fact as missing; only mention a remaining issue if the prompt is still ambiguous even with the world spec or the GUIDELINES require the prompt itself to be self-contained.

Use at most 12 entries. Be specific—avoid vague boilerplate. If score is average or poor, you should usually include at least one entry unless the rationale fully fits in one sentence (then you may use []).`
    : "";

  const jsonShape = input.includeProblemAreas
    ? `{"score":"excellent"|"average"|"poor","rationale":"<brief justification>","problem_areas":[{"source":"prompt"|"writer_rubric"|"guideline_overlap"|"user_story"|"notes"|"other","excerpt":"<optional short quote>","concern":"<what is wrong>"}, ...]}`
    : `{"score":"excellent"|"average"|"poor","rationale":"<brief justification>"}`;

  const compactRationaleHint = input.includeProblemAreas
    ? `\n\nKeep "rationale" to a few sentences; put detailed callouts in "problem_areas" so the full JSON stays compact.`
    : "";

  const system = `You evaluate training prompts for AI systems. Given the rubric (GUIDELINES) and the candidate PROMPT, assign exactly one quality tier: excellent, average, or poor.

When a USER STORY is present, it describes the intended product scenario for the task’s project. Use it as supporting context: judge whether the PROMPT fits that scenario and the GUIDELINES. The USER STORY is not a second prompt to score; the PROMPT text is still the object of evaluation.

**World-spec context:** Before criticizing the PROMPT for omitted data or context, check whether that information exists in the USER STORY / world spec. Treat world-spec facts as available context for conversational references in the PROMPT (for example family roles, budgets, contact details, preferences, available options, constraints, account details, or project facts). Do **not** mark the prompt down merely because it says things like "my dad," "that I can afford," or "send it to my sister" when the USER STORY supplies the needed details. Flag missing context only when the information is absent from both the PROMPT and USER STORY, conflicts with the USER STORY, or the GUIDELINES explicitly require the prompt to restate it.

**Guidelines-first:** The GUIDELINES text is authoritative. Where they specify criteria (including tone, structure, or required detail), follow them.

**Prompt shape (program intent):** These prompts are usually **brief** and **human, conversational**—like something a real user would say, not a dense specification. **One to a few sentences** is a common example of “brief,” not a hard cap: slightly longer prompts are fine when they stay conversational and still imply one checkable outcome. **Do not penalize short or informal wording** unless the GUIDELINES explicitly demand more length, formality, or step-by-step detail. A prompt crammed with exhaustive instructions is **not** the default mold here. Read the rubric as allowing **reasonable flexibility** in how the agent gets there, as long as there is still **one clear, primary outcome** to judge (not several equally valid tasks or answers).

**Program defaults when guidelines are silent or general:** We want tasks that elicit **reasoning**, not only scripted execution. **Step-by-step hand-holding is not required for excellence** unless the GUIDELINES demand that style. **Some intentional openness or strategic vagueness is acceptable** when the PROMPT still implies **one clear, checkable outcome**. Penalize **true ambiguity** (multiple equally valid tasks or answers), not tasks that are hard but single-answer. Do **not** mark a prompt down solely because it does not spell out every micro-step for the user.

**Simulated data is expected, not unsafe.** These prompts simulate real-world product scenarios for training. **Synthetic / fabricated personal identifiers — names, addresses, phone numbers, emails, account numbers, credit-card numbers, SSNs / national IDs, dates of birth, etc. — are intentional fixtures and MUST NOT lower the score on safety grounds.** Treat such values as fake by default unless the GUIDELINES explicitly forbid them or the PROMPT clearly references a real, identifiable person without consent. "Unsafe" in the poor tier means content that violates the GUIDELINES, requests harm, leaks real third-party secrets, or otherwise breaks program policy — it does **not** include realistic-looking synthetic PII used to set up a scenario.

Definitions:
- excellent: aligned with the guidelines; scoped and policy-compliant; would produce strong training signal—often including reasoning. A **conversational** prompt that stays **relatively brief** (often just a few sentences as an example of “brief,” not a fixed limit) can be excellent when it still implies one checkable outcome. "Instructive" means the task teaches what to accomplish and how success is judged, **not** necessarily a long procedural checklist unless the rubric calls for that.
- average: usable but incomplete, weakly aligned, or unclear relative to the guidelines; improvements are obvious.
- poor: misaligned with the GUIDELINES, empty, or unlikely to help training. Reserve "unsafe" for actual policy violations as defined above — synthetic PII alone is never sufficient to mark a prompt poor.
${problemAreasBlock}

Respond with a single JSON object only, no markdown fences, no other keys:
${jsonShape}${compactRationaleHint}`;

  const trimmedStory = input.userStory?.trim();
  const storyBlock = trimmedStory
    ? `USER STORY (suggested product context for this task’s project):\n${trimmedStory}\n\n`
    : "";

  const extra = input.extraInstructions?.trim();
  const extraBlock =
    extra && extra.length > 0
      ? `\n\nADDITIONAL INSTRUCTIONS:\n${extra}`
      : "";

  const user = `${storyBlock}GUIDELINES:\n${input.guidelineContent}\n\nPROMPT:\n${input.promptBody}${extraBlock}`;

  // `problem_areas` grows the JSON; higher cap reduces `finish_reason: length` truncation.
  const maxTokens = input.includeProblemAreas ? 4096 : 1200;

  const completion = await chatCompletionCreateAudited(
    llmConfig,
    "analyze-prompt",
    {
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
  );

  const choice = completion.choices[0];
  const raw = choice?.message?.content?.trim() ?? "";
  const finishReason = choice?.finish_reason;
  if (!raw) {
    throw new Error("Empty response from language model");
  }

  let jsonText: string;
  try {
    // Brace-aware: rationales and excerpts may contain `}` inside JSON strings.
    jsonText = extractOuterJsonObject(raw);
  } catch (extractErr) {
    const hint =
      finishReason === "length"
        ? " The completion hit the max token limit; try again or raise max_tokens."
        : "";
    throw new Error(
      `${extractErr instanceof Error ? extractErr.message : String(extractErr)}${hint} Raw: ${raw.slice(0, 500)}`,
    );
  }
  try {
    if (input.includeProblemAreas) {
      const parsed = analysisSchemaWithProblemAreas.parse(JSON.parse(jsonText));
      const problemAreas =
        parsed.problem_areas?.length
          ? parsed.problem_areas.map((p) => ({
              source: p.source,
              ...(p.excerpt?.trim() ? { excerpt: p.excerpt.trim() } : {}),
              concern: p.concern.trim(),
            }))
          : undefined;
      return {
        score: scoreMap[parsed.score],
        rationale: parsed.rationale,
        raw,
        ...(problemAreas && problemAreas.length > 0 ? { problemAreas } : {}),
      };
    }

    const parsed = analysisSchema.parse(JSON.parse(jsonText));
    return {
      score: scoreMap[parsed.score],
      rationale: parsed.rationale,
      raw,
    };
  } catch {
    const truncatedHint =
      finishReason === "length"
        ? " Response may have been truncated (finish_reason=length); try again or raise max_tokens."
        : "";
    throw new Error(
      `Could not parse model output as analysis JSON.${truncatedHint ? ` ${truncatedHint}` : ""} Raw: ${raw.slice(0, 500)}`,
    );
  }
}
