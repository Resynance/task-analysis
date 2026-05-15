import path from "node:path";

/**
 * Configurable **repo-relative paths** for special-project tooling (trace exports, PM failure
 * analysis, local CSV inputs). Defaults match this repository’s layout; forks can point at their
 * own trees without renaming directories in git — set `TASK_ANALYSIS_*` in `.env` (server /
 * Next.js only).
 *
 * Use **forward slashes** in env values (`projects/foo/bar`); they are normalized for `path.join`.
 * `..` and absolute paths are rejected; invalid values fall back to defaults.
 */

export const TRACE_EXPORTS_RELATIVE_DEFAULT = "projects/openclaw/trace-exports";
export const PM_FAILURE_ROOT_RELATIVE_DEFAULT = "projects/pm/gpt-failure analysis";
export const RECENT_ONBOARDS_CSV_RELATIVE_DEFAULT = "projects/recent-onboards/onboards.csv";
export const USER_TASK_AUTHENTICITY_JSON_RELATIVE_DEFAULT =
  "projects/user-task-authenticity/tasks.json";

function normalizeRepoRelativePath(raw: string | undefined, fallback: string): string {
  const s = (raw ?? fallback).trim().replace(/\\/g, "/");
  if (!s || s.startsWith("/") || s.includes("..")) {
    return fallback;
  }
  const parts = s.split("/").filter(Boolean);
  if (parts.length === 0) return fallback;
  return parts.join("/");
}

/** Repo-relative root containing trace scripts, JSON exports, `reports/`, etc. */
export function getTraceExportsRootRelative(): string {
  return normalizeRepoRelativePath(
    process.env.TASK_ANALYSIS_TRACE_EXPORTS_DIR,
    TRACE_EXPORTS_RELATIVE_DEFAULT,
  );
}

/** Absolute path to the trace-export root on the local filesystem. */
export function getTraceExportsRootAbsolute(): string {
  return path.join(process.cwd(), ...getTraceExportsRootRelative().split("/"));
}

/** POSIX-style repo-relative path for help text and UI. */
export function getTraceExportsAuditReportsGlobDisplay(): string {
  return `${getTraceExportsRootRelative()}/reports/task_*.md`;
}

/** Repo-relative root for PM / transcript failure analysis (`task_*`, `reports/`, …). */
export function getPmgptFailureRootRelative(): string {
  return normalizeRepoRelativePath(
    process.env.TASK_ANALYSIS_PM_FAILURE_DIR,
    PM_FAILURE_ROOT_RELATIVE_DEFAULT,
  );
}

export function getPmgptFailureRootAbsolute(): string {
  return path.join(process.cwd(), ...getPmgptFailureRootRelative().split("/"));
}

/** Repo-relative CSV of recent onboard emails for the onboard quality special project. */
export function getRecentOnboardsCsvRelative(): string {
  return normalizeRepoRelativePath(
    process.env.TASK_ANALYSIS_RECENT_ONBOARDS_CSV,
    RECENT_ONBOARDS_CSV_RELATIVE_DEFAULT,
  );
}

export function getRecentOnboardsCsvAbsolute(): string {
  return path.join(process.cwd(), ...getRecentOnboardsCsvRelative().split("/"));
}

/** Repo-relative JSON of one user's tasks for AI/authenticity risk review. */
export function getUserTaskAuthenticityJsonRelative(): string {
  return normalizeRepoRelativePath(
    process.env.TASK_ANALYSIS_USER_TASK_AUTHENTICITY_JSON,
    USER_TASK_AUTHENTICITY_JSON_RELATIVE_DEFAULT,
  );
}

export function getUserTaskAuthenticityJsonAbsolute(): string {
  return path.join(
    process.cwd(),
    ...getUserTaskAuthenticityJsonRelative().split("/"),
  );
}
