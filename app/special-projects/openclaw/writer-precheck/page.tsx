import { OpenclawWriterPrecheckPanel } from "@/components/openclaw-writer-precheck-panel";
import { SpecialProjectsSubnav } from "@/components/special-projects-subnav";
import { getTraceExportsRootRelative } from "@/lib/repo-paths";
import { prisma } from "@/lib/prisma";
import { getSpecialProjectUiLabels } from "@/lib/special-project-labels";

export const dynamic = "force-dynamic";

export default async function OpenclawWriterPrecheckPage() {
  const sp = getSpecialProjectUiLabels();
  const [guidelines, worlds] = await Promise.all([
    prisma.guideline.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.openclawWorld.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <>
      <SpecialProjectsSubnav active="openclaw-writer-precheck" />
      <OpenclawWriterPrecheckPanel
        guidelines={guidelines}
        worlds={worlds}
        traceExportsPathDisplay={getTraceExportsRootRelative()}
        writerPrecheckKicker={sp.writerPrecheckKicker}
        traceOverviewLinkText={sp.traceOverviewLinkText}
      />
    </>
  );
}
