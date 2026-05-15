import { describe, expect, it } from "vitest";

import {
  LIBRARY_DEFAULT_PAGE_SIZE,
  LIBRARY_MAX_PAGE_SIZE,
  parseLibraryPaginationParams,
} from "./library-pagination";

describe("parseLibraryPaginationParams", () => {
  it("defaults page to 1 and perPage when missing or invalid", () => {
    expect(parseLibraryPaginationParams({})).toEqual({
      page: 1,
      perPage: LIBRARY_DEFAULT_PAGE_SIZE,
    });
    expect(parseLibraryPaginationParams({ page: "0", perPage: "x" })).toEqual({
      page: 1,
      perPage: LIBRARY_DEFAULT_PAGE_SIZE,
    });
  });

  it("parses valid integers and floors floats", () => {
    expect(parseLibraryPaginationParams({ page: "3", perPage: "25" })).toEqual({
      page: 3,
      perPage: 25,
    });
    expect(parseLibraryPaginationParams({ page: "2.9", perPage: "10.2" })).toEqual({
      page: 2,
      perPage: 10,
    });
  });

  it("caps perPage at LIBRARY_MAX_PAGE_SIZE", () => {
    expect(parseLibraryPaginationParams({ page: "1", perPage: "500" })).toEqual({
      page: 1,
      perPage: LIBRARY_MAX_PAGE_SIZE,
    });
  });

  it("ignores array query values", () => {
    expect(
      parseLibraryPaginationParams({ page: ["1", "2"], perPage: ["10"] }),
    ).toEqual({ page: 1, perPage: LIBRARY_DEFAULT_PAGE_SIZE });
  });
});
