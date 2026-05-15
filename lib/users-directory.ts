import type { PrismaClient } from "@/generated/prisma/client";
import { getCreatedByIdFromExtra } from "@/lib/explore/creator-from-extra";
import { fetchPromptLibraryMeta, type PromptLibraryMetaRow } from "@/lib/prompt-library-page";
import { prismaPromptToPromptRow } from "@/lib/prompt-row-serialize";
import type { PromptRow } from "@/components/prompt-dashboard";

/**
 * Builds the **users directory**: aggregates prompts and feedback by stable author key (`id:…`,
 * `email:…`, `name:…` from import metadata) for `/users` and drill-down pages.
 */
export type ParsedUserKey =
  | { kind: "id"; value: string }
  | { kind: "email"; value: string }
  | { kind: "name"; value: string }
  | { kind: "unknown"; value: "unknown" };

export type UserDirectoryEntry = {
  /** Stable key, e.g. `id:…`, `email:…`, `name:…` (not URL-encoded). */
  key: string;
  displayName: string;
  /** Email from feedback rows for this user bucket, if any. */
  contactEmail: string | null;
  promptCount: number;
  feedbackCount: number;
};

/**
 * Case-insensitive substring match on display name, contact email, or directory key
 * (`id:…`, `email:…`, `name:…`).
 */
export function filterUserDirectoryByNameOrEmail(
  entries: UserDirectoryEntry[],
  query: string | undefined,
): UserDirectoryEntry[] {
  const q = query?.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((u) => {
    if (u.displayName.toLowerCase().includes(q)) return true;
    if (u.contactEmail?.toLowerCase().includes(q)) return true;
    if (u.key.toLowerCase().includes(q)) return true;
    return false;
  });
}

/** Encode for use in `/users/[userKey]` (path segment). */
export function encodeUserKeyForPath(key: string): string {
  return encodeURIComponent(key);
}

export function parseUserKeyFromParam(param: string): ParsedUserKey | null {
  const key = decodeURIComponent(param);
  if (key === "unknown") return { kind: "unknown", value: "unknown" };
  if (key.startsWith("id:")) {
    const value = key.slice(3).trim();
    return value ? { kind: "id", value } : null;
  }
  if (key.startsWith("email:")) {
    const value = key.slice(6).trim();
    return value ? { kind: "email", value } : null;
  }
  if (key.startsWith("name:")) {
    const value = key.slice(5).trim();
    return value ? { kind: "name", value } : null;
  }
  return null;
}

export function formatUserKey(parsed: ParsedUserKey): string {
  if (parsed.kind === "unknown") return "unknown";
  if (parsed.kind === "id") return `id:${parsed.value}`;
  if (parsed.kind === "email") return `email:${parsed.value}`;
  return `name:${parsed.value}`;
}

export function canonicalKeyFromFeedbackSlice(r: {
  createdById: string | null;
  createdByEmail: string | null;
  createdByName: string | null;
}): string {
  const id = r.createdById?.trim();
  if (id) return `id:${id.toLowerCase()}`;
  const email = r.createdByEmail?.trim();
  if (email) return `email:${email.toLowerCase()}`;
  const name = r.createdByName?.trim();
  if (name) return `name:${name.toLowerCase()}`;
  return "unknown";
}

/**
 * Normalizes a stored or picked user key to the same shape as {@link canonicalKeyFromFeedbackSlice}
 * (trim, lowercase values, consistent prefixes). Case-insensitive `unknown` and `id:` / `email:` / `name:` prefixes.
 */
export function normalizeCanonicalUserKeyString(key: string): string {
  const t = key.trim();
  if (!t) return "unknown";
  const lower = t.toLowerCase();
  if (lower === "unknown") return "unknown";
  if (lower.startsWith("id:")) {
    const v = t.slice(3).trim().toLowerCase();
    return v ? `id:${v}` : "unknown";
  }
  if (lower.startsWith("email:")) {
    const v = t.slice(6).trim().toLowerCase();
    return v ? `email:${v}` : "unknown";
  }
  if (lower.startsWith("name:")) {
    const v = t.slice(5).trim().toLowerCase();
    return v ? `name:${v}` : "unknown";
  }
  return "unknown";
}

/**
 * Map QA metrics reviewer bucket keys to the same canonical shape as {@link canonicalKeyFromFeedbackSlice}
 * so `/users/[userKey]` resolves consistently.
 */
export function canonicalUserKeyFromQaGroupKey(groupKey: string): string {
  return normalizeCanonicalUserKeyString(groupKey);
}

export function userProfileHrefFromQaGroupKey(groupKey: string): string {
  return `/users/${encodeUserKeyForPath(canonicalUserKeyFromQaGroupKey(groupKey))}`;
}

export function getDisplayNameForUserKey(
  key: string,
  nameByUserId: Map<string, string>,
): string {
  if (key === "unknown") return "Unknown";
  if (key.startsWith("id:")) {
    const raw = key.slice(3);
    const resolved = nameByUserId.get(raw.toLowerCase());
    return resolved ?? raw;
  }
  if (key.startsWith("email:")) return key.slice(6);
  if (key.startsWith("name:")) return key.slice(5);
  return key;
}

