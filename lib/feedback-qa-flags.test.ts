import { describe, expect, it } from "vitest";
import {
  classifyTaskLifecycleQaFlags,
  computeQaFlagMetrics,
  type FeedbackRowForQaFlagMetrics,
} from "./feedback-qa-flags";

const baseRow = {
  taskId: null,
  taskKey: null,
  sourceFeedbackId: "fb-1",
  sourceCreated: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  createdById: null,
  createdByName: "QA One",
  createdByEmail: null,
} satisfies FeedbackRowForQaFlagMetrics;

describe("classifyTaskLifecycleQaFlags", () => {
  it("detects bugged and escalated lifecycle states", () => {
    expect(classifyTaskLifecycleQaFlags("bugged")).toEqual({
      escalated: false,
      bugged: true,
      lifecycleStatus: "bugged",
    });
    expect(classifyTaskLifecycleQaFlags("escalated-fleet-review")).toEqual({
      escalated: true,
      bugged: false,
      lifecycleStatus: "escalated-fleet-review",
    });
  });

  it("does not flag other lifecycle states", () => {
    expect(classifyTaskLifecycleQaFlags("production")).toEqual({
      escalated: false,
      bugged: false,
      lifecycleStatus: "production",
    });
  });
});

describe("computeQaFlagMetrics", () => {
  it("groups lifecycle-flagged task feedback by reviewer and distinct task", () => {
    const rows: FeedbackRowForQaFlagMetrics[] = [
      {
        ...baseRow,
        taskKey: "task_a",
      },
      {
        ...baseRow,
        sourceFeedbackId: "fb-2",
        taskKey: "task_a",
      },
      {
        ...baseRow,
        sourceFeedbackId: "fb-3",
        taskKey: "task_b",
      },
    ];

    const snapshot = computeQaFlagMetrics(rows, [
      {
        sourceId: "id-a",
        sourceKey: "task_a",
        extra: { task_lifecycle_status: "bugged" },
      },
      {
        sourceId: "id-b",
        sourceKey: "task_b",
        extra: { task_lifecycle_status: "production" },
      },
    ]);

    expect(snapshot.scope).toMatchObject({
      total: 3,
      flagged: 2,
      escalated: 0,
      bugged: 2,
      flaggedTaskCount: 1,
      escalatedTaskCount: 0,
      buggedTaskCount: 1,
      flaggedPercent: 66.7,
    });
    expect(snapshot.byUser[0]).toMatchObject({
      label: "QA One",
      total: 3,
      flagged: 2,
      flaggedTaskCount: 1,
    });
  });
});
