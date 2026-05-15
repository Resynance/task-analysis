import type { ResolvedLlmConfig } from "@/lib/llm-config";
import { chatCompletionCreateAudited, getChatModel } from "@/lib/llm";

const MAX_QUESTION_CHARS = 4000;
const MAX_ANSWER_CHARS = 8000;

export function assertClarifyQuestionLength(question: string): void {
  if (question.trim().length === 0) {
    throw new Error("Question is required.");
  }
  if (question.length > MAX_QUESTION_CHARS) {
    throw new Error(`Question must be at most ${MAX_QUESTION_CHARS} characters.`);
  }
}

/**
 * Follow-up for operators: explain or expand on the existing evaluation without re-scoring
 * unless the question explicitly asks for a fresh judgment (still does not persist a new score).
 */
export async function clarifyPromptAnalysisResult(
  input: {
    promptBody: string;
    guidelineContent: string;
    userStory?: string | null;
    /** Human-readable score + model rationale from the last analysis. */
    evaluationBlock: string;
    operatorQuestion: string;
  },
  llmConfig: ResolvedLlmConfig,
): Promise<{ answer: string }> {
  assertClarifyQuestionLength(input.operatorQuestion);

  const model = getChatModel(llmConfig);

  const system = `You help operators understand an automated evaluation of a **training prompt**.

You receive: the rubric (GUIDELINES), the PROMPT text, optional USER STORY (product context), the model's **prior evaluation** (tier + rationale), and the operator's **QUESTION**.

Rules:
- Answer clearly and concisely. Ground every point in the GUIDELINES and PROMPT (and USER STORY when relevant).
- Do **not** invent details not supported by the materials.
- The **saved score in the app** only changes when the operator runs the main "analyze" action. If they ask you to "re-score" or "what should the score be", you may give a careful opinion but **state that it is informal** and that the official tier is whatever appears in PRIOR EVALUATION until they re-run analysis.
- Plain language; short markdown lists or **bold** for emphasis are fine. No JSON.

Keep the answer under roughly ${Math.floor(MAX_ANSWER_CHARS / 4)} words unless the question requires more detail.`;

  const story = input.userStory?.trim()
    ? `USER STORY:\n${input.userStory.trim()}\n\n`
    : "";

  const user = `${story}GUIDELINES:\n${input.guidelineContent}\n\nPROMPT:\n${input.promptBody}\n\n---\nPRIOR EVALUATION (from the last model run):\n${input.evaluationBlock}\n\n---\nOPERATOR QUESTION:\n${input.operatorQuestion.trim()}`;

  const completion = await chatCompletionCreateAudited(
    llmConfig,
    "prompt-analysis-clarify",
    {
      model,
      temperature: 0.25,
      max_tokens: 2200,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
  );

  let answer =
    completion.choices[0]?.message?.content?.trim() ?? "";
  if (!answer) {
    throw new Error("Empty response from language model");
  }
  if (answer.length > MAX_ANSWER_CHARS) {
    answer = `${answer.slice(0, MAX_ANSWER_CHARS - 1)}…`;
  }

  return { answer };
}
