import type { Metadata } from "next";
import { FlagsDashboard } from "@/components/flags-dashboard";
import { prisma } from "@/lib/prisma";
import {
  computeFlaggedUsers,
  parseMinSampleParam,
  parseThresholdParam,
} from "@/lib/user-flags";
import { loadUserDisplayNames } from "@/lib/users-lookup";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Flags",
};

export default async function FlagsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const threshold = parseThresholdParam(sp.threshold);
  const minScoredSample = parseMinSampleParam(sp.min);
  const nameByUserId = loadUserDisplayNames();

  const snapshot = await computeFlaggedUsers({
    prisma,
    nameByUserId,
    threshold,
    minScoredSample,
  });

  return <FlagsDashboard snapshot={snapshot} />;
}
