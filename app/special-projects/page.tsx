import Link from "next/link";
import { getPmgptFailureRootRelative } from "@/lib/repo-paths";
import { getSpecialProjectUiLabels } from "@/lib/special-project-labels";

export default function SpecialProjectsHomePage() {
  const sp = getSpecialProjectUiLabels();
  const pmRoot = getPmgptFailureRootRelative();
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-5 py-14">
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          {sp.projectsEyebrowLabel}
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
          {sp.projectsPageTitle}
        </h1>
        <p className="mt-3 text-zinc-400">{sp.projectsPageSubtitle}</p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <Link
          href="/special-projects/openclaw"
          className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5 transition hover:border-amber-700/70"
        >
          <h2 className="text-lg font-semibold text-zinc-100">
            {sp.traceProjectDisplayName}
          </h2>
          <p className="mt-2 text-sm text-zinc-400">{sp.traceProjectHubDescription}</p>
        </Link>

        <Link
          href="/special-projects/pmgpt-failure-analysis"
          className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5 transition hover:border-amber-700/70"
        >
          <h2 className="text-lg font-semibold text-zinc-100">
            {sp.transcriptFailureDisplayName}
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            {sp.transcriptFailureHubDescription}{" "}
            <code className="text-zinc-500">{pmRoot}</code>.
          </p>
        </Link>

        <Link
          href="/special-projects/recent-onboards"
          className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5 transition hover:border-amber-700/70"
        >
          <h2 className="text-lg font-semibold text-zinc-100">
            Recent onboard task quality
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Cross-reference a local CSV of onboard emails with imported task authorship and
            prompt quality scores.
          </p>
        </Link>

        <Link
          href="/special-projects/user-task-authenticity"
          className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5 transition hover:border-amber-700/70"
        >
          <h2 className="text-lg font-semibold text-zinc-100">
            User task authenticity review
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Review a local JSON of one user&apos;s tasks for AI-generated, templated,
            similar, or translation-like signals before submission.
          </p>
        </Link>
      </section>
    </div>
  );
}
