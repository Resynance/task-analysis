import { z } from "zod";

export const promptAnalysisClarificationSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type PromptAnalysisClarification = z.infer<
  typeof promptAnalysisClarificationSchema
>;

export function parsePromptAnalysisClarification(
  json: unknown,
): PromptAnalysisClarification | null {
  const r = promptAnalysisClarificationSchema.safeParse(json);
  return r.success ? r.data : null;
}

export function buildClarificationPayload(input: {
  question: string;
  answer: string;
}): PromptAnalysisClarification {
  return {
    question: input.question.trim(),
    answer: input.answer.trim(),
    updatedAt: new Date().toISOString(),
  };
}
