import { readFileSync } from "node:fs";
import {
  normalizeCsvHeader,
  parseCsvToRows,
} from "@/lib/dataset/csv-rfc4180";
import { taskRowSchema, type TaskRow } from "@/lib/dataset/prompts-json";

function pickTrimmed(obj: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]?.trim();
    if (v) return v;
  }
  return "";
}

function parseOptionalNumber(raw: string | undefined): number | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Merge JSON `metadata` cell with useful flat CSV columns for filters / UI.
 */
function buildEvalMetadata(obj: Record<string, string>): unknown {
  let base: Record<string, unknown> = {};
  const metaRaw = obj.metadata?.trim();
  if (metaRaw) {
    try {
      const parsed = JSON.parse(metaRaw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      base.raw_metadata_csv = metaRaw;
    }
  }

  const passthrough = [
    "environment_name",
    "scenario_title",
    "instance_status",
    "diff_generation_error",
    "verifier_generation_error",
    "prompt_quality_rating",
    "avg_score",
  ] as const;
  for (const k of passthrough) {
    const v = obj[k]?.trim();
    if (v) base[k] = v;
  }

  return Object.keys(base).length > 0 ? base : null;
}

function csvRecordToTaskRow(
  obj: Record<string, string>,
  rowIndex: number,
): TaskRow {
  const id = pickTrimmed(obj, "task_id", "id");
  const key =
    pickTrimmed(obj, "task_key", "key") || id || `csv_row_${rowIndex}`;
  const createdAt =
    pickTrimmed(obj, "created_at", "created_at_iso") ||
    new Date().toISOString();
  const promptText = obj.prompt ?? "";

  const evalId =
    pickTrimmed(obj, "eval_task_version_id", "eval_task_versions_id") ||
    `${id}:eval`;

  const versionNo = parseOptionalNumber(obj.version_no ?? obj.version);

  const metadata = buildEvalMetadata(obj);

  const createdBy =
    pickTrimmed(obj, "created_by_id", "created_by", "author_id") || undefined;

  const built: TaskRow = {
    id,
    key,
    created_at: createdAt,
    ...(createdBy ? { created_by: createdBy } : {}),
    task_lifecycle_status:
      pickTrimmed(obj, "lifecycle_status", "task_lifecycle_status") ||
      undefined,
    task_modality: pickTrimmed(obj, "task_modality", "modality") || undefined,
    team_id: pickTrimmed(obj, "team_id") || undefined,
    task_project_target_id:
      pickTrimmed(obj, "task_project_target_id") || undefined,
    eval_task_versions: {
      id: evalId,
      prompt: promptText,
      env_key: pickTrimmed(obj, "env_key", "environment", "env") || undefined,
      ...(versionNo !== undefined ? { version_no: versionNo } : {}),
      ...(metadata != null ? { metadata } : {}),
      factual_answer: undefined,
    },
  };

  return built;
}

/**
 * Prompt-export CSV (e.g. `finance_long_horizon.csv`): maps columns to the same {@link TaskRow}
 * shape as JSON ingest (`task_id`, `task_key`, `prompt`, `env_key`, `metadata`, …).
 */
export function parsePromptsCsvFile(filePath: string): TaskRow[] {
  let raw = readFileSync(filePath, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  }
  const rows = parseCsvToRows(raw);
  if (rows.length === 0) return [];

  const headers = rows[0].map(normalizeCsvHeader);
  const out: TaskRow[] = [];

  for (let i = 1; i < rows.length; i += 1) {
    const line = rows[i];
    if (line.every((c) => (c ?? "").trim() === "")) continue;

    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c += 1) {
      obj[headers[c]] = line[c] ?? "";
    }

    const id = pickTrimmed(obj, "task_id", "id");
    if (!id) continue;

    const candidate = csvRecordToTaskRow(obj, i);
    const parsed = taskRowSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(
        `${filePath}: row ${i + 1}: ${parsed.error.message}`,
      );
    }
    out.push(parsed.data);
  }

  return out;
}
