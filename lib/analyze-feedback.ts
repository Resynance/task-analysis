import { z } from "zod";
import type { PromptScore } from "@/generated/prisma/enums";
import type { ResolvedLlmConfig } from "@/lib/llm-config";
import { chatCompletionCreateAudited, getChatModel } from "@/lib/llm";

/**
 * LLM scoring of **feedback** rows (quality / usefulness tiers) for dashboards and batch jobs.
 * Output is a small JSON object parsed with a simple `{`…`}` slice — keep prompts compact so the
 * model does not embed extra braces in free text.
 */
const analysisSchema = z.object({
  score: z.enum(["excellent", "average", "poor"]),
  rationale: z.string().min(1),
});

const scoreMap: Record<z.infer<typeof analysisSchema>["score"], PromptScore> = {
  excellent: "EXCELLENT",
  average: "AVERAGE",
  poor: "POOR",
};

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model did not return a JSON object");
  }
  return text.slice(start, end + 1);
}

export async function analyzeFeedbackAgainstGuidelines(
  input: {
    feedbackBody: string;
    guidelineContent: string;
    /** Optional user-provided steering for this analysis run. */
    extraInstructions?: string | null;
  },
  llmConfig: ResolvedLlmConfig,
): Promise<{ score: PromptScore; rationale: string; raw: string }> {
  const model = getChatModel(llmConfig);

  const system = `You evaluate QA reviewer feedback quality against a rubric.

Given GUIDELINES and FEEDBACK, assign exactly one quality tier:
- excellent: specific, actionable, evidence-based feedback that aligns with rubric expectations
- average: partially useful feedback with some clarity/actionability gaps
- poor: vague, non-actionable, contradictory, or misaligned feedback

Respond with exactly one JSON object and no markdown:
{"score":"excellent"|"average"|"poor","rationale":"<brief justification>"}`;

  const extra = input.extraInstructions?.trim();
  const user =
    extra && extra.length > 0
      ? `GUIDELINES:\n${input.guidelineContent}\n\nFEEDBACK:\n${input.feedbackBody}\n\nADDITIONAL INSTRUCTIONS:\n${extra}`
      : `GUIDELINES:\n${input.guidelineContent}\n\nFEEDBACK:\n${input.feedbackBody}`;

  const completion = await chatCompletionCreateAudited(
    llmConfig,
    "analyze-feedback",
    {
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
  );

  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!raw) throw new Error("Empty response from language model");
  const parsed = analysisSchema.parse(JSON.parse(extractJsonObject(raw)));
  return { score: scoreMap[parsed.score], rationale: parsed.rationale, raw };
}
