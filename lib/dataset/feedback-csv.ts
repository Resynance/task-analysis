import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  normalizeCsvHeader,
  parseCsvToRows,
} from "@/lib/dataset/csv-rfc4180";

export type FeedbackCsvRow = {
  feedback_id: string;
  task_id?: string | null;
  task_key?: string | null;
  created_at?: string | null;
  created_by_id?: string | null;
  created_by_name?: string | null;
  created_by_email?: string | null;
  feedback_content?: string | null;
  is_positive?: string | null;
  is_admin?: string | null;
  prompt_quality_rating?: string | null;
  rejection_reason?: string | null;
  rejection_reason_label?: string | null;
  is_disputed?: string | null;
  dispute_status?: string | null;
  dispute_reason?: string | null;
  dispute_resolution_reason?: string | null;
  dispute_resolved_at?: string | null;
};

const SAMPLES_DIR = "samples";

/**
 * `feedback/samples/*.csv` (safe fixtures for clones) plus one nested level
 * `feedback/<project>/*.csv`. Top-level `feedback/*.csv` is intentionally not
 * listed here so real exports stay local-only (see `.gitignore`).
 */
export function listFeedbackCsvFiles(): string[] {
  const dir = path.join(process.cwd(), "feedback");
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase().endsWith(".csv")) {
      continue;
    }
    if (!e.isDirectory()) continue;
    if (e.name === SAMPLES_DIR) {
      let sampleEntries;
      try {
        sampleEntries = readdirSync(full, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const se of sampleEntries) {
        if (!se.isFile() || !se.name.toLowerCase().endsWith(".csv")) continue;
        out.push(path.join(full, se.name));
      }
      continue;
    }
    let subEntries;
    try {
      subEntries = readdirSync(full, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const se of subEntries) {
      if (!se.isFile() || !se.name.toLowerCase().endsWith(".csv")) continue;
      out.push(path.join(full, se.name));
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

/**
 * Project slug always comes from the **filesystem** (not CSV rows):
 * - `feedback/<project>/<env>.csv` → project = folder name, env = file basename
 * - `feedback/samples/<name>.csv` → project = `samples`, env = file basename
 */
export function projectAndEnvFromFeedbackCsvPath(filePath: string): {
  projectKey: string;
  envKey: string;
} {
  const feedbackRoot = path.join(process.cwd(), "feedback");
  const rel = path.relative(feedbackRoot, filePath);
  const segments = rel.split(path.sep).filter(Boolean);
  const base = path.basename(filePath, path.extname(filePath)).trim();
  const envKey = base || "unknown";
  if (segments.length >= 2) {
    return {
      projectKey: segments[0].trim().toLowerCase(),
      envKey,
    };
  }
  const slug = base.toLowerCase() || "unknown";
  return { projectKey: slug, envKey: slug };
}

/** @deprecated Prefer {@link projectAndEnvFromFeedbackCsvPath}. */
export function envKeyFromFeedbackCsvFilename(filePath: string): string {
  return projectAndEnvFromFeedbackCsvPath(filePath).envKey;
}

export function parseFeedbackCsvFile(filePath: string): FeedbackCsvRow[] {
  const raw = readFileSync(filePath, "utf8");
  const rows = parseCsvToRows(raw);
  if (rows.length === 0) return [];
  const headers = rows[0].map(normalizeCsvHeader);
  const out: FeedbackCsvRow[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    if (r.every((c) => (c ?? "").trim() === "")) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c += 1) {
      obj[headers[c]] = r[c] ?? "";
    }
    const id = (obj.feedback_id ?? "").trim();
    if (!id) continue;
    out.push({
      feedback_id: id,
      task_id: obj.task_id?.trim() || null,
      task_key: obj.task_key?.trim() || null,
      created_at: obj.created_at?.trim() || null,
      created_by_id: obj.created_by_id?.trim() || null,
      created_by_name: obj.created_by_name?.trim() || null,
      created_by_email: obj.created_by_email?.trim() || null,
      feedback_content: obj.feedback_content ?? null,
      is_positive: obj.is_positive?.trim() || null,
      is_admin: obj.is_admin?.trim() || null,
      prompt_quality_rating: obj.prompt_quality_rating?.trim() || null,
      rejection_reason: obj.rejection_reason?.trim() || null,
      rejection_reason_label: obj.rejection_reason_label?.trim() || null,
      is_disputed: obj.is_disputed?.trim() || null,
      dispute_status: obj.dispute_status?.trim() || null,
      dispute_reason: obj.dispute_reason?.trim() || null,
      dispute_resolution_reason:
        obj.dispute_resolution_reason?.trim() || null,
      dispute_resolved_at: obj.dispute_resolved_at?.trim() || null,
    });
  }
  return out;
}