export function resolveDisplayName(
  key: string,
  candidate: { name?: string; email?: string; id?: string },
  nameByUserId: Map<string, string>,
): string {
  if (candidate.name && candidate.name.trim()) return candidate.name.trim();
  if (candidate.email && candidate.email.trim()) return candidate.email.trim();
  if (candidate.id && candidate.id.trim()) {
    const id = candidate.id.trim();
    return nameByUserId.get(id.toLowerCase()) ?? id;
  }
  return getDisplayNameForUserKey(key, nameByUserId);
}

/**
 * When the primary label is a resolved name (not a raw id / not email-as-title), show a
 * secondary email line if we have one and it is not redundant.
 */
export function secondaryContactEmailLine(opts: {
  key: string;
  displayName: string;
  contactEmail: string | null | undefined;
}): string | null {
  const email = opts.contactEmail?.trim();
  if (!email) return null;
  if (opts.key.startsWith("email:")) return null;
  if (opts.key === "unknown") return null;
  if (email.toLowerCase() === opts.displayName.trim().toLowerCase()) return null;
  if (opts.key.startsWith("id:")) {
    const rawId = opts.key.slice(3).trim();
    if (opts.displayName.trim().toLowerCase() === rawId.toLowerCase()) return null;
    return email;
  }
  if (opts.key.startsWith("name:")) return email;
  return null;
}

function feedbackRowsToDisplayCandidate(
  rows: Array<{
    createdById: string | null;
    createdByEmail: string | null;
    createdByName: string | null;
  }>,
  parsed: ParsedUserKey,
): { name?: string; email?: string; id?: string } {
  const cand: { name?: string; email?: string; id?: string } = {};
  for (const r of rows) {
    if (!cand.name && r.createdByName?.trim()) cand.name = r.createdByName.trim();
    if (!cand.email && r.createdByEmail?.trim()) cand.email = r.createdByEmail.trim();
    if (!cand.id && r.createdById?.trim()) cand.id = r.createdById.trim();
  }
  if (parsed.kind === "id") cand.id = cand.id ?? parsed.value;
  if (parsed.kind === "email") cand.email = cand.email ?? parsed.value;
  return cand;
}

/**
 * /users list order: rows keyed by name/email first; then id-backed rows that resolve to a
 * human-readable label (lookup, feedback name/email); then id rows whose label is still the raw id.
 */
function directoryListSortTier(entry: UserDirectoryEntry): number {
  if (entry.key === "unknown") return 3;
  if (entry.key.startsWith("name:") || entry.key.startsWith("email:")) return 0;
  if (entry.key.startsWith("id:")) {
    const rawId = entry.key.slice(3).trim();
    const disp = entry.displayName.trim();
    if (rawId && disp.toLowerCase() === rawId.toLowerCase()) return 2;
    return 1;
  }
  return 4;
}

function feedbackRowMatchesParsedKey(
  r: {
    createdById: string | null;
    createdByEmail: string | null;
    createdByName: string | null;
  },
  parsed: ParsedUserKey,
): boolean {
  const id = r.createdById?.trim().toLowerCase() ?? "";
  const email = r.createdByEmail?.trim().toLowerCase() ?? "";
  const name = r.createdByName?.trim().toLowerCase() ?? "";
  if (parsed.kind === "unknown") return !id && !email && !name;
  if (parsed.kind === "id") return id === parsed.value.toLowerCase();
  if (parsed.kind === "email") return email === parsed.value.toLowerCase();
  return name === parsed.value.toLowerCase();
}

function promptMetaMatchesParsedKey(meta: PromptLibraryMetaRow, parsed: ParsedUserKey): boolean {
  const raw = getCreatedByIdFromExtra(meta.extra);
  if (parsed.kind === "unknown") return !raw;
  if (parsed.kind !== "id") return false;
  return raw != null && raw.toLowerCase() === parsed.value.toLowerCase();
}

/** Match a feedback row to a canonical `/users/[userKey]` string (same rules as the users directory). */
export function feedbackRowMatchesCanonicalUserKey(
  r: {
    createdById: string | null;
    createdByEmail: string | null;
    createdByName: string | null;
  },
  canonicalUserKey: string,
): boolean {
  const parsed = parseUserKeyFromParam(encodeURIComponent(canonicalUserKey));
  if (!parsed) return false;
  return feedbackRowMatchesParsedKey(r, parsed);
}

/** Match prompt library meta to a canonical user key (creator id in `extra` only). */
export function promptMetaMatchesCanonicalUserKey(
  meta: PromptLibraryMetaRow,
  canonicalUserKey: string,
): boolean {
  const parsed = parseUserKeyFromParam(encodeURIComponent(canonicalUserKey));
  if (!parsed) return false;
  return promptMetaMatchesParsedKey(meta, parsed);
}

