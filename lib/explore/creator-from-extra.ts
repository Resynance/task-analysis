export const UNKNOWN_CREATOR_LABEL = "Unknown creator";

/** Raw `created_by` value from task `extra`, if any. */
export function getCreatedByIdFromExtra(extra: unknown): string | null {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) {
    return null;
  }
  const cb = (extra as Record<string, unknown>).created_by;
  if (typeof cb !== "string" || !cb.trim()) return null;
  return cb.trim();
}

/**
 * Canonical user key for metrics / directory alignment (`id:` + task author from ingest metadata).
 * Matches prompt library / `/users` matching when only `created_by` is available.
 */
export function canonicalKeyFromPromptExtra(extra: unknown): string {
  const raw = getCreatedByIdFromExtra(extra);
  return raw?.trim() ? `id:${raw.trim().toLowerCase()}` : "unknown";
}

/**
 * Label for grouping / display: resolved display name from `users/users.json` when
 * `nameByUserId` is provided and contains the id; otherwise the raw `created_by` string.
 */
export function getCreatorLabelFromExtra(
  extra: unknown,
  nameByUserId?: Map<string, string>,
): string {
  const raw = getCreatedByIdFromExtra(extra);
  if (!raw) return UNKNOWN_CREATOR_LABEL;
  if (nameByUserId && nameByUserId.size > 0) {
    const name = nameByUserId.get(raw.toLowerCase());
    if (name) return name;
  }
  return raw;
}
