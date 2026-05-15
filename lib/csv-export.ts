/**
 * RFC 4180-style CSV helpers for exporting prompt tables and similar grids from the UI.
 */

/** Escape a field for CSV (RFC 4180 style). */
export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function promptsToCsv(
  rows: {
    id: string;
    sourceId: string | null;
    sourceKey: string | null;
    projectKey: string | null;
    guidelineName: string;
    score: string | null;
    rationale: string | null;
    body: string;
    envKey: string | null;
    canonicalEnv?: string | null;
    taskModality: string | null;
    analyzedAt: Date | string | null;
    createdAt: Date | string;
  }[],
): string {
  const headers = [
    "id",
    "source_id",
    "source_key",
    "project_key",
    "guideline",
    "score",
    "rationale",
    "body",
    "env_key",
    "evaluation_environment",
    "task_modality",
    "analyzed_at",
    "created_at",
  ];

  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        csvEscape(r.id),
        csvEscape(r.sourceId),
        csvEscape(r.sourceKey),
        csvEscape(r.projectKey),
        csvEscape(r.guidelineName),
        csvEscape(r.score),
        csvEscape(r.rationale),
        csvEscape(r.body),
        csvEscape(r.envKey),
        csvEscape(r.canonicalEnv ?? ""),
        csvEscape(r.taskModality),
        csvEscape(
          r.analyzedAt
            ? new Date(r.analyzedAt).toISOString()
            : "",
        ),
        csvEscape(new Date(r.createdAt).toISOString()),
      ].join(","),
    ),
  ];

  return lines.join("\n") + "\n";
}
