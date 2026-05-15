/** Stable DB key for rubric subset when caching coaching insights. */
export function coachingInsightGuidelineScopeKey(guidelineIds: string[]): string {
  const sorted = [...new Set(guidelineIds)].sort();
  return sorted.length ? sorted.join(",") : "all";
}
