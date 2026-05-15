import { redirect } from "next/navigation";

export default async function LegacyPrunedAnalysisRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const p = new URLSearchParams();
  for (const [key, val] of Object.entries(sp)) {
    if (typeof val === "string") p.set(key, val);
    else if (Array.isArray(val)) {
      for (const v of val) {
        if (typeof v === "string") p.append(key, v);
      }
    }
  }
  const qs = p.toString();
  redirect(qs ? `/reports/pruned-analysis?${qs}` : "/reports/pruned-analysis");
}
