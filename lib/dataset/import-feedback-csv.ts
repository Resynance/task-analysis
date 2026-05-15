import type { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  listFeedbackCsvFiles,
  parseFeedbackCsvFile,
  projectAndEnvFromFeedbackCsvPath,
  type FeedbackCsvRow,
} from "@/lib/dataset/feedback-csv";

function toBool(raw: string | null | undefined): boolean | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function buildExtra(row: FeedbackCsvRow): Record<string, unknown> {
  return {
    is_positive: toBool(row.is_positive),
    is_admin: toBool(row.is_admin),
    prompt_quality_rating: row.prompt_quality_rating ?? null,
    rejection_reason: row.rejection_reason ?? null,
    rejection_reason_label: row.rejection_reason_label ?? null,
    is_disputed: toBool(row.is_disputed),
    dispute_status: row.dispute_status ?? null,
    dispute_reason: row.dispute_reason ?? null,
    dispute_resolution_reason: row.dispute_resolution_reason ?? null,
    dispute_resolved_at: row.dispute_resolved_at ?? null,
  };
}

function buildExtraWithImportPath(
  row: FeedbackCsvRow,
  projectKey: string,
  envKey: string,
): Prisma.InputJsonValue {
  return {
    ...buildExtra(row),
    import_project_key: projectKey,
    import_env_key: envKey,
  } as Prisma.InputJsonValue;
}

function bodyFromRow(row: FeedbackCsvRow): string {
  return (row.feedback_content ?? "").trim();
}

export type ImportFeedbackResult = {
  filePaths: string[];
  synced: number;
  skipped: number;
  duplicatesDropped: number;
  message: string;
};

export async function ingestFeedbackFromFeedbackDirectory(
  prisma: PrismaClient,
): Promise<ImportFeedbackResult> {
  const filePaths = listFeedbackCsvFiles();
  if (filePaths.length === 0) {
    return {
      filePaths: [],
      synced: 0,
      skipped: 0,
      duplicatesDropped: 0,
      message:
        "No feedback CSVs found. Add `feedback/samples/*.csv` (tracked fixtures) or `feedback/<project>/*.csv` (local exports; not committed — see `.gitignore`).",
    };
  }

  const byId = new Map<
    string,
    { row: FeedbackCsvRow; envKey: string; projectKey: string }
  >();
  let duplicatesDropped = 0;
  for (const filePath of filePaths) {
    const { projectKey, envKey } = projectAndEnvFromFeedbackCsvPath(filePath);
    for (const row of parseFeedbackCsvFile(filePath)) {
      if (byId.has(row.feedback_id)) {
        duplicatesDropped += 1;
      } else {
        byId.set(row.feedback_id, { row, envKey, projectKey });
      }
    }
  }

  let synced = 0;
  let skipped = 0;
  for (const { row, envKey, projectKey } of byId.values()) {
    const body = bodyFromRow(row);
    if (!body) {
      skipped += 1;
      continue;
    }
    const sourceCreated =
      row.created_at && !Number.isNaN(Date.parse(row.created_at))
        ? new Date(row.created_at)
        : null;
    const extra = buildExtraWithImportPath(row, projectKey, envKey);
    const taskId = row.task_id ?? null;
    const taskKey = row.task_key ?? null;
    const createdById = row.created_by_id ?? null;
    const createdByName = row.created_by_name ?? null;
    const createdByEmail = row.created_by_email ?? null;

    // Prisma 7 + SQLite driver adapter: `upsert`/`create` validation may reject scalar
    // `projectKey` / `envKey`. Omit them from the delegate args and set columns via SQL.
    const createData: Prisma.FeedbackUncheckedCreateInput = {
      body,
      sourceFeedbackId: row.feedback_id,
      taskId,
      taskKey,
      createdById,
      createdByName,
      createdByEmail,
      sourceCreated,
      extra,
    };
    const updateData: Prisma.FeedbackUncheckedUpdateInput = {
      body,
      taskId,
      taskKey,
      createdById,
      createdByName,
      createdByEmail,
      sourceCreated,
      extra,
    };

    await prisma.feedback.upsert({
      where: { sourceFeedbackId: row.feedback_id },
      create: createData,
      update: updateData,
    });

    await prisma.$executeRaw`
      UPDATE "Feedback"
      SET "projectKey" = ${projectKey}, "envKey" = ${envKey}
      WHERE "sourceFeedbackId" = ${row.feedback_id}
    `;
    synced += 1;
  }

  let message = `Synced ${synced} feedback row(s) from ${filePaths.length} csv file(s)`;
  if (skipped > 0) message += ` (${skipped} skipped with empty feedback content)`;
  if (duplicatesDropped > 0) {
    message += `. Dropped ${duplicatesDropped} duplicate feedback_id row(s).`;
  }

  return { filePaths, synced, skipped, duplicatesDropped, message };
}
