export type FeedbackRowForQaFlagMetrics = {
  taskId: string | null;
  taskKey: string | null;
  sourceFeedbackId: string;
  sourceCreated: Date | null;
  createdAt: Date;
  createdById: string | null;
  createdByName: string | null;
  createdByEmail: string | null;
};

export type PromptRowForQaFlagMetrics = {
  sourceId: string | null;
  sourceKey: string | null;
  extra: unknown;
};

export type TaskLifecycleQaFlagClassification = {
  escalated: boolean;
  bugged: boolean;
  lifecycleStatus: string | null;
};

export type QaFlaggedTaskRow = {
  taskKey: string;
  reviewerLabel: string;
  reviewerGroupKey: string;
  escalated: boolean;
  bugged: boolean;
  lifecycleStatus: string | null;
  createdAtIso: string;
};

export type QaFlagUserRow = {
  groupKey: string;
  label: string;
  total: number;
  flagged: number;
  escalated: number;
  bugged: number;
  flaggedTaskCount: number;
  escalatedTaskCount: number;
  buggedTaskCount: number;
  flaggedPercent: number | null;
};

export type QaFlagSnapshot = {
  byUser: QaFlagUserRow[];
  recentFlaggedTasks: QaFlaggedTaskRow[];
  scope: {
    total: number;
    flagged: number;
    escalated: number;
    bugged: number;
    flaggedTaskCount: number;
    escalatedTaskCount: number;
    buggedTaskCount: number;
    flaggedPercent: number | null;
  };
};

function reviewerLabel(row: FeedbackRowForQaFlagMetrics): string {
  return (
    row.createdByName?.trim() ||
    row.createdByEmail?.trim() ||
    row.createdById?.trim() ||
    "Unknown reviewer"
  );
}

function reviewerGroupKey(row: FeedbackRowForQaFlagMetrics): string {
  const id = row.createdById?.trim();
  if (id) return `id:${id}`;
  const email = row.createdByEmail?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const name = row.createdByName?.trim();
  if (name) return `name:${name.toLowerCase()}`;
  return "unknown";
}

function rowTaskKey(row: FeedbackRowForQaFlagMetrics): string {
  return (
    row.taskKey?.trim() ||
    row.taskId?.trim() ||
    row.sourceFeedbackId.trim() ||
    "unknown"
  );
}

function percent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function normalizeKey(raw: string | null | undefined): string | null {
  const t = raw?.trim().toLowerCase();
  return t || null;
}

function getTaskLifecycleStatusFromExtra(extra: unknown): string | null {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return null;
  const raw = (extra as Record<string, unknown>).task_lifecycle_status;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t || null;
}

export function classifyTaskLifecycleQaFlags(
  lifecycleStatus: string | null,
): TaskLifecycleQaFlagClassification {
  const normalized = lifecycleStatus?.trim().toLowerCase() ?? "";
  return {
    escalated: normalized === "escalated-fleet-review",
    bugged: normalized === "bugged",
    lifecycleStatus,
  };
}

function buildTaskFlagIndex(
  prompts: PromptRowForQaFlagMetrics[],
): Map<string, TaskLifecycleQaFlagClassification> {
  const byTask = new Map<string, TaskLifecycleQaFlagClassification>();
  for (const prompt of prompts) {
    const cls = classifyTaskLifecycleQaFlags(
      getTaskLifecycleStatusFromExtra(prompt.extra),
    );
    if (!cls.escalated && !cls.bugged) continue;
    for (const key of [
      normalizeKey(prompt.sourceKey),
      normalizeKey(prompt.sourceId),
    ]) {
      if (key) byTask.set(key, cls);
    }
  }
  return byTask;
}

function classifyFeedbackRowByTaskLifecycle(
  row: FeedbackRowForQaFlagMetrics,
  taskFlags: Map<string, TaskLifecycleQaFlagClassification>,
): TaskLifecycleQaFlagClassification {
  for (const key of [normalizeKey(row.taskKey), normalizeKey(row.taskId)]) {
    if (!key) continue;
    const cls = taskFlags.get(key);
    if (cls) return cls;
  }
  return { escalated: false, bugged: false, lifecycleStatus: null };
}

