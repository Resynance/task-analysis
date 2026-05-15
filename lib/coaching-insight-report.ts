import { z } from "zod";

const itemSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
});

const excellentExampleSchema = z.object({
  prompt: z.string().min(1),
  whyExcellent: z.string().min(1),
});

/** Final report (persisted + UI). `excellentExamples` optional for legacy saved rows. */
export const coachingInsightReportSchema = z.object({
  environmentLabel: z.string().min(1),
  environmentSubtitle: z.string().min(1),
  section1Items: z.array(itemSchema).min(2).max(6),
  section2Items: z.array(itemSchema).min(1).max(8),
  section3Items: z.array(itemSchema).min(1).max(8),
  excellentExamples: z.array(excellentExampleSchema).length(3).optional(),
});

export type CoachingInsightReport = z.infer<typeof coachingInsightReportSchema>;

/** Raw model output before merging verbatim EXCELLENT prompt bodies from the DB. */
export const coachingInsightLlmResponseSchema = z.object({
  environmentLabel: z.string().min(1),
  environmentSubtitle: z.string().min(1),
  section1Items: z.array(itemSchema).min(2).max(6),
  section2Items: z.array(itemSchema).min(1).max(8),
  section3Items: z.array(itemSchema).min(1).max(8),
  excellentWhyItems: z.array(z.string().min(1)).length(3),
});

export type CoachingInsightLlmResponse = z.infer<
  typeof coachingInsightLlmResponseSchema
>;

const MAX_STORED_PROMPT_CHARS = 20000;

function clipPromptForStorage(text: string): string {
  const t = text.trim();
  if (t.length <= MAX_STORED_PROMPT_CHARS) return t;
  return `${t.slice(0, MAX_STORED_PROMPT_CHARS)}…`;
}

export function mergeExcellentBodiesIntoReport(
  llm: CoachingInsightLlmResponse,
  bodies: readonly [string, string, string],
): CoachingInsightReport {
  return {
    environmentLabel: llm.environmentLabel,
    environmentSubtitle: llm.environmentSubtitle,
    section1Items: llm.section1Items,
    section2Items: llm.section2Items,
    section3Items: llm.section3Items,
    excellentExamples: [0, 1, 2].map((i) => ({
      prompt: clipPromptForStorage(bodies[i]),
      whyExcellent: llm.excellentWhyItems[i],
    })),
  };
}

export function parseCoachingInsightLlmResponse(raw: string): CoachingInsightLlmResponse {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
  const json = JSON.parse(cleaned) as unknown;
  return coachingInsightLlmResponseSchema.parse(json);
}

export function safeParseStoredCoachingInsightReport(
  json: unknown,
): CoachingInsightReport | null {
  const r = coachingInsightReportSchema.safeParse(json);
  return r.success ? r.data : null;
}
