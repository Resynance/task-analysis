import { existsSync, readFileSync } from "node:fs";
import type { PrismaClient } from "@/generated/prisma/client";
import type { PromptScore } from "@/generated/prisma/enums";
import { getCreatedByIdFromExtra } from "@/lib/explore/creator-from-extra";
import { getTaskLifecycleStatusFromExtra } from "@/lib/task-lifecycle";
import { getRecentOnboardsCsvAbsolute, getRecentOnboardsCsvRelative } from "@/lib/repo-paths";
import { parseCsvToRows, normalizeCsvHeader } from "@/lib/dataset/csv-rfc4180";
import { fetchPromptLibraryMeta, type PromptLibraryMetaRow } from "@/lib/prompt-library-page";
import { csvEscape } from "@/lib/csv-export";
import {
  canonicalKeyFromFeedbackSlice,
  encodeUserKeyForPath,
} from "@/lib/users-directory";
import { loadUserLookupProfiles, type UserLookupProfile } from "@/lib/users-lookup";

const EMAIL_HEADERS = new Set(["email", "email_address", "e_mail", "mail"]);
export const RECENT_ONBOARDS_UNASSIGNED_ENV = "_unassigned";
export const RECENT_ONBOARDS_MIN_FEEDBACK_RECORDS = 10;

export type RecentOnboardEmailInput = {
  email: string;
  rowNumber: number;
};

export type RecentOnboardPromptSummary = {
  id: string;
  sourceKey: string | null;
  sourceId: string | null;
  projectKey: string;
  envKey: string | null;
  taskModality: string | null;
  score: PromptScore | null;
  analyzedAtIso: string | null;
  createdAtIso: string;
  sourceCreatedIso: string | null;
  lifecycleStatus: string | null;
  lifecycleLabel: string;
};

export type RecentOnboardScoreBreakdown = {
  total: number;
  scored: number;
  pending: number;
  excellent: number;
  average: number;
  poor: number;
  pruned: number;
  classified: number;
  poorPercent: number | null;
};

export type RecentOnboardSummary = {
  email: string;
  rowNumber: number;
  userId: string | null;
  userKey: string | null;
  encodedUserKey: string | null;
  displayName: string | null;
  feedbackCount: number;
  prompts: RecentOnboardPromptSummary[];
  scores: RecentOnboardScoreBreakdown;
  latestTaskIso: string | null;
  projectCounts: Array<{ key: string; count: number }>;
  environmentCounts: Array<{ key: string; count: number }>;
  lifecycleCounts: Array<{ key: string; count: number }>;
};

export type RecentOnboardsAnalysis = {
  csvRelativePath: string;
  csvAbsolutePath: string;
  csvExists: boolean;
  usersLoaded: number;
  inputEmails: RecentOnboardEmailInput[];
  invalidRows: Array<{ rowNumber: number; value: string }>;
  duplicateEmails: string[];
  summaries: RecentOnboardSummary[];
  unmatchedEmails: RecentOnboardEmailInput[];
  aggregate: RecentOnboardScoreBreakdown;
};

export type RecentOnboardsSortMode = "csv" | "records_first";
export type RecentOnboardsVisibilityMode = "all" | "with_tasks";
export type RecentOnboardsEnvironmentFilterMode = "all" | "include" | "exclude";
export type RecentOnboardsProjectFilterMode = "all" | "include" | "exclude";

export type RecentOnboardsListOptions = {
  sortMode: RecentOnboardsSortMode;
  visibilityMode: RecentOnboardsVisibilityMode;
  projectFilter: {
    mode: RecentOnboardsProjectFilterMode;
    values: Set<string>;
  };
  environmentFilter: {
    mode: RecentOnboardsEnvironmentFilterMode;
    values: Set<string>;
  };
  requireMinFeedback: boolean;
};

export type RecentOnboardsListResult = {
  filteredSummaries: RecentOnboardSummary[];
  onboardsWithTasks: RecentOnboardSummary[];
  sortedSummaries: RecentOnboardSummary[];
};

export type RecentOnboardsEnvironmentOption = {
  value: string;
  label: string;
  count: number;
};

export type RecentOnboardsProjectOption = {
  value: string;
  label: string;
  count: number;
};

