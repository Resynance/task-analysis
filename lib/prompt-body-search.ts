/** Case-insensitive substring match on prompt body (task instructions). */
export function rowMatchesPromptBodySearch(body: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  return body.toLowerCase().includes(q.toLowerCase());
}

export function parsePromptBodySearchQuery(
  sp: Record<string, string | string[] | undefined>,
): string {
  const raw = sp.promptSearch;
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0].trim();
  return "";
}
