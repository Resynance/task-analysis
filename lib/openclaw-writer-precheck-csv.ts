import { normalizeCsvHeader, parseCsvToRows } from "@/lib/dataset/csv-rfc4180";

/**
 * Intake CSV for **writer draft pre-check**: prompt body, optional writer rubric / notes / ids,
 * and writer name. Headers are normalized and matched through alias sets so exports from Sheets or
 * Excel with different labels still map. Limits mirror `writer-precheck/route.ts`.
 */
export const WRITER_PRECHECK_MAX_ROWS = 80;
export const WRITER_PRECHECK_MAX_PROMPT_CHARS = 120_000;
/** Sprint-style sheets embed long rubric blocks (many MUST/NICE lines). */
export const WRITER_PRECHECK_MAX_RUBRIC_CHARS = 500_000;
export const WRITER_PRECHECK_MAX_NOTES_CHARS = 32_000;

export type WriterPrecheckCsvRow = {
  /** 1-based row index in the CSV (excluding header). */
  rowIndex: number;
  /** Optional stable id from the sheet (e.g. task key, then updated id). */
  externalId: string | null;
  prompt: string;
  writerRubric: string | null;
  notes: string | null;
  /** Writer or author name from intake when the sheet includes a name column. */
  writerName: string | null;
  /** Persona label from intake (e.g. "Persona Name"); context only. */
  personaName: string | null;
};

const PROMPT_HEADER_ALIASES = new Set([
  "prompt",
  "prompt_body",
  "body",
  "task_prompt",
  "task",
  "prompt_text",
  /** Google Sheets export: "Prompt/Task" */
  "prompt/task",
]);

const RUBRIC_HEADER_ALIASES = new Set([
  "rubric",
  "writer_rubric",
  "draft_rubric",
  "acceptance_criteria",
  "criteria",
]);

const NOTES_HEADER_ALIASES = new Set([
  "notes",
  "note",
  "comments",
  "comment",
  "internal_notes",
  /** Common alias for combined notes/comments headers on sprint-style sheets. */
  "notes/comments",
]);

const WRITER_NAME_ALIASES = new Set([
  "name",
  "writer",
  "writer_name",
  "author",
  "task_writer",
]);

const PERSONA_NAME_ALIASES = new Set([
  "persona_name",
  "persona",
  "target_persona",
  "character",
]);

/** Prefer task instance key, then updated id (typical column order on sprint-style exports). */
const EXTERNAL_ID_HEADER_KEYS: string[] = [
  "task_key/id_or_instance_id",
  "updated_task_id",
  "id",
  "row_id",
  "task_id",
  "key",
  "external_id",
];

function pickColumnIndex(
  headerNorm: string[],
  aliases: Set<string>,
): number | null {
  for (let i = 0; i < headerNorm.length; i += 1) {
    const h = headerNorm[i];
    if (h && aliases.has(h)) return i;
  }
  return null;
}

function pickExternalId(line: string[], headerNorm: string[]): string | null {
  for (const key of EXTERNAL_ID_HEADER_KEYS) {
    const idx = headerNorm.indexOf(key);
    if (idx < 0) continue;
    const v = (line[idx] ?? "").trim();
    if (v) return v;
  }
  return null;
}

export function parseWriterPrecheckCsv(content: string): {
  rows: WriterPrecheckCsvRow[];
  errors: string[];
} {
  const errors: string[] = [];
  const raw = parseCsvToRows(content.trim().length === 0 ? content : content);
  if (raw.length === 0) {
    errors.push("CSV is empty.");
    return { rows: [], errors };
  }

  const headerCells = raw[0]!.map((c) => normalizeCsvHeader(c));
  const promptCol = pickColumnIndex(headerCells, PROMPT_HEADER_ALIASES);
  if (promptCol == null) {
    errors.push(
      "Missing prompt column. Expected a header like `prompt`, `prompt_body`, or `Prompt/Task` " +
        "(match your sheet’s column names to these aliases).",
    );
    return { rows: [], errors };
  }

  const rubricCol = pickColumnIndex(headerCells, RUBRIC_HEADER_ALIASES);
  const notesCol = pickColumnIndex(headerCells, NOTES_HEADER_ALIASES);
  const writerNameCol = pickColumnIndex(headerCells, WRITER_NAME_ALIASES);
  const personaNameCol = pickColumnIndex(headerCells, PERSONA_NAME_ALIASES);

  const rows: WriterPrecheckCsvRow[] = [];

  for (let r = 1; r < raw.length; r += 1) {
    const line = raw[r]!;
    const prompt = (line[promptCol] ?? "").trim();
    if (!prompt) continue;

    const writerRubric =
      rubricCol != null ? (line[rubricCol] ?? "").trim() || null : null;
    const notes = notesCol != null ? (line[notesCol] ?? "").trim() || null : null;
    const externalId = pickExternalId(line, headerCells);
    const writerName =
      writerNameCol != null ? (line[writerNameCol] ?? "").trim() || null : null;
    const personaName =
      personaNameCol != null ? (line[personaNameCol] ?? "").trim() || null : null;

    if (prompt.length > WRITER_PRECHECK_MAX_PROMPT_CHARS) {
      errors.push(
        `Row ${r + 1}: prompt exceeds ${WRITER_PRECHECK_MAX_PROMPT_CHARS} characters.`,
      );
      continue;
    }
    if (writerRubric && writerRubric.length > WRITER_PRECHECK_MAX_RUBRIC_CHARS) {
      errors.push(
        `Row ${r + 1}: rubric exceeds ${WRITER_PRECHECK_MAX_RUBRIC_CHARS} characters.`,
      );
      continue;
    }
    if (notes && notes.length > WRITER_PRECHECK_MAX_NOTES_CHARS) {
      errors.push(
        `Row ${r + 1}: notes exceed ${WRITER_PRECHECK_MAX_NOTES_CHARS} characters.`,
      );
      continue;
    }

    if (rows.length >= WRITER_PRECHECK_MAX_ROWS) {
      errors.push(
        `Only the first ${WRITER_PRECHECK_MAX_ROWS} non-empty prompt rows are processed; additional rows were ignored.`,
      );
      break;
    }

    rows.push({
      rowIndex: r,
      externalId,
      prompt,
      writerRubric,
      notes,
      writerName,
      personaName,
    });
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push("No data rows with a non-empty prompt were found.");
  }

  return { rows, errors };
}
