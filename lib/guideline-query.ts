/**
 * URL helpers for **guideline** filters: parse comma-separated ids from the `guidelines` search param
 * and drop unknown ids so bad bookmarks do not break pages.
 */
export function parseGuidelineIdsParam(
  raw: Record<string, string | string[] | undefined>,
  validIds: Set<string>,
): string[] {
  const v = raw.guidelines;
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of s.split(",")) {
    const id = part.trim();
    if (!id || !validIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