export async function buildUserDirectory(
  prisma: PrismaClient,
  nameByUserId: Map<string, string>,
): Promise<UserDirectoryEntry[]> {
  const [feedbackMinimal, promptMeta] = await Promise.all([
    prisma.feedback.findMany({
      select: {
        createdById: true,
        createdByEmail: true,
        createdByName: true,
      },
    }),
    fetchPromptLibraryMeta(prisma),
  ]);

  const counts = new Map<string, { promptCount: number; feedbackCount: number }>();
  const displayCandidates = new Map<
    string,
    { name?: string; email?: string; id?: string }
  >();

  for (const r of feedbackMinimal) {
    const k = canonicalKeyFromFeedbackSlice(r);
    const cur = counts.get(k) ?? { promptCount: 0, feedbackCount: 0 };
    cur.feedbackCount += 1;
    counts.set(k, cur);
    const cand = displayCandidates.get(k) ?? {};
    if (!cand.name && r.createdByName?.trim()) cand.name = r.createdByName.trim();
    if (!cand.email && r.createdByEmail?.trim()) cand.email = r.createdByEmail.trim();
    if (!cand.id && r.createdById?.trim()) cand.id = r.createdById.trim();
    displayCandidates.set(k, cand);
  }

  for (const m of promptMeta) {
    const raw = getCreatedByIdFromExtra(m.extra);
    const k = raw ? `id:${raw.toLowerCase()}` : "unknown";
    const cur = counts.get(k) ?? { promptCount: 0, feedbackCount: 0 };
    cur.promptCount += 1;
    counts.set(k, cur);
    if (raw) {
      const cand = displayCandidates.get(k) ?? {};
      if (!cand.id) cand.id = raw;
      displayCandidates.set(k, cand);
    }
  }

  const entries: UserDirectoryEntry[] = [];
  for (const [key, c] of counts) {
    if (c.promptCount === 0 && c.feedbackCount === 0) continue;
    const cand = displayCandidates.get(key) ?? {};
    entries.push({
      key,
      displayName: resolveDisplayName(key, cand, nameByUserId),
      contactEmail: cand.email?.trim() ?? null,
      promptCount: c.promptCount,
      feedbackCount: c.feedbackCount,
    });
  }

  entries.sort((a, b) => {
    const ta = directoryListSortTier(a);
    const tb = directoryListSortTier(b);
    if (ta !== tb) return ta - tb;
    return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
  });
  return entries;
}

export async function fetchUserDetail(
  prisma: PrismaClient,
  nameByUserId: Map<string, string>,
  parsed: ParsedUserKey,
): Promise<{
  key: string;
  displayName: string;
  secondaryEmail: string | null;
  prompts: PromptRow[];
  feedback: Array<{
    id: string;
    body: string;
    score: string | null;
    rationale: string | null;
    projectKey: string;
    envKey: string | null;
    taskId: string | null;
    taskKey: string | null;
    createdAt: string;
    analyzedAt: string | null;
  }>;
}> {
  const key = formatUserKey(parsed);

  const [feedbackCandidates, meta] = await Promise.all([
    prisma.feedback.findMany({
      where:
        parsed.kind === "id"
          ? { NOT: { createdById: null } }
          : parsed.kind === "email"
            ? { NOT: { createdByEmail: null } }
            : parsed.kind === "name"
              ? { NOT: { createdByName: null } }
              : {},
      orderBy: { createdAt: "desc" },
    }),
    fetchPromptLibraryMeta(prisma),
  ]);

  const feedbackRows = feedbackCandidates.filter((r) =>
    feedbackRowMatchesParsedKey(r, parsed),
  );
  const cand = feedbackRowsToDisplayCandidate(feedbackRows, parsed);
  const displayName = resolveDisplayName(key, cand, nameByUserId);
  const secondaryEmail = secondaryContactEmailLine({
    key,
    displayName,
    contactEmail: cand.email ?? null,
  });
  const promptIds = meta
    .filter((m) => promptMetaMatchesParsedKey(m, parsed))
    .map((m) => m.id);

  const fullPrompts =
    promptIds.length === 0
      ? []
      : await prisma.prompt.findMany({
          where: { id: { in: promptIds } },
          include: { guideline: { select: { id: true, name: true } } },
          orderBy: { createdAt: "desc" },
        });

  const orderIndex = new Map(promptIds.map((id, idx) => [id, idx] as const));
  fullPrompts.sort(
    (a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0),
  );

  const prompts = fullPrompts.map((row) => prismaPromptToPromptRow(row, nameByUserId));

  const feedback = feedbackRows.map((r) => ({
    id: r.id,
    body: r.body,
    score: r.score,
    rationale: r.rationale,
    projectKey: r.projectKey,
    envKey: r.envKey,
    taskId: r.taskId,
    taskKey: r.taskKey,
    createdAt: r.createdAt.toISOString(),
    analyzedAt: r.analyzedAt?.toISOString() ?? null,
  }));

  return { key, displayName, secondaryEmail, prompts, feedback };
}
