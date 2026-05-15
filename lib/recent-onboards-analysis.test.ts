import { describe, expect, it } from "vitest";
import {
  collectRecentOnboardEnvironmentOptions,
  collectRecentOnboardProjectOptions,
  filterRecentOnboardSummariesByFeedbackCount,
  filterRecentOnboardSummariesByEnvironment,
  filterRecentOnboardSummariesByProject,
  parseRecentOnboardEmailsCsv,
  prepareRecentOnboardsList,
  RECENT_ONBOARDS_MIN_FEEDBACK_RECORDS,
  recentOnboardSummariesToCsv,
  type RecentOnboardPromptSummary,
  type RecentOnboardSummary,
} from "./recent-onboards-analysis";

function prompt(
  id: string,
  projectKey: string,
  score: RecentOnboardPromptSummary["score"] = "POOR",
  envKey: string | null = "quickbooks",
): RecentOnboardPromptSummary {
  return {
    id,
    sourceKey: id,
    sourceId: id,
    projectKey,
    envKey,
    taskModality: null,
    score,
    analyzedAtIso: null,
    createdAtIso: "2026-01-01T00:00:00.000Z",
    sourceCreatedIso: null,
    lifecycleStatus: null,
    lifecycleLabel: "No status (legacy)",
  };
}

function summary(
  email: string,
  prompts: RecentOnboardPromptSummary[],
  feedbackCount = RECENT_ONBOARDS_MIN_FEEDBACK_RECORDS,
): RecentOnboardSummary {
  return {
    email,
    rowNumber: 1,
    userId: "user-1",
    userKey: "id:user-1",
    encodedUserKey: "id%3Auser-1",
    displayName: null,
    feedbackCount,
    prompts,
    scores: {
      total: prompts.length,
      scored: prompts.length,
      pending: 0,
      excellent: prompts.filter((p) => p.score === "EXCELLENT").length,
      average: prompts.filter((p) => p.score === "AVERAGE").length,
      poor: prompts.filter((p) => p.score === "POOR").length,
      pruned: prompts.filter((p) => p.score === "PRUNED").length,
      classified: prompts.filter((p) =>
        p.score === "EXCELLENT" || p.score === "AVERAGE" || p.score === "POOR",
      ).length,
      poorPercent: null,
    },
    latestTaskIso: "2026-01-01T00:00:00.000Z",
    projectCounts: [],
    environmentCounts: [],
    lifecycleCounts: [],
  };
}

describe("parseRecentOnboardEmailsCsv", () => {
  it("reads an email header, normalizes emails, and reports duplicates", () => {
    const parsed = parseRecentOnboardEmailsCsv(
      "Email Address,notes\nOne@Example.com,first\none@example.com,dupe\nTWO@example.com,second\n",
    );

    expect(parsed.emails).toEqual([
      { email: "one@example.com", rowNumber: 2 },
      { email: "two@example.com", rowNumber: 4 },
    ]);
    expect(parsed.duplicateEmails).toEqual(["one@example.com"]);
    expect(parsed.invalidRows).toEqual([]);
  });

  it("falls back to scanning row cells when no email header is present", () => {
    const parsed = parseRecentOnboardEmailsCsv(
      "person@example.com,Onboard A\nnot-an-email,Invalid\n",
    );

    expect(parsed.emails).toEqual([
      { email: "person@example.com", rowNumber: 1 },
    ]);
    expect(parsed.invalidRows).toEqual([
      { rowNumber: 2, value: "not-an-email, Invalid" },
    ]);
  });

  it("handles BOM-prefixed headers and exported email-ish column names", () => {
    const parsed = parseRecentOnboardEmailsCsv(
      "\uFEFFUser Email,Name\nmailto:Person@Example.com,Person\n",
    );

    expect(parsed.emails).toEqual([
      { email: "person@example.com", rowNumber: 2 },
    ]);
    expect(parsed.invalidRows).toEqual([]);
  });

  it("reads comma-separated emails when there is no header row", () => {
    const parsed = parseRecentOnboardEmailsCsv(
      "one@example.com,two@example.com\nName,three@example.com\n",
    );

    expect(parsed.emails).toEqual([
      { email: "one@example.com", rowNumber: 1 },
      { email: "two@example.com", rowNumber: 1 },
      { email: "three@example.com", rowNumber: 2 },
    ]);
    expect(parsed.invalidRows).toEqual([]);
  });
});

