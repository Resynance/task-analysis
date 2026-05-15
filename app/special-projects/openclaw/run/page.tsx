import { OpenclawSpecialProjectPanel } from "@/components/openclaw-special-project-panel";
import { SpecialProjectsSubnav } from "@/components/special-projects-subnav";
import { getTraceExportsRootRelative } from "@/lib/repo-paths";
import { getSpecialProjectUiLabels } from "@/lib/special-project-labels";

export const dynamic = "force-dynamic";

export default function SpecialProjectsOpenclawRunPage() {
  const sp = getSpecialProjectUiLabels();
  return (
    <>
      <SpecialProjectsSubnav active="openclaw-run" />
      <OpenclawSpecialProjectPanel
        traceExportsPathDisplay={getTraceExportsRootRelative()}
        traceBreadcrumbLabel={sp.traceBreadcrumbLabel}
        traceOverviewWorldsBackLabel={sp.traceOverviewWorldsBackLabel}
      />
    </>
  );
}
