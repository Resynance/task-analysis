import {
  getCreatedByIdFromExtra,
  getCreatorLabelFromExtra,
} from "@/lib/explore/creator-from-extra";

/**
 * Case-insensitive substring match on resolved creator name and on raw user id
 * (so name search and partial UUID search both work).
 */
export function rowMatchesUserSearch(
  extra: unknown,
  query: string,
  nameByUserId?: Map<string, string>,
): boolean {
  const q = query.trim();
  if (!q) return true;
  const ql = q.toLowerCase();
  const label = getCreatorLabelFromExtra(extra, nameByUserId);
  if (label.toLowerCase().includes(ql)) return true;
  const rawId = getCreatedByIdFromExtra(extra);
  if (rawId && rawId.toLowerCase().includes(ql)) return true;
  return false;
}

/**
 * Library author filter: `?authorSearch=` (preferred). Falls back to legacy `?user=`
 * from when “Group by user” stored the creator filter there.
 */
export function parseAuthorSearchQuery(
  sp: Record<string, string | string[] | undefined>,
): string {
  const primary = sp.authorSearch;
  if (typeof primary === "string" && primary.trim()) return primary.trim();
  if (Array.isArray(primary) && typeof primary[0] === "string" && primary[0].trim()) {
    return primary[0].trim();
  }
  const legacy = sp.user;
  if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
  if (Array.isArray(legacy) && typeof legacy[0] === "string" && legacy[0].trim()) {
    return legacy[0].trim();
  }
  return "";
}

/** @deprecated Use {@link parseAuthorSearchQuery} — kept for any stray imports. */
export function parseUserSearchQuery(
  sp: Record<string, string | string[] | undefined>,
): string {
  return parseAuthorSearchQuery(sp);
}
