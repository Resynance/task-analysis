import { OpenclawAnalysisPanel } from "@/components/openclaw-analysis-panel";
import { SpecialProjectsSubnav } from "@/components/special-projects-subnav";
import { getTraceExportsRootRelative } from "@/lib/repo-paths";
import { getSpecialProjectUiLabels } from "@/lib/special-project-labels";

import "./openclaw-audit-print.css";

export const dynamic = "force-dynamic";

export default function SpecialProjectsOpenclawAnalyzePage() {
  const sp = getSpecialProjectUiLabels();
  return (
    <>
      <SpecialProjectsSubnav active="openclaw-analyze" />
      <OpenclawAnalysisPanel
        traceExportsPathDisplay={getTraceExportsRootRelative()}
        traceBreadcrumbLabel={sp.traceBreadcrumbLabel}
        traceOverviewBackLabel={sp.traceOverviewBackLabel}
      />
    </>
  );
}
