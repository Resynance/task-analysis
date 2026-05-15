import Link from "next/link";

const AREAS = [
  {
    href: "/configuration/llm",
    eyebrow: "Modeling",
    title: "LLM target",
    description:
      "Choose OpenRouter, a hosted OpenAI-compatible API, or local LM Studio; set model, endpoint, and API keys.",
  },
  {
    href: "/configuration/openrouter-audit",
    eyebrow: "Observability",
    title: "OpenRouter audit log",
    description:
      "Review in-app OpenRouter chat calls: timestamp, caller, model, tokens, and billed cost when reported.",
  },
  {
    href: "/configuration/guidelines",
    eyebrow: "Rubrics",
    title: "Guideline sets",
    description:
      "Manage the scoring rubrics used to evaluate prompts and compare task quality.",
  },
  {
    href: "/configuration/ingest-data",
    eyebrow: "Data",
    title: "Ingest data",
    description:
      "Load prompt JSON exports and feedback CSV files from disk into local libraries.",
  },
] as const;

export default function ConfigurationPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-5 py-14">
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          Configuration
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
          Settings hub
        </h1>
        <p className="mt-3 max-w-3xl text-lg text-zinc-400">
          Configure core app behavior from one place. Use these sections for
          model and rubric setup today, with room to add more configurable areas
          over time.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {AREAS.map((area) => (
          <Link
            key={area.href}
            href={area.href}
            className="group rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-6 transition hover:border-amber-700/60 hover:bg-zinc-900/70"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              {area.eyebrow}
            </p>
            <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-zinc-100 transition group-hover:text-amber-100">
              {area.title}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              {area.description}
            </p>
            <p className="mt-5 text-xs font-medium text-amber-300/90">
              Open settings →
            </p>
          </Link>
        ))}
      </section>
    </div>
  );
}
