"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { QA_MIN_REVIEWER_RECORDS } from "@/lib/qa-reviewer-record-filter";

export function QaReviewerMinRecordsToggle(props: {
  enabled: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function apply(nextEnabled: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextEnabled) {
      params.set("minQaRecords", String(QA_MIN_REVIEWER_RECORDS));
    } else {
      params.delete("minQaRecords");
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-400">
      <input
        type="checkbox"
        checked={props.enabled}
        onChange={(e) => apply(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 accent-amber-500"
      />
      <span>
        Exclude reviewers with fewer than{" "}
        <span className="font-medium text-zinc-300">{QA_MIN_REVIEWER_RECORDS}</span>{" "}
        records
      </span>
    </label>
  );
}
