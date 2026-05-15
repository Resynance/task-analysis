import { describe, expect, it } from "vitest";

import { qaFeedbackReviewerMetricsToCsv } from "./metrics-feedback-export";

describe("qaFeedbackReviewerMetricsToCsv", () => {
  it("exports rejection and flag metrics by reviewer", () => {
    const csv = qaFeedbackReviewerMetricsToCsv({
      qaRejection: {
        byUser: [
          {
            groupKey: "email:one@example.com",
            label: "One, Reviewer",
            total: 12,
            approved: 8,
            rejected: 2,
            unknown: 2,
            classifiedRejectionPercent: 20,
          },
        ],
        scope: {
          total: 12,
          approved: 8,
          rejected: 2,
          unknown: 2,
          classifiedRejectionPercent: 20,
        },
      },
      qaFlags: {
        byUser: [
          {
            groupKey: "email:one@example.com",
            label: "One, Reviewer",
            total: 12,
            flagged: 3,
            escalated: 1,
            bugged: 2,
            flaggedTaskCount: 3,
            escalatedTaskCount: 1,
            buggedTaskCount: 2,
            flaggedPercent: 25,
          },
        ],
        recentFlaggedTasks: [],
        scope: {
          total: 12,
          flagged: 3,
          escalated: 1,
          bugged: 2,
          flaggedTaskCount: 3,
          escalatedTaskCount: 1,
          buggedTaskCount: 2,
          flaggedPercent: 25,
        },
      },
    });

    expect(csv.split("\n").slice(0, 2)).toEqual([
      "reviewer,reviewer_group_key,total_feedback,approved,rejected,unknown,rejection_rate_percent,flagged,escalated,bugged,flagged_rate_percent,flagged_task_count,escalated_task_count,bugged_task_count",
      '"One, Reviewer",email:one@example.com,12,8,2,2,20,3,1,2,25,3,1,2',
    ]);
  });
});
