import { describe, expect, it } from "vitest";

import { UNASSIGNED_PROJECT_QUERY } from "./task-project";
import { filterRowsByProject } from "./filter-prompts-by-project";

describe("filterRowsByProject", () => {
  it("returns all rows when filter is all", () => {
    const rows = [{ id: 1, projectKey: "a" }];
    expect(filterRowsByProject(rows, "all")).toEqual(rows);
  });

  it("filters by slug and unassigned", () => {
    const rows = [
      { id: 1, projectKey: "Alpha" },
      { id: 2, projectKey: null },
      { id: 3, projectKey: "beta" },
    ];
    expect(filterRowsByProject(rows, "alpha")).toEqual([{ id: 1, projectKey: "Alpha" }]);
    expect(filterRowsByProject(rows, UNASSIGNED_PROJECT_QUERY)).toEqual([
      { id: 2, projectKey: null },
    ]);
  });
});
