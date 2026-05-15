import type { CoachingInsightReport } from "@/lib/coaching-insight-report";

type Props = {
  report: CoachingInsightReport;
  /** Saved-at line at bottom of report (screen only; hidden when printing) */
  generatedLine?: string;
};

export function CoachingInsightReportView({ report, generatedLine }: Props) {
  return (
    <div className="insights-report-print mx-auto max-w-4xl bg-white text-zinc-900 shadow-xl ring-1 ring-zinc-200">
      <header className="bg-[#1a365d] px-8 py-7 text-white print:bg-[#1a365d]">
        <h1 className="font-[family-name:var(--font-sans)] text-3xl font-bold tracking-tight">
          {report.environmentLabel}
        </h1>
      </header>

      <div className="px-8 pb-10 pt-10">
        <section className="mb-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Section 1
          </p>
          <h2 className="mt-1 font-[family-name:var(--font-sans)] text-2xl font-bold tracking-tight text-zinc-900">
            What separates strong tasks from weak ones
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-px bg-zinc-300 sm:grid-cols-2">
            {report.section1Items.map((item, i) => (
              <div
                key={`${item.title}-${i}`}
                className="min-h-[100px] bg-white p-5"
              >
                <h3 className="font-semibold text-zinc-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-700">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Section 2
          </p>
          <h2 className="mt-1 font-[family-name:var(--font-sans)] text-2xl font-bold tracking-tight text-zinc-900">
            Common failure modes to avoid
          </h2>
          <ul className="mt-6 flex flex-col gap-4">
            {report.section2Items.map((item, i) => (
              <li
                key={`${item.title}-${i}`}
                className="flex gap-4 border border-zinc-300 bg-white p-5"
              >
                <span
                  className="shrink-0 pt-0.5 text-lg font-bold text-red-600"
                  aria-hidden
                >
                  ×
                </span>
                <div>
                  <h3 className="font-semibold text-zinc-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-700">
                    {item.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Section 3
          </p>
          <h2 className="mt-1 font-[family-name:var(--font-sans)] text-2xl font-bold tracking-tight text-zinc-900">
            Task authoring improvements
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-px bg-zinc-300 sm:grid-cols-2">
            {report.section3Items.map((item, i) => (
              <div
                key={`${item.title}-${i}`}
                className="min-h-[100px] border-l-4 border-l-[#2563eb] bg-white p-5"
              >
                <h3 className="font-semibold text-zinc-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-700">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {report.excellentExamples && report.excellentExamples.length === 3 ? (
          <section className="mt-12 border-t border-zinc-200 pt-10">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Excellent examples
            </p>
            <h2 className="mt-1 font-[family-name:var(--font-sans)] text-2xl font-bold tracking-tight text-zinc-900">
              Three excellent prompts
            </h2>
            <ol className="mt-6 flex flex-col gap-8">
              {report.excellentExamples.map((ex, i) => (
                <li key={i} className="flex flex-col gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Example {i + 1}
                  </span>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap print:max-h-none print:overflow-visible rounded-lg border border-zinc-300 bg-zinc-50 p-4 font-[family-name:var(--font-mono)] text-[13px] leading-relaxed text-zinc-900">
                    {ex.prompt}
                  </pre>
                  <div className="border-l-4 border-l-emerald-600 pl-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                      What makes this excellent
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-700">
                      {ex.whyExcellent}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {generatedLine ? (
          <p className="mt-10 border-t border-zinc-200 pt-4 text-xs text-zinc-500 print:hidden">
            {generatedLine}
          </p>
        ) : null}
      </div>
    </div>
  );
}
