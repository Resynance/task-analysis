import type { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { DATASET_IMPORTED_TASKS_GUIDELINE_NAME } from "@/lib/dataset/guideline-names";
import path from "node:path";
import { parsePromptsCsvFile } from "@/lib/dataset/prompts-csv";
import {
  buildExtra,
  listPromptsDirectoryImportFiles,
  parsePromptsJsonFile,
  projectKeyFromPromptImportPath,
  resolvePromptsJsonPath,
  type TaskRow,
} from "@/lib/dataset/prompts-json";

const DATASET_GUIDELINE_NAME = DATASET_IMPORTED_TASKS_GUIDELINE_NAME;

async function getOrCreateDatasetGuideline(
  prisma: PrismaClient,
): Promise<string> {
  const existing = await prisma.guideline.findFirst({
    where: { name: DATASET_GUIDELINE_NAME },
  });
  if (existing) {
    return existing.id;
  }

  const created = await prisma.guideline.create({
    data: {
      name: DATASET_GUIDELINE_NAME,
      content: `These prompts were imported from JSON or CSV files under \`Prompts/\` or \`prompts/\`. Evaluate whether each task is clear, scoped, safe for training, and appropriate for the target environment (see env_key / modality in metadata).`,
    },
  });
  return created.id;
}

type TaskRowWithProject = { row: TaskRow; projectKey: string };

async function upsertTaskRows(
  prisma: PrismaClient,
  rows: TaskRowWithProject[],
  guidelineId: string,
): Promise<{ synced: number; skipped: number }> {
  let synced = 0;
  let skipped = 0;

  for (const { row, projectKey } of rows) {
    const v = row.eval_task_versions;
    const body = v?.prompt?.trim();
    if (!body) {
      skipped += 1;
      continue;
    }

    const sourceCreated = Number.isNaN(Date.parse(row.created_at))
      ? null
      : new Date(row.created_at);

    const payload = {
      body,
      guidelineId,
      sourceId: row.id,
      sourceKey: row.key,
      projectKey,
      envKey: v?.env_key ?? null,
      versionNo: v?.version_no ?? null,
      taskModality: row.task_modality ?? null,
      sourceCreated,
      extra: buildExtra(row, projectKey) as Prisma.InputJsonValue,
    };

    await prisma.prompt.upsert({
      where: { sourceId: row.id },
      create: payload,
      update: {
        body: payload.body,
        guidelineId: payload.guidelineId,
        sourceKey: payload.sourceKey,
        projectKey: payload.projectKey,
        envKey: payload.envKey,
        versionNo: payload.versionNo,
        taskModality: payload.taskModality,
        sourceCreated: payload.sourceCreated,
        extra: payload.extra,
      },
    });
    synced += 1;
  }

  return { synced, skipped };
}

export type ImportPromptsResult = {
  /** Legacy single-file path when using one-file import only */
  filePath: string | null;
  filePaths: string[];
  synced: number;
  skipped: number;
  /** Duplicate task ids dropped when merging multiple JSON/CSV files (first wins). */
  duplicatesDropped: number;
  message: string;
};

function parsePromptImportFile(filePath: string): TaskRow[] {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".csv") return parsePromptsCsvFile(filePath);
  if (ext === ".json") return parsePromptsJsonFile(filePath);
  throw new Error(`Unsupported prompt import format: ${filePath}`);
}

function mergeRowsDedupeById(
  filePaths: string[],
): { rows: TaskRowWithProject[]; duplicatesDropped: number } {
  const byId = new Map<string, TaskRowWithProject>();
  let duplicatesDropped = 0;

  for (const filePath of filePaths) {
    const projectKey = projectKeyFromPromptImportPath(filePath);
    const parsed = parsePromptImportFile(filePath);
    for (const row of parsed) {
      if (byId.has(row.id)) {
        duplicatesDropped += 1;
      } else {
        byId.set(row.id, { row, projectKey });
      }
    }
  }

  return { rows: [...byId.values()], duplicatesDropped };
}

/**
 * Reads every `.json` and `.csv` file in `Prompts/` and `prompts/` (plus one nested project
 * folder), merges rows, dedupes by task `id` (first occurrence wins), then upserts into
 * `Prompt` by `sourceId`.
 */
export async function ingestPromptsFromPromptsDirectories(
  prisma: PrismaClient,
): Promise<ImportPromptsResult> {
  const filePaths = listPromptsDirectoryImportFiles();

  if (filePaths.length === 0) {
    return {
      filePath: null,
      filePaths: [],
      synced: 0,
      skipped: 0,
      duplicatesDropped: 0,
      message:
        "No .json or .csv files found in Prompts/ or prompts/. Add prompt exports to those folders first.",
    };
  }

  const { rows, duplicatesDropped } = mergeRowsDedupeById(filePaths);
  const guidelineId = await getOrCreateDatasetGuideline(prisma);
  const { synced, skipped } = await upsertTaskRows(prisma, rows, guidelineId);

  const fileList =
    filePaths.length <= 3
      ? filePaths.map((p) => p.split(/[/\\]/).slice(-2).join("/")).join(", ")
      : `${filePaths.length} files`;

  let message = `Synced ${synced} prompt(s) from ${fileList}`;
  if (skipped > 0) message += ` (${skipped} skipped with empty prompt text)`;
  if (duplicatesDropped > 0) {
    message += `. Dropped ${duplicatesDropped} duplicate id(s) across files.`;
  }

  return {
    filePath: filePaths[0] ?? null,
    filePaths,
    synced,
    skipped,
    duplicatesDropped,
    message,
  };
}

/**
 * @deprecated Prefer {@link ingestPromptsFromPromptsDirectories}. Kept for scripts that target a single legacy path.
 * Loads `prompts/prompts.json` or `Prompts/prompts.json` only (no multi-file scan).
 */
export async function importPromptsFromJson(
  prisma: PrismaClient,
): Promise<ImportPromptsResult> {
  const filePath = resolvePromptsJsonPath();
  if (!filePath) {
    return {
      filePath: null,
      filePaths: [],
      synced: 0,
      skipped: 0,
      duplicatesDropped: 0,
      message:
        "No prompts.json found at prompts/prompts.json or Prompts/prompts.json",
    };
  }

  const { rows, duplicatesDropped } = mergeRowsDedupeById([filePath]);
  const guidelineId = await getOrCreateDatasetGuideline(prisma);
  const { synced, skipped } = await upsertTaskRows(prisma, rows, guidelineId);

  return {
    filePath,
    filePaths: [filePath],
    synced,
    skipped,
    duplicatesDropped,
    message: `Synced ${synced} prompts from ${filePath} (${skipped} skipped with empty prompt text).`,
  };
}
