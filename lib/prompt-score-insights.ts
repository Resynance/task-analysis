import type { PromptScore } from "@/generated/prisma/enums";

/** Scores that participate in /insights coaching corpus (excludes PRUNED). */
export const INSIGHTS_ELIGIBLE_SCORES: PromptScore[] = [
  "EXCELLENT",
  "AVERAGE",
  "POOR",
];

const INSIGHTS_ELIGIBLE = new Set<string>(INSIGHTS_ELIGIBLE_SCORES);

export function isInsightsEligibleScore(
  score: PromptScore | null | undefined,
): boolean {
  return score != null && INSIGHTS_ELIGIBLE.has(score);
}
