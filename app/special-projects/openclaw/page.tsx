import Link from "next/link";
import { OpenclawWorldsPanel } from "@/components/openclaw-worlds-panel";
import { SpecialProjectsSubnav } from "@/components/special-projects-subnav";
import { getTraceExportsRootRelative } from "@/lib/repo-paths";
import { getSpecialProjectUiLabels } from "@/lib/special-project-labels";

export const dynamic = "force-dynamic";

export default function SpecialProjectsOpenclawPage() {
  const sp = getSpecialProjectUiLabels();
  const traceExportsPath = getTraceExportsRootRelative();
  return (
    <>
      <SpecialProjectsSubnav active="openclaw" />
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-5 py-10">
        <header className="border-b border-zinc-800/80 pb-8">
          <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
            {sp.projectsEyebrowLabel}
          </p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-zinc-50">
            {sp.traceProjectDisplayName}
          </h1>
          <p className="mt-3 max-w-3xl text-zinc-400">
            {sp.traceProjectHubDescription} Files are written under{" "}
            <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">
              {traceExportsPath}/
            </code>
            . Portal IDs can live in{" "}
            <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">
              openclaw_portal_defaults.json
            </code>
            ; run the scripts from Run export with minimal form input.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/special-projects/openclaw/run"
              className="inline-flex rounded-xl border border-amber-700/80 bg-amber-900/25 px-5 py-2.5 text-sm font-medium text-amber-100 transition hover:bg-amber-900/40"
            >
              Run export →
            </Link>
            <Link
              href="/special-projects/openclaw/analyze"
              className="inline-flex rounded-xl border border-zinc-600 bg-zinc-900/60 px-5 py-2.5 text-sm font-medium text-zinc-100 transition hover:border-amber-700/50 hover:bg-zinc-800/80"
            >
              Run analysis →
            </Link>
            <Link
              href="/special-projects/openclaw/writer-precheck"
              className="inline-flex rounded-xl border border-zinc-600 bg-zinc-900/60 px-5 py-2.5 text-sm font-medium text-zinc-100 transition hover:border-amber-700/50 hover:bg-zinc-800/80"
            >
              Writer pre-check →
            </Link>
          </div>
        </header>

        <OpenclawWorldsPanel />
      </div>
    </>
  );
}
