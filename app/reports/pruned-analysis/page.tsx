import { PrunedAnalysisPanel } from "@/components/pruned-analysis-panel";
import { ReportsSubnav } from "@/components/reports-subnav";
import { filterGuidelinesForUi } from "@/lib/guideline-scope";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ReportsPrunedAnalysisPage() {
  const [guidelines, scopeRows] = await Promise.all([
    prisma.guideline.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    }),
    prisma.prompt.findMany({ select: { envKey: true, projectKey: true } }),
  ]);

  return (
    <>
      <ReportsSubnav active="pruned" />
      <PrunedAnalysisPanel
        guidelines={filterGuidelinesForUi(guidelines)}
        scopeRows={scopeRows}
      />
    </>
  );
}