function normalizeEmail(raw: string): string | null {
  const email = raw.trim().replace(/^mailto:/i, "").toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function normalizeOnboardCsvHeader(raw: string): string {
  return normalizeCsvHeader(raw.replace(/^\uFEFF/, "")).replace(/[^a-z0-9_]/g, "_");
}

function looksLikeEmailHeader(header: string): boolean {
  if (EMAIL_HEADERS.has(header)) return true;
  const compact = header.replace(/_/g, "");
  return compact === "email" || compact.endsWith("email");
}

function rowDisplayValue(row: string[]): string {
  return row
    .map((cell) => cell.trim())
    .filter(Boolean)
    .join(", ");
}

function scoreCounts(rows: Array<{ score: PromptScore | null }>): RecentOnboardScoreBreakdown {
  let excellent = 0;
  let average = 0;
  let poor = 0;
  let pruned = 0;
  let scored = 0;

  for (const row of rows) {
    if (row.score == null) continue;
    scored += 1;
    switch (row.score) {
      case "EXCELLENT":
        excellent += 1;
        break;
      case "AVERAGE":
        average += 1;
        break;
      case "POOR":
        poor += 1;
        break;
      case "PRUNED":
        pruned += 1;
        break;
    }
  }

  const classified = excellent + average + poor;
  return {
    total: rows.length,
    scored,
    pending: rows.length - scored,
    excellent,
    average,
    poor,
    pruned,
    classified,
    poorPercent:
      classified > 0 ? Math.round((poor / classified) * 1000) / 10 : null,
  };
}

function countsBy<T>(
  rows: T[],
  keyFor: (row: T) => string | null | undefined,
): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyFor(row)?.trim() || "unassigned";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function envFilterValue(row: RecentOnboardPromptSummary): string {
  return row.envKey?.trim() || RECENT_ONBOARDS_UNASSIGNED_ENV;
}

function envFilterLabel(value: string): string {
  return value === RECENT_ONBOARDS_UNASSIGNED_ENV ? "unassigned" : value;
}

function projectFilterValue(row: RecentOnboardPromptSummary): string {
  return row.projectKey?.trim().toLowerCase() || "unassigned";
}

function latestTaskIso(rows: RecentOnboardPromptSummary[]): string | null {
  let latest = 0;
  for (const row of rows) {
    const t = promptCreatedAtMillis(row);
    if (Number.isFinite(t) && t > latest) latest = t;
  }
  return latest > 0 ? new Date(latest).toISOString() : null;
}

function promptCreatedAtMillis(row: RecentOnboardPromptSummary): number {
  return Date.parse(row.sourceCreatedIso ?? row.createdAtIso);
}

function promptToSummary(row: PromptLibraryMetaRow): RecentOnboardPromptSummary {
  const lifecycleStatus = getTaskLifecycleStatusFromExtra(row.extra);
  return {
    id: row.id,
    sourceKey: row.sourceKey,
    sourceId: row.sourceId,
    projectKey: row.projectKey,
    envKey: row.envKey,
    taskModality: row.taskModality,
    score: row.score ?? null,
    analyzedAtIso: row.analyzedAt?.toISOString() ?? null,
    createdAtIso: row.createdAt.toISOString(),
    sourceCreatedIso: row.sourceCreated?.toISOString() ?? null,
    lifecycleStatus,
    lifecycleLabel: lifecycleStatus ?? "No status (legacy)",
  };
}

function withPrompts(
  summary: RecentOnboardSummary,
  prompts: RecentOnboardPromptSummary[],
): RecentOnboardSummary {
  return {
    ...summary,
    prompts,
    scores: scoreCounts(prompts),
    latestTaskIso: latestTaskIso(prompts),
    projectCounts: countsBy(prompts, (row) => row.projectKey),
    environmentCounts: countsBy(prompts, (row) => row.envKey),
    lifecycleCounts: countsBy(prompts, (row) => row.lifecycleLabel),
  };
}

export function aggregateRecentOnboardSummaries(
  summaries: RecentOnboardSummary[],
): RecentOnboardScoreBreakdown {
  return scoreCounts(summaries.flatMap((s) => s.prompts));
}

export function sortRecentOnboardSummaries(
  summaries: RecentOnboardSummary[],
  sortMode: RecentOnboardsSortMode,
): RecentOnboardSummary[] {
  if (sortMode !== "records_first") return summaries;
  return [...summaries].sort((a, b) => {
    const ar = a.prompts.length > 0 ? 1 : 0;
    const br = b.prompts.length > 0 ? 1 : 0;
    if (ar !== br) return br - ar;
    const am = a.userId ? 1 : 0;
    const bm = b.userId ? 1 : 0;
    if (am !== bm) return bm - am;
    return a.email.localeCompare(b.email);
  });
}

export function collectRecentOnboardEnvironmentOptions(
  summaries: RecentOnboardSummary[],
): RecentOnboardsEnvironmentOption[] {
  const counts = new Map<string, number>();
  for (const summary of summaries) {
    for (const prompt of summary.prompts) {
      const value = envFilterValue(prompt);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({
      value,
      label: envFilterLabel(value),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function collectRecentOnboardProjectOptions(
  summaries: RecentOnboardSummary[],
): RecentOnboardsProjectOption[] {
  const counts = new Map<string, number>();
  for (const summary of summaries) {
    for (const prompt of summary.prompts) {
      const value = projectFilterValue(prompt);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({
      value,
      label: value,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function filterRecentOnboardSummariesByProject(
  summaries: RecentOnboardSummary[],
  filter: { mode: RecentOnboardsProjectFilterMode; values: Set<string> },
): RecentOnboardSummary[] {
  if (filter.mode === "all" || filter.values.size === 0) return summaries;
  return summaries.map((summary) => {
    const prompts = summary.prompts.filter((prompt) => {
      const selected = filter.values.has(projectFilterValue(prompt));
      return filter.mode === "include" ? selected : !selected;
    });
    return withPrompts(summary, prompts);
  });
}

export function filterRecentOnboardSummariesByEnvironment(
  summaries: RecentOnboardSummary[],
  filter: { mode: RecentOnboardsEnvironmentFilterMode; values: Set<string> },
): RecentOnboardSummary[] {
  if (filter.mode === "all" || filter.values.size === 0) return summaries;
  return summaries.map((summary) => {
    const prompts = summary.prompts.filter((prompt) => {
      const selected = filter.values.has(envFilterValue(prompt));
      return filter.mode === "include" ? selected : !selected;
    });
    return withPrompts(summary, prompts);
  });
}

export function filterRecentOnboardSummariesByFeedbackCount(
  summaries: RecentOnboardSummary[],
  minFeedbackRecords = RECENT_ONBOARDS_MIN_FEEDBACK_RECORDS,
): RecentOnboardSummary[] {
  return summaries.filter(
    (summary) => summary.feedbackCount >= minFeedbackRecords,
  );
}

export function prepareRecentOnboardsList(
  summaries: RecentOnboardSummary[],
  options: RecentOnboardsListOptions,
): RecentOnboardsListResult {
  const projectFilteredSummaries = filterRecentOnboardSummariesByProject(
    summaries,
    options.projectFilter,
  );
  const environmentFilteredSummaries = filterRecentOnboardSummariesByEnvironment(
    projectFilteredSummaries,
    options.environmentFilter,
  );
  const filteredSummaries = options.requireMinFeedback
    ? filterRecentOnboardSummariesByFeedbackCount(environmentFilteredSummaries)
    : environmentFilteredSummaries;
  const onboardsWithTasks = filteredSummaries.filter(
    (summary) => summary.prompts.length > 0,
  );
  const visibleSummaries =
    options.visibilityMode === "with_tasks"
      ? onboardsWithTasks
      : filteredSummaries;
  const sortedSummaries = sortRecentOnboardSummaries(
    visibleSummaries,
    options.sortMode,
  );

  return {
    filteredSummaries,
    onboardsWithTasks,
    sortedSummaries,
  };
}

function countsCsvValue(rows: Array<{ key: string; count: number }>): string {
  return rows.map((row) => `${row.key}: ${row.count}`).join("; ");
}

export function recentOnboardSummariesToCsv(
  summaries: RecentOnboardSummary[],
): string {
  const header = [
    "row_number",
    "email",
    "display_name",
    "user_id",
    "user_profile_path",
    "feedback_count",
    "task_count",
    "scored_count",
    "pending_count",
    "excellent_count",
    "average_count",
    "poor_count",
    "pruned_count",
    "classified_count",
    "poor_percent",
    "latest_task_iso",
    "projects",
    "environments",
    "lifecycle",
  ];
  const lines = summaries.map((summary) =>
    [
      summary.rowNumber,
      summary.email,
      summary.displayName,
      summary.userId,
      summary.encodedUserKey ? `/users/${summary.encodedUserKey}` : "",
      summary.feedbackCount,
      summary.scores.total,
      summary.scores.scored,
      summary.scores.pending,
      summary.scores.excellent,
      summary.scores.average,
      summary.scores.poor,
      summary.scores.pruned,
      summary.scores.classified,
      summary.scores.poorPercent,
      summary.latestTaskIso,
      countsCsvValue(summary.projectCounts),
      countsCsvValue(summary.environmentCounts),
      countsCsvValue(summary.lifecycleCounts),
    ]
      .map((value) => csvEscape(value))
      .join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}

export function parseRecentOnboardEmailsCsv(content: string): {
  emails: RecentOnboardEmailInput[];
  invalidRows: Array<{ rowNumber: number; value: string }>;
  duplicateEmails: string[];
} {
  const rows = parseCsvToRows(content).filter((row) =>
    row.some((cell) => cell.trim().length > 0),
  );
  if (rows.length === 0) {
    return { emails: [], invalidRows: [], duplicateEmails: [] };
  }

  const normalizedHeader = rows[0].map(normalizeOnboardCsvHeader);
  const headerIndex = normalizedHeader.findIndex(looksLikeEmailHeader);
  const hasHeader = headerIndex !== -1;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const firstDataRowNumber = hasHeader ? 2 : 1;

  const seen = new Set<string>();
  const duplicateSet = new Set<string>();
  const emails: RecentOnboardEmailInput[] = [];
  const invalidRows: Array<{ rowNumber: number; value: string }> = [];

  for (const [idx, row] of dataRows.entries()) {
    const rowNumber = firstDataRowNumber + idx;
    const rawCandidates = hasHeader ? [row[headerIndex] ?? ""] : row;
    const emailsInRow = rawCandidates
      .map((raw) => normalizeEmail(raw))
      .filter((email): email is string => email != null);

    if (emailsInRow.length === 0) {
      const value = hasHeader ? (row[headerIndex]?.trim() ?? "") : rowDisplayValue(row);
      if (value) invalidRows.push({ rowNumber, value });
      continue;
    }

    for (const email of emailsInRow) {
      if (seen.has(email)) {
        duplicateSet.add(email);
        continue;
      }
      seen.add(email);
      emails.push({ email, rowNumber });
    }
  }

  return {
    emails,
    invalidRows,
    duplicateEmails: [...duplicateSet].sort(),
  };
}

export async function analyzeRecentOnboards(
  prisma: PrismaClient,
): Promise<RecentOnboardsAnalysis> {
  const csvRelativePath = getRecentOnboardsCsvRelative();
  const csvAbsolutePath = getRecentOnboardsCsvAbsolute();
  const csvExists = existsSync(csvAbsolutePath);
  const parsed = csvExists
    ? parseRecentOnboardEmailsCsv(readFileSync(csvAbsolutePath, "utf8"))
    : { emails: [], invalidRows: [], duplicateEmails: [] };

  const profiles = loadUserLookupProfiles();
  const profileByEmail = new Map<string, UserLookupProfile>();
  for (const profile of profiles) {
    if (!profile.email) continue;
    profileByEmail.set(profile.email.toLowerCase(), profile);
  }

  const [promptMeta, feedbackRows] = await Promise.all([
    fetchPromptLibraryMeta(prisma),
    prisma.feedback.findMany({
      select: {
        createdById: true,
        createdByEmail: true,
        createdByName: true,
      },
    }),
  ]);
  const promptsByCreatorId = new Map<string, PromptLibraryMetaRow[]>();
  for (const prompt of promptMeta) {
    const creatorId = getCreatedByIdFromExtra(prompt.extra)?.toLowerCase();
    if (!creatorId) continue;
    let rows = promptsByCreatorId.get(creatorId);
    if (!rows) {
      rows = [];
      promptsByCreatorId.set(creatorId, rows);
    }
    rows.push(prompt);
  }

  const feedbackCountByUserKey = new Map<string, number>();
  for (const row of feedbackRows) {
    const key = canonicalKeyFromFeedbackSlice(row);
    feedbackCountByUserKey.set(
      key,
      (feedbackCountByUserKey.get(key) ?? 0) + 1,
    );
  }

  const summaries: RecentOnboardSummary[] = parsed.emails.map((input) => {
    const profile = profileByEmail.get(input.email) ?? null;
    const userId = profile?.id ?? null;
    const userKey = userId ? `id:${userId.toLowerCase()}` : null;
    const feedbackKeys = [
      userKey,
      input.email ? `email:${input.email.toLowerCase()}` : null,
    ].filter((key): key is string => key != null);
    const feedbackCount = feedbackKeys.reduce(
      (total, key) => total + (feedbackCountByUserKey.get(key) ?? 0),
      0,
    );
    const promptRows = userId
      ? (promptsByCreatorId.get(userId.toLowerCase()) ?? [])
      : [];
    const prompts = promptRows
      .map(promptToSummary)
      .sort((a, b) => promptCreatedAtMillis(b) - promptCreatedAtMillis(a));

    return {
      email: input.email,
      rowNumber: input.rowNumber,
      userId,
      userKey,
      encodedUserKey: userKey ? encodeUserKeyForPath(userKey) : null,
      displayName: profile?.fullName ?? null,
      feedbackCount,
      prompts,
      scores: scoreCounts(prompts),
      latestTaskIso: latestTaskIso(prompts),
      projectCounts: countsBy(prompts, (row) => row.projectKey),
      environmentCounts: countsBy(prompts, (row) => row.envKey),
      lifecycleCounts: countsBy(prompts, (row) => row.lifecycleLabel),
    };
  });

  const unmatchedEmails = summaries
    .filter((summary) => !summary.userId)
    .map(({ email, rowNumber }) => ({ email, rowNumber }));
  const aggregate = aggregateRecentOnboardSummaries(summaries);

  return {
    csvRelativePath,
    csvAbsolutePath,
    csvExists,
    usersLoaded: profiles.length,
    inputEmails: parsed.emails,
    invalidRows: parsed.invalidRows,
    duplicateEmails: parsed.duplicateEmails,
    summaries,
    unmatchedEmails,
    aggregate,
  };
}
