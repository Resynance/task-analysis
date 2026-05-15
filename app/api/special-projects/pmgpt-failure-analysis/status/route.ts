import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import {
  getPmgptFailureAnalysisRoot,
  getPmgptFailureOverviewStatus,
  listPmgptFailureTasks,
} from "@/lib/pmgpt-failure-analysis";
import { getPmgptFailureRootRelative } from "@/lib/repo-paths";

export const dynamic = "force-dynamic";

export async function GET() {
  const root = getPmgptFailureAnalysisRoot();
  const rootExists = existsSync(root);
  const [tasks, overview] = await Promise.all([
    rootExists ? listPmgptFailureTasks() : Promise.resolve([]),
    rootExists ? getPmgptFailureOverviewStatus() : Promise.resolve({ exists: false, updatedAtIso: null }),
  ]);
  return NextResponse.json({
    rootExists,
    rootRelative: getPmgptFailureRootRelative(),
    overviewReport: {
      basename: "pmgpt-failure-overview.md",
      exists: overview.exists,
      updatedAtIso: overview.updatedAtIso,
    },
    tasks: tasks.map((t) => ({
      taskId: t.taskId,
      runCount: t.runFiles.length,
      runFiles: t.runFiles,
      hasReport: t.reportPath != null,
      reportUpdatedAtIso: t.reportUpdatedAtIso,
    })),
  });
}
