import type { PromptRow } from "@/components/prompt-dashboard";

export type SortKey = "created" | "rating";
export type SortOrder = "asc" | "desc";

export type PromptMetaSortRow = {
  id: string;
  score: PromptRow["score"];
  createdAt: Date;
};

function ratingRank(score: PromptRow["score"]): number {
  switch (score) {
    case "EXCELLENT":
      return 4;
    case "AVERAGE":
      return 3;
    case "POOR":
      return 2;
    case "PRUNED":
      return 1;
    default:
      return 0;
  }
}

/** Sort lightweight meta rows (no prompt body loaded). */
export function sortPromptMetaRows(
  rows: PromptMetaSortRow[],
  sort: SortKey,
  order: SortOrder,
): PromptMetaSortRow[] {
  const out = [...rows];
  const dir = order === "asc" ? 1 : -1;

  out.sort((a, b) => {
    if (sort === "rating") {
      const cmp = ratingRank(a.score) - ratingRank(b.score);
      if (cmp !== 0) return cmp * dir;
    } else {
      const cmp = a.createdAt.getTime() - b.createdAt.getTime();
      if (cmp !== 0) return cmp * dir;
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return out;
}

export function sortPromptRows(
  rows: PromptRow[],
  sort: SortKey,
  order: SortOrder,
): PromptRow[] {
  const out = [...rows];
  const dir = order === "asc" ? 1 : -1;

  out.sort((a, b) => {
    if (sort === "rating") {
      const cmp = ratingRank(a.score) - ratingRank(b.score);
      if (cmp !== 0) return cmp * dir;
    } else {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      const cmp = ta - tb;
      if (cmp !== 0) return cmp * dir;
    }
    // Stable tie-break: newer first
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return out;
}

export function parseSortParams(
  raw: Record<string, string | string[] | undefined>,
): { sort: SortKey; order: SortOrder } {
  const sortRaw = typeof raw.sort === "string" ? raw.sort : "";
  const orderRaw = typeof raw.order === "string" ? raw.order : "";

  const sort: SortKey = sortRaw === "rating" ? "rating" : "created";
  const order: SortOrder = orderRaw === "asc" ? "asc" : "desc";

  return { sort, order };
}
