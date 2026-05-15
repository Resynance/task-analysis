import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const evalVersionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  env_key: z.string().optional(),
  version_no: z.number().optional(),
  metadata: z.unknown().optional().nullable(),
  factual_answer: z.unknown().optional().nullable(),
});

export const taskRowSchema = z.object({
  id: z.string(),
  key: z.string(),
  created_at: z.string(),
  created_by: z.string().optional(),
  task_lifecycle_status: z.string().optional(),
  task_modality: z.string().optional(),
  team_id: z.string().optional(),
  task_project_target_id: z.string().optional(),
  eval_task_versions: evalVersionSchema.nullish(),
});

export type TaskRow = z.infer<typeof taskRowSchema>;

export function resolvePromptsJsonPath(): string | null {
  const candidates = [
    path.join(process.cwd(), "prompts", "prompts.json"),
    path.join(process.cwd(), "Prompts", "prompts.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      return p;
    }
  }
  return null;
}

function isPromptImportFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".json") || lower.endsWith(".csv");
}

/**
 * JSON and CSV prompt exports: top-level `Prompts/` and `prompts/` plus one nested level
 * (`prompts/<project>/…`), matching feedback ingest layout.
 */
export function listPromptsDirectoryImportFiles(): string[] {
  const cwd = process.cwd();
  const dirs = ["Prompts", "prompts"];
  const files: string[] = [];

  for (const dir of dirs) {
    const abs = path.join(cwd, dir);
    if (!existsSync(abs)) continue;
    const entries = readdirSync(abs, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(abs, ent.name);
      if (ent.isFile() && isPromptImportFile(ent.name)) {
        files.push(full);
        continue;
      }
      if (!ent.isDirectory()) continue;
      let subEntries;
      try {
        subEntries = readdirSync(full, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const se of subEntries) {
        if (!se.isFile() || !isPromptImportFile(se.name)) continue;
        files.push(path.join(full, se.name));
      }
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

/**
 * Project slug for merged ingest: nested file `prompts/tryouts/tasks.csv` → `tryouts`;
 * top-level `prompts/foo.json` → `foo`.
 */
export function projectKeyFromPromptImportPath(filePath: string): string {
  const normalized = path.resolve(filePath);
  const cwd = process.cwd();
  for (const dir of ["prompts", "Prompts"]) {
    const root = path.resolve(cwd, dir);
    const rel = path.relative(root, normalized);
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
    const parts = rel.split(path.sep).filter(Boolean);
    if (parts.length >= 2) {
      return parts[0].trim().toLowerCase();
    }
    return path.basename(normalized, path.extname(normalized)).trim().toLowerCase();
  }
  return path.basename(normalized, path.extname(normalized)).trim().toLowerCase();
}

/** @deprecated Use {@link listPromptsDirectoryImportFiles} (JSON + CSV). */
export function listPromptsDirectoryJsonFiles(): string[] {
  return listPromptsDirectoryImportFiles().filter((p) =>
    p.toLowerCase().endsWith(".json"),
  );
}

/**
 * JSON does not allow raw U+0000–U+001F inside string literals. Exports often
 * embed literal newlines/tabs in `prompt` or `metadata` fields — escape them so
 * `JSON.parse` succeeds.
 */
export function escapeBadControlsInJsonStrings(input: string): string {
  let out = "";
  let i = 0;
  let inString = false;

  while (i < input.length) {
    const c = input[i]!;

    if (!inString) {
      if (c === '"') {
        inString = true;
      }
      out += c;
      i++;
      continue;
    }

    // Inside "..." string
    if (c === "\\") {
      out += c;
      i++;
      if (i >= input.length) {
        break;
      }
      const next = input[i]!;
      out += next;
      i++;
      if (next === "u") {
        for (let k = 0; k < 4 && i < input.length; k++) {
          out += input[i]!;
          i++;
        }
      }
      continue;
    }

    if (c === '"') {
      inString = false;
      out += c;
      i++;
      continue;
    }

    const code = c.charCodeAt(0);
    if (code < 32) {
      switch (code) {
        case 9:
          out += "\\t";
          break;
        case 10:
          out += "\\n";
          break;
        case 13:
          out += "\\r";
          break;
        default:
          out += "\\u" + code.toString(16).padStart(4, "0");
      }
    } else {
      out += c;
    }
    i++;
  }

  return out;
}

/**
 * Supports a single JSON array, or multiple root arrays accidentally concatenated
 * (e.g. `][` between `...}]` and `{...}`).
 */
function parseJsonArrays(raw: string): unknown[] {
  const trimmed = raw.trim();
  const sanitized = escapeBadControlsInJsonStrings(trimmed);

  let firstErr: string;
  try {
    const data = JSON.parse(sanitized) as unknown;
    if (Array.isArray(data)) {
      return data;
    }
    firstErr = "Root JSON value must be an array";
  } catch (e) {
    firstErr = e instanceof Error ? e.message : String(e);
  }

  const merged = sanitized.replace(/\]\s*\[/g, ",");
  try {
    const data = JSON.parse(merged) as unknown;
    if (Array.isArray(data)) {
      return data;
    }
    throw new Error("Root JSON value must be an array");
  } catch (mergeErr) {
    const mergeMsg =
      mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
    const detail =
      mergeMsg === firstErr
        ? mergeMsg
        : `${firstErr}; after ][][ merge: ${mergeMsg}`;
    throw new Error(
      `Could not parse prompts.json as a JSON array (try fixing truncated or merged arrays). ${detail}`,
    );
  }
}

export function parsePromptsJsonFile(filePath: string): TaskRow[] {
  const raw = readFileSync(filePath, "utf8");
  const data = parseJsonArrays(raw);
  return data.map((row, i) => {
    const parsed = taskRowSchema.safeParse(row);
    if (!parsed.success) {
      throw new Error(
        `Invalid row at index ${i}: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  });
}

/** Drop very large metadata fields (e.g. embedded verifier source) from stored JSON. */
function trimMetadata(meta: unknown): unknown {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return meta ?? null;
  }
  const next = { ...(meta as Record<string, unknown>) };
  if (
    typeof next.verifier_code === "string" &&
    next.verifier_code.length > 2000
  ) {
    next.verifier_code = "[omitted — large verifier script]";
  }
  return next;
}

/** Import slug comes from the file path; strip row/metadata fields that would pretend otherwise. */
function scrubRecordProjectFieldsFromMetadata(meta: unknown): unknown {
  const trimmed = trimMetadata(meta);
  if (!trimmed || typeof trimmed !== "object" || Array.isArray(trimmed)) {
    return trimmed ?? null;
  }
  const next = { ...(trimmed as Record<string, unknown>) };
  for (const k of [
    "project_name",
    "project_key",
    "project_slug",
    "project",
    "project_id",
  ]) {
    delete next[k];
  }
  return Object.keys(next).length > 0 ? next : null;
}

/**
 * @param importProjectKey Slug from the import filename/path ({@link projectKeyFromPromptImportPath}), not from task rows.
 */
export function buildExtra(
  row: TaskRow,
  importProjectKey: string,
): Record<string, unknown> {
  const v = row.eval_task_versions;
  return {
    import_project_key: importProjectKey,
    id: row.id,
    key: row.key,
    created_at: row.created_at,
    created_by: row.created_by ?? null,
    task_lifecycle_status: row.task_lifecycle_status ?? null,
    task_modality: row.task_modality ?? null,
    team_id: row.team_id ?? null,
    task_project_target_id: row.task_project_target_id ?? null,
    eval_task_versions: v
      ? {
          id: v.id,
          env_key: v.env_key ?? null,
          version_no: v.version_no ?? null,
          metadata: scrubRecordProjectFieldsFromMetadata(v.metadata),
          factual_answer: v.factual_answer ?? null,
        }
      : null,
  };
}