export function computeQaFlagMetrics(
  rows: FeedbackRowForQaFlagMetrics[],
  prompts: PromptRowForQaFlagMetrics[],
): QaFlagSnapshot {
  type Bucket = {
    label: string;
    total: number;
    flagged: number;
    escalated: number;
    bugged: number;
    flaggedTasks: Set<string>;
    escalatedTasks: Set<string>;
    buggedTasks: Set<string>;
  };

  const byUser = new Map<string, Bucket>();
  const scopeFlaggedTasks = new Set<string>();
  const scopeEscalatedTasks = new Set<string>();
  const scopeBuggedTasks = new Set<string>();
  const recentFlaggedTasks: QaFlaggedTaskRow[] = [];
  const taskFlags = buildTaskFlagIndex(prompts);
  let scopeFlagged = 0;
  let scopeEscalated = 0;
  let scopeBugged = 0;

  for (const row of rows) {
    const groupKey = reviewerGroupKey(row);
    let bucket = byUser.get(groupKey);
    if (!bucket) {
      bucket = {
        label: reviewerLabel(row),
        total: 0,
        flagged: 0,
        escalated: 0,
        bugged: 0,
        flaggedTasks: new Set(),
        escalatedTasks: new Set(),
        buggedTasks: new Set(),
      };
      byUser.set(groupKey, bucket);
    }

    bucket.total += 1;
    const taskKey = rowTaskKey(row);
    const cls = classifyFeedbackRowByTaskLifecycle(row, taskFlags);
    const flagged = cls.escalated || cls.bugged;

    if (flagged) {
      bucket.flagged += 1;
      bucket.flaggedTasks.add(taskKey);
      scopeFlagged += 1;
      scopeFlaggedTasks.add(taskKey);
      recentFlaggedTasks.push({
        taskKey,
        reviewerLabel: bucket.label,
        reviewerGroupKey: groupKey,
        escalated: cls.escalated,
        bugged: cls.bugged,
        lifecycleStatus: cls.lifecycleStatus,
        createdAtIso: (row.sourceCreated ?? row.createdAt).toISOString(),
      });
    }
    if (cls.escalated) {
      bucket.escalated += 1;
      bucket.escalatedTasks.add(taskKey);
      scopeEscalated += 1;
      scopeEscalatedTasks.add(taskKey);
    }
    if (cls.bugged) {
      bucket.bugged += 1;
      bucket.buggedTasks.add(taskKey);
      scopeBugged += 1;
      scopeBuggedTasks.add(taskKey);
    }
  }

  const userRows: QaFlagUserRow[] = [...byUser.entries()].map(
    ([groupKey, b]) => ({
      groupKey,
      label: b.label,
      total: b.total,
      flagged: b.flagged,
      escalated: b.escalated,
      bugged: b.bugged,
      flaggedTaskCount: b.flaggedTasks.size,
      escalatedTaskCount: b.escalatedTasks.size,
      buggedTaskCount: b.buggedTasks.size,
      flaggedPercent: percent(b.flagged, b.total),
    }),
  );

  userRows.sort((a, b) => {
    if ((b.flaggedPercent ?? -1) !== (a.flaggedPercent ?? -1)) {
      return (b.flaggedPercent ?? -1) - (a.flaggedPercent ?? -1);
    }
    if (b.flagged !== a.flagged) return b.flagged - a.flagged;
    return a.label.localeCompare(b.label);
  });

  recentFlaggedTasks.sort(
    (a, b) => Date.parse(b.createdAtIso) - Date.parse(a.createdAtIso),
  );

  return {
    byUser: userRows,
    recentFlaggedTasks: recentFlaggedTasks.slice(0, 50),
    scope: {
      total: rows.length,
      flagged: scopeFlagged,
      escalated: scopeEscalated,
      bugged: scopeBugged,
      flaggedTaskCount: scopeFlaggedTasks.size,
      escalatedTaskCount: scopeEscalatedTasks.size,
      buggedTaskCount: scopeBuggedTasks.size,
      flaggedPercent: percent(scopeFlagged, rows.length),
    },
  };
}
