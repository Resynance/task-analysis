import { NextResponse } from "next/server";
import { coachingInsightGuidelineScopeKey } from "@/lib/coaching-insight-keys";
import {
  safeParseStoredCoachingInsightReport,
} from "@/lib/coaching-insight-report";
import { prisma } from "@/lib/prisma";
import { parseGuidelineIdsParam } from "@/lib/guideline-query";
import { parseEnvFilter, serializeEnvQueryValue } from "@/lib/task-environment";
import {
  parseProjectFilter,
  projectFilterToDbKey,
} from "@/lib/task-project";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sp = Object.fromEntries(searchParams.entries());
  const projectFilter = parseProjectFilter(sp);
  const envFilter = parseEnvFilter(sp);

  if (projectFilter === "all") {
    return NextResponse.json(
      { error: "Pass a specific project query parameter." },
      { status: 400 },
    );
  }

  if (envFilter === "all") {
    return NextResponse.json(
      { error: "Pass a specific env query parameter." },
      { status: 400 },
    );
  }

  const guidelineRows = await prisma.guideline.findMany({ select: { id: true } });
  const validIds = new Set(guidelineRows.map((g) => g.id));
  const guidelineFilterIds = parseGuidelineIdsParam(sp, validIds);

  const projectKey = projectFilterToDbKey(projectFilter);
  const envKey = serializeEnvQueryValue(envFilter);
  const guidelineScopeKey = coachingInsightGuidelineScopeKey(guidelineFilterIds);

  const row = await prisma.coachingInsight.findUnique({
    where: {
      projectKey_envKey_guidelineScopeKey: {
        projectKey,
        envKey,
        guidelineScopeKey,
      },
    },
  });

  if (!row) {
    return NextResponse.json({
      report: null,
      summary: null,
      savedAt: null,
    });
  }

  const report = safeParseStoredCoachingInsightReport(row.reportJson);
  return NextResponse.json({
    report,
    summary: row.summary,
    savedAt: row.updatedAt.toISOString(),
  });
}
