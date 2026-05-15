import { existsSync } from "node:fs";
import { PmgptFailureAnalysisPanel } from "@/components/pmgpt-failure-analysis-panel";
import {
  getPmgptFailureAnalysisRoot,
  getPmgptFailureOverviewStatus,
  listPmgptFailureTasks,
} from "@/lib/pmgpt-failure-analysis";
import { getPmgptFailureRootRelative } from "@/lib/repo-paths";
import { getSpecialProjectUiLabels } from "@/lib/special-project-labels";

export const dynamic = "force-dynamic";

export default async function PmgptFailureAnalysisPage() {
  const sp = getSpecialProjectUiLabels();
  const root = getPmgptFailureAnalysisRoot();
  const rootExists = existsSync(root);
  const [rows, overview] = await Promise.all([
    rootExists ? listPmgptFailureTasks() : Promise.resolve([]),
    rootExists ? getPmgptFailureOverviewStatus() : Promise.resolve({ exists: false, updatedAtIso: null }),
  ]);
  const initialStatus = {
    rootExists,
    rootRelative: getPmgptFailureRootRelative(),
    overviewReport: {
      basename: "pmgpt-failure-overview.md",
      exists: overview.exists,
      updatedAtIso: overview.updatedAtIso,
    },
    tasks: rows.map((t) => ({
      taskId: t.taskId,
      runCount: t.runFiles.length,
      runFiles: t.runFiles,
      hasReport: t.reportPath != null,
      reportUpdatedAtIso: t.reportUpdatedAtIso,
    })),
  };
  return (
    <PmgptFailureAnalysisPanel
      initialStatus={initialStatus}
      projectsEyebrowLabel={sp.projectsEyebrowLabel}
      projectsHubBackLabel={sp.projectsHubBackLabel}
      transcriptFailureDisplayName={sp.transcriptFailureDisplayName}
    />
  );
}
