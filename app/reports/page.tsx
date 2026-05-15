import Link from "next/link";

export default function ReportsHomePage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-5 py-14">
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          Reports
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
          Task writer reports
        </h1>
        <p className="mt-3 text-zinc-400">
          Generate environment-scoped reports to improve prompt quality and
          diagnose recurring execution failures.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/reports/insights"
          className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5 transition hover:border-amber-700/70"
        >
          <h2 className="text-lg font-semibold text-zinc-100">Insights</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Coaching-oriented rubric report from scored prompts.
          </p>
        </Link>

        <Link
          href="/reports/dataset-qa"
          className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5 transition hover:border-amber-700/70"
        >
          <h2 className="text-lg font-semibold text-zinc-100">Dataset Q&amp;A</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Ask the LLM custom questions about a scoped slice of your tasks.
          </p>
        </Link>

        <Link
          href="/reports/pruned-analysis"
          className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5 transition hover:border-amber-700/70"
        >
          <h2 className="text-lg font-semibold text-zinc-100">Pruned analysis</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Failure postmortem across prompts listed in pruned task sets.
          </p>
        </Link>

        <Link
          href="/reports/combined"
          className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5 transition hover:border-amber-700/70"
        >
          <h2 className="text-lg font-semibold text-zinc-100">Combined</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Comprehensive report that combines Insights + Pruned Analysis.
          </p>
        </Link>
      </section>
    </div>
  );
}
