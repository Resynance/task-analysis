import { describe, expect, it } from "vitest";

import { filterRowsByEnv } from "./filter-prompts-by-env";

describe("filterRowsByEnv", () => {
  it("returns all rows for all filter", () => {
    const rows = [{ id: 1, envKey: "x" }];
    expect(filterRowsByEnv(rows, "all")).toEqual(rows);
  });

  it("filters by canonical env", () => {
    const rows = [
      { id: 1, envKey: "something quickbooks" },
      { id: 2, envKey: "harbor" },
    ];
    expect(filterRowsByEnv(rows, "quickbooks")).toEqual([{ id: 1, envKey: "something quickbooks" }]);
  });
});
