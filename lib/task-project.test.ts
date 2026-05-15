import { describe, expect, it } from "vitest";

import {
  UNASSIGNED_PROJECT_QUERY,
  buildProjectFilterOptionsFromRows,
  getProjectFilterShortLabel,
  isTryoutsImportProject,
  parseProjectFilter,
  projectFilterInList,
  projectFilterToDbKey,
  projectMatchesFilter,
  sameProjectFilter,
  serializeProjectQueryValue,
} from "./task-project";

describe("parseProjectFilter", () => {
  it('returns "all" for empty, all, or missing', () => {
    expect(parseProjectFilter({})).toBe("all");
    expect(parseProjectFilter({ project: "" })).toBe("all");
    expect(parseProjectFilter({ project: "all" })).toBe("all");
    expect(parseProjectFilter({ project: "  " })).toBe("all");
  });

  it("returns _unassigned sentinel", () => {
    expect(parseProjectFilter({ project: UNASSIGNED_PROJECT_QUERY })).toBe(
      UNASSIGNED_PROJECT_QUERY,
    );
  });

  it("lowercases concrete project slugs", () => {
    expect(parseProjectFilter({ project: "Tryouts" })).toBe("tryouts");
  });
});

describe("serializeProjectQueryValue", () => {
  it("round-trips all and concrete filters", () => {
    expect(serializeProjectQueryValue("all")).toBe("all");
    expect(serializeProjectQueryValue("foo")).toBe("foo");
  });
});

describe("projectMatchesFilter", () => {
  it("matches all", () => {
    expect(projectMatchesFilter({ projectKey: null }, "all")).toBe(true);
  });

  it("matches unassigned when key missing or blank", () => {
    expect(projectMatchesFilter({}, UNASSIGNED_PROJECT_QUERY)).toBe(true);
    expect(projectMatchesFilter({ projectKey: "  " }, UNASSIGNED_PROJECT_QUERY)).toBe(
      true,
    );
    expect(projectMatchesFilter({ projectKey: "x" }, UNASSIGNED_PROJECT_QUERY)).toBe(
      false,
    );
  });

  it("matches slug case-insensitively", () => {
    expect(projectMatchesFilter({ projectKey: "Foo" }, "foo")).toBe(true);
  });
});

describe("isTryoutsImportProject", () => {
  it("detects tryouts slug", () => {
    expect(isTryoutsImportProject("tryouts")).toBe(true);
    expect(isTryoutsImportProject("TRYOUTS")).toBe(true);
    expect(isTryoutsImportProject("other")).toBe(false);
    expect(isTryoutsImportProject(null)).toBe(false);
  });
});

describe("projectFilterToDbKey", () => {
  it("maps filters to stored project key", () => {
    expect(projectFilterToDbKey("all")).toBe("");
    expect(projectFilterToDbKey(UNASSIGNED_PROJECT_QUERY)).toBe("");
    expect(projectFilterToDbKey("harbor")).toBe("harbor");
  });
});

describe("getProjectFilterShortLabel", () => {
  it("returns human labels", () => {
    expect(getProjectFilterShortLabel("all")).toBe("All projects");
    expect(getProjectFilterShortLabel(UNASSIGNED_PROJECT_QUERY)).toBe(
      "No project (legacy)",
    );
    expect(getProjectFilterShortLabel("x")).toBe("x");
  });
});

describe("sameProjectFilter / projectFilterInList", () => {
  it("compares filters by equality", () => {
    expect(sameProjectFilter("all", "all")).toBe(true);
    expect(sameProjectFilter("a", "b")).toBe(false);
  });

  it("finds filter in option list", () => {
    expect(projectFilterInList(["all", "x"], "x")).toBe(true);
    expect(projectFilterInList(["all"], "x")).toBe(false);
  });
});

describe("buildProjectFilterOptionsFromRows", () => {
  it("returns all, optional unassigned, then sorted slugs", () => {
    expect(
      buildProjectFilterOptionsFromRows([
        { projectKey: "beta" },
        { projectKey: null },
        { projectKey: "alpha" },
        { projectKey: "beta" },
      ]),
    ).toEqual(["all", UNASSIGNED_PROJECT_QUERY, "alpha", "beta"]);
  });

  it("omits unassigned when every row has a key", () => {
    expect(buildProjectFilterOptionsFromRows([{ projectKey: "z" }])).toEqual([
      "all",
      "z",
    ]);
  });
});
