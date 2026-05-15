"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { QaRejectionWindow } from "@/lib/qa-rejection-window";

const OPTIONS: { value: QaRejectionWindow; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Past 7 days" },
  { value: "30d", label: "Past 30 days" },
];

export function QaRejectionWindowToolbar(props: {
  /** Server-resolved window for SSR/hydration alignment */
  window: QaRejectionWindow;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function apply(next: QaRejectionWindow) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") {
      params.delete("qaWindow");
    } else {
      params.set("qaWindow", next);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-sm text-zinc-500">QA rejection window</span>
      <select
        value={props.window}
        onChange={(e) => apply(e.target.value as QaRejectionWindow)}
        className="min-w-[12rem] rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-700/80"
        aria-label="Time range for QA rejection metrics"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
