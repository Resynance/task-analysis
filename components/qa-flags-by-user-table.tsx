"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { QaFlagUserRow } from "@/lib/feedback-qa-flags";
import { userProfileHrefFromQaGroupKey } from "@/lib/users-directory";

type SortKey = "label" | "total" | "flagged" | "escalated" | "bugged" | "rate";

export function QaFlagsByUserTable(props: {
  rows: QaFlagUserRow[];
  emptyMessage: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "rate",
    dir: "desc",
  });

  const sortedRows = useMemo(() => {
    const copy = [...props.rows];
    const dir = sort.dir === "asc" ? 1 : -1;
    copy.sort((a, b) => {
      switch (sort.key) {
        case "label":
          return a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) * dir;
        case "total":
          return (a.total - b.total) * dir;
        case "flagged":
          return (a.flagged - b.flagged) * dir;
        case "escalated":
          return (a.escalated - b.escalated) * dir;
        case "bugged":
          return (a.bugged - b.bugged) * dir;
        case "rate": {
          const va = a.flaggedPercent;
          const vb = b.flaggedPercent;
          if (va == null && vb == null) return 0;
          if (va == null) return 1;
          if (vb == null) return -1;
          return (va - vb) * dir;
        }
      }
    });
    return copy;
  }, [props.rows, sort]);

  function headerClick(key: SortKey) {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: key === "label" ? "asc" : "desc" };
    });
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-800/90 bg-zinc-950/50">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-800/90 text-xs uppercase tracking-wide text-zinc-500">
            <SortTh label="Reviewer" sortKey="label" active={sort} onSort={headerClick} />
            <SortTh label="Total" sortKey="total" active={sort} onSort={headerClick} align="right" />
            <SortTh label="Flagged" sortKey="flagged" active={sort} onSort={headerClick} align="right" />
            <SortTh label="Escalated" sortKey="escalated" active={sort} onSort={headerClick} align="right" />
            <SortTh label="Bugged" sortKey="bugged" active={sort} onSort={headerClick} align="right" />
            <SortTh
              label="Bugged / escalated rate"
              sortKey="rate"
              active={sort}
              onSort={headerClick}
              align="right"
            />
          </tr>
        </thead>
        <tbody>
          {props.rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                {props.emptyMessage}
              </td>
            </tr>
          ) : (
            sortedRows.map((row) => (
              <tr
                key={row.groupKey}
                className="border-b border-zinc-800/60 last:border-0"
              >
                <td className="px-4 py-3">
                  <Link
                    href={userProfileHrefFromQaGroupKey(row.groupKey)}
                    className="text-amber-200/90 underline-offset-2 transition hover:text-amber-100 hover:underline"
                  >
                    {row.label}
                  </Link>
                  <div className="mt-1 text-xs text-zinc-600">
                    {row.flaggedTaskCount.toLocaleString()} distinct flagged tasks
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-[family-name:var(--font-mono)] tabular-nums text-zinc-300">
                  {row.total.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right font-[family-name:var(--font-mono)] tabular-nums text-amber-200/90">
                  {row.flagged.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right font-[family-name:var(--font-mono)] tabular-nums text-sky-200/90">
                  {row.escalated.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right font-[family-name:var(--font-mono)] tabular-nums text-rose-300/90">
                  {row.bugged.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right font-[family-name:var(--font-mono)] tabular-nums text-zinc-200">
                  {row.flaggedPercent != null ? (
                    <>
                      {row.flaggedPercent}%
                      <span className="ml-1 text-zinc-600">
                        ({row.flagged.toLocaleString()}/{row.total.toLocaleString()})
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SortTh(props: {
  label: string;
  sortKey: SortKey;
  active: { key: SortKey; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = props.active.key === props.sortKey;
  const dir = props.active.dir;
  return (
    <th
      scope="col"
      aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-4 py-3 font-medium ${
        props.align === "right" ? "text-right tabular-nums" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => props.onSort(props.sortKey)}
        className={`group inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition hover:bg-zinc-800/80 hover:text-zinc-300 ${
          props.align === "right" ? "w-full justify-end" : ""
        }`}
      >
        <span>{props.label}</span>
        <span
          className={`inline-flex min-w-[1.25rem] justify-center font-[family-name:var(--font-mono)] text-[10px] font-semibold ${
            isActive ? "text-amber-400" : "text-zinc-600 group-hover:text-zinc-500"
          }`}
          aria-hidden
        >
          {isActive ? (dir === "asc" ? "▲" : "▼") : "↑↓"}
        </span>
      </button>
    </th>
  );
}