describe("recent onboard project filters", () => {
  it("collects project options from authored prompts", () => {
    const rows = [
      summary("one@example.com", [
        prompt("a", "tryouts"),
        prompt("b", "tryouts"),
        prompt("c", "openclaw"),
      ]),
    ];

    expect(collectRecentOnboardProjectOptions(rows)).toEqual([
      { value: "tryouts", label: "tryouts", count: 2 },
      { value: "openclaw", label: "openclaw", count: 1 },
    ]);
  });

  it("filters prompts by selected projects and recomputes summary counts", () => {
    const rows = [
      summary("one@example.com", [
        prompt("a", "tryouts", "POOR"),
        prompt("b", "openclaw", "EXCELLENT"),
      ]),
    ];

    const [filtered] = filterRecentOnboardSummariesByProject(rows, {
      mode: "include",
      values: new Set(["tryouts"]),
    });

    expect(filtered?.prompts.map((p) => p.id)).toEqual(["a"]);
    expect(filtered?.scores).toMatchObject({
      total: 1,
      poor: 1,
      classified: 1,
      poorPercent: 100,
    });
    expect(filtered?.projectCounts).toEqual([{ key: "tryouts", count: 1 }]);
  });
});

describe("recent onboard environment filters", () => {
  it("collects environment options from authored prompts", () => {
    const rows = [
      summary("one@example.com", [
        prompt("a", "tryouts", "POOR", "quickbooks"),
        prompt("b", "tryouts", "AVERAGE", "quickbooks"),
        prompt("c", "tryouts", "EXCELLENT", "stripe"),
      ]),
    ];

    expect(collectRecentOnboardEnvironmentOptions(rows)).toEqual([
      { value: "quickbooks", label: "quickbooks", count: 2 },
      { value: "stripe", label: "stripe", count: 1 },
    ]);
  });

  it("filters prompts by selected environments and recomputes summary counts", () => {
    const rows = [
      summary("one@example.com", [
        prompt("a", "tryouts", "POOR", "quickbooks"),
        prompt("b", "tryouts", "EXCELLENT", "stripe"),
      ]),
    ];

    const [filtered] = filterRecentOnboardSummariesByEnvironment(rows, {
      mode: "exclude",
      values: new Set(["quickbooks"]),
    });

    expect(filtered?.prompts.map((p) => p.id)).toEqual(["b"]);
    expect(filtered?.scores).toMatchObject({
      total: 1,
      excellent: 1,
      classified: 1,
      poorPercent: 0,
    });
    expect(filtered?.environmentCounts).toEqual([{ key: "stripe", count: 1 }]);
  });
});

describe("recent onboard feedback count filter", () => {
  it("keeps only summaries with at least the minimum feedback records", () => {
    const rows = [
      summary("low@example.com", [prompt("a", "tryouts")], 9),
      summary("enough@example.com", [prompt("b", "tryouts")], 10),
    ];

    expect(
      filterRecentOnboardSummariesByFeedbackCount(rows).map((row) => row.email),
    ).toEqual(["enough@example.com"]);
  });
});

describe("prepareRecentOnboardsList", () => {
  it("applies task filters, feedback minimums, visibility, and sorting", () => {
    const rows = [
      summary("no-tasks@example.com", [], 12),
      summary("has-tasks@example.com", [
        prompt("a", "tryouts", "POOR", "quickbooks"),
      ], 12),
      summary("wrong-env@example.com", [
        prompt("b", "tryouts", "EXCELLENT", "stripe"),
      ], 12),
      summary("low-feedback@example.com", [
        prompt("c", "tryouts", "AVERAGE", "quickbooks"),
      ], 9),
    ];

    const result = prepareRecentOnboardsList(rows, {
      sortMode: "records_first",
      visibilityMode: "with_tasks",
      projectFilter: { mode: "include", values: new Set(["tryouts"]) },
      environmentFilter: { mode: "include", values: new Set(["quickbooks"]) },
      requireMinFeedback: true,
    });

    expect(result.filteredSummaries.map((row) => row.email)).toEqual([
      "no-tasks@example.com",
      "has-tasks@example.com",
      "wrong-env@example.com",
    ]);
    expect(result.onboardsWithTasks.map((row) => row.email)).toEqual([
      "has-tasks@example.com",
    ]);
    expect(result.sortedSummaries.map((row) => row.email)).toEqual([
      "has-tasks@example.com",
    ]);
  });
});

describe("recentOnboardSummariesToCsv", () => {
  it("exports summary rows as csv", () => {
    const csv = recentOnboardSummariesToCsv([
      {
        ...summary("one@example.com", [prompt("a", "tryouts")], 12),
        displayName: "One Person",
        projectCounts: [{ key: "tryouts", count: 1 }],
        environmentCounts: [{ key: "quickbooks", count: 1 }],
        lifecycleCounts: [{ key: "No status (legacy)", count: 1 }],
      },
    ]);

    expect(csv.split("\n").slice(0, 2)).toEqual([
      "row_number,email,display_name,user_id,user_profile_path,feedback_count,task_count,scored_count,pending_count,excellent_count,average_count,poor_count,pruned_count,classified_count,poor_percent,latest_task_iso,projects,environments,lifecycle",
      "1,one@example.com,One Person,user-1,/users/id%3Auser-1,12,1,1,0,0,0,1,0,1,,2026-01-01T00:00:00.000Z,tryouts: 1,quickbooks: 1,No status (legacy): 1",
    ]);
  });
});
