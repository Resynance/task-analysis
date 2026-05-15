import type { PromptRow } from "@/components/prompt-dashboard";
import { getCreatorLabelFromExtra } from "@/lib/explore/creator-from-extra";
import { parsePromptAnalysisClarification } from "@/lib/prompt-analysis-clarification";
import {
  getTaskLifecycleStatusFromExtra,
  taskLifecycleEligibleForLlmAnalysis,
} from "@/lib/task-lifecycle";

/**
 * Convert a Prisma prompt row (with guideline join) into a client-safe {@link PromptRow}
 * without JSON deep-clone — avoids duplicating large strings in memory.
 */
export function prismaPromptToPromptRow(
  row: {
  id: string;
  body: string;
  guidelineId: string;
  score: PromptRow["score"];
  rationale: string | null;
  analyzedAt: Date | null;
  createdAt: Date;
  sourceKey?: string | null;
  sourceId?: string | null;
  projectKey?: string | null;
  envKey?: string | null;
  taskModality?: string | null;
  sourceCreated?: Date | null;
  extra?: unknown;
  analysisClarification?: unknown;
  guideline: { id: string; name: string };
  },
  nameByUserId?: Map<string, string>,
): PromptRow {
  return {
    id: row.id,
    body: row.body,
    guidelineId: row.guidelineId,
    score: row.score ?? null,
    rationale: row.rationale ?? null,
    analyzedAt: row.analyzedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    guideline: row.guideline,
    sourceKey: row.sourceKey ?? undefined,
    sourceId: row.sourceId ?? undefined,
    projectKey: row.projectKey ?? undefined,
    envKey: row.envKey ?? undefined,
    taskModality: row.taskModality ?? undefined,
    sourceCreated: row.sourceCreated?.toISOString() ?? undefined,
    creatorLabel: getCreatorLabelFromExtra(row.extra, nameByUserId),
    analysisClarification: parsePromptAnalysisClarification(
      row.analysisClarification,
    ),
    eligibleForLlmAnalysis: taskLifecycleEligibleForLlmAnalysis(row.extra),
    taskLifecycleStatus: getTaskLifecycleStatusFromExtra(row.extra) ?? undefined,
  };
}
