"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { requestOpenRouterCreditsRefresh } from "@/lib/openrouter-credits-refresh";
import {
  type EnvFilter,
  getEnvFilterShortLabel,
  parseEnvFilter,
  serializeEnvQueryValue,
} from "@/lib/task-environment";
import {
  getProjectFilterShortLabel,
  parseProjectFilter,
  serializeProjectQueryValue,
  type ProjectFilter,
} from "@/lib/task-project";

type GuidelineOption = { id: string; name: string };

function slugForFilenamePart(raw: string): string {
  const s = raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return s.length > 0 ? s.slice(0, 64) : "export";
}

function triggerMarkdownDownload(filename: string, content: string) {
  const blob = new Blob([content], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function DatasetQaPanel(props: {
  projectFilter: ProjectFilter;
  projectFilterOptions: ProjectFilter[];
  envFilter: EnvFilter;
  envFilterOptions: EnvFilter[];
  guidelines: GuidelineOption[];
  guidelineFilterIds: string[];
  noEnvironmentAvailable: boolean;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [operatorNotes, setOperatorNotes] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guidelineScopeLabel = useMemo(() => {
    if (props.guidelines.length === 0) return "No rubrics";
    if (props.guidelineFilterIds.length === 0) return "All rubrics";
    if (props.guidelineFilterIds.length === 1) {
      return (
        props.guidelines.find((g) => g.id === props.guidelineFilterIds[0])
          ?.name ?? "1 rubric"
      );
    }
    return `${props.guidelineFilterIds.length} rubrics`;
  }, [props.guidelineFilterIds, props.guidelines]);

  function mergeSearchParams(): URLSearchParams {
    return new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : "",
    );
  }

  function applyProjectFilter(next: ProjectFilter) {
    setError(null);
    setAnswer(null);
    const params = mergeSearchParams();
    if (next === "all") {
      params.delete("project");
    } else {
      params.set("project", serializeProjectQueryValue(next));
    }
    params.delete("env");
    const qs = params.toString();
    router.push(qs ? `/reports/dataset-qa?${qs}` : "/reports/dataset-qa", {
      scroll: false,
    });
  }

  function applyEnvFilter(next: EnvFilter) {
    setError(null);
    setAnswer(null);
    const params = mergeSearchParams();
    params.set("env", serializeEnvQueryValue(next));
    const qs = params.toString();
    router.push(qs ? `/reports/dataset-qa?${qs}` : "/reports/dataset-qa", {
      scroll: false,
    });
  }

  function applyGuidelineFilter(nextIds: string[]) {
    setError(null);
    setAnswer(null);
    const params = mergeSearchParams();
    const allIds = props.guidelines.map((g) => g.id);
    const isFull =
      allIds.length > 0 &&
      nextIds.length === allIds.length &&
      allIds.every((id) => nextIds.includes(id));
    if (nextIds.length === 0 || isFull) {
      params.delete("guidelines");
    } else {
      params.set("guidelines", nextIds.join(","));
    }
    const qs = params.toString();
    router.push(qs ? `/reports/dataset-qa?${qs}` : "/reports/dataset-qa", {
      scroll: false,
    });
  }

  function toggleGuideline(id: string) {
    const all = props.guidelines.map((g) => g.id);
    if (props.guidelineFilterIds.length === 0) {
      applyGuidelineFilter(all.filter((x) => x !== id));
      return;
    }
    const set = new Set(props.guidelineFilterIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    const next = [...set];
    if (next.length === 0 || next.length === all.length) {
      applyGuidelineFilter([]);
      return;
    }
    applyGuidelineFilter(next);
  }

  async function submit() {
    if (props.projectFilter === "all" || props.noEnvironmentAvailable) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/dataset-qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: serializeProjectQueryValue(props.projectFilter),
          environment: serializeEnvQueryValue(props.envFilter),
          guidelineIds: props.guidelineFilterIds,
          question,
          ...(operatorNotes.trim().length > 0
            ? { operatorNotes: operatorNotes.trim() }
            : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        answer?: string;
      };
      if (!res.ok) {
        setAnswer(null);
        setError(
          typeof data.error === "string" ? data.error : "Request failed",
        );
        return;
      }
      if (typeof data.answer === "string") {
        setAnswer(data.answer);
      } else {
        setAnswer(null);
        setError("Unexpected response from server.");
      }
      requestOpenRouterCreditsRefresh();
    } finally {
      setLoading(false);
    }
  }

  function exportAnswerAsMarkdown() {
    if (!answer) return;
    const exported = new Date().toISOString();
    const projectLine =
      props.projectFilter === "all"
        ? "—"
        : getProjectFilterShortLabel(props.projectFilter);
    const envLine =
      props.envFilter === "all"
        ? "All environments"
        : getEnvFilterShortLabel(props.envFilter);
    const lines: string[] = [
      "# Dataset Q&A export",
      "",
      "## Metadata",
      "",
      `- **Exported (UTC):** ${exported}`,
      `- **Project:** ${projectLine}`,
      `- **Environment:** ${envLine}`,
      `- **Rubrics:** ${guidelineScopeLabel}`,
      "",
      "## Question",
      "",
      question.trim(),
      "",
    ];
    const notes = operatorNotes.trim();
    if (notes.length > 0) {
      lines.push("## Operator notes", "", notes, "");
    }
    lines.push("## Answer", "", answer, "");
    const body = lines.join("\n");
    const projectSlug =
      props.projectFilter === "all"
        ? "dataset"
        : slugForFilenamePart(
            serializeProjectQueryValue(props.projectFilter),
          );
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `dataset-qa-${projectSlug}-${stamp}.md`;
    triggerMarkdownDownload(filename, body);
  }

  const selectEnvValue = serializeEnvQueryValue(props.envFilter);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-5 py-14">
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          Meta-analysis
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
            Dataset Q&amp;A
          </h1>
          <span className="relative inline-flex">
            <button
              type="button"
              className="peer rounded-full border border-zinc-600 bg-zinc-900/80 p-0.5 text-zinc-400 outline-none transition hover:border-amber-700/60 hover:text-amber-200/90 focus-visible:ring-1 focus-visible:ring-amber-600/40"
              aria-label="About dataset Q and A"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-2.5"
                aria-hidden
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
            </button>
            <div
              role="tooltip"
              className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 w-[min(100vw-2rem,12rem)] -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-[9px] leading-tight text-zinc-300 shadow-sm opacity-0 transition-opacity duration-150 peer-hover:opacity-100 peer-focus-visible:opacity-100"
            >
              Ask the configured LLM questions about the selected project and
              environment. The model receives aggregate counts plus a stratified
              sample of prompt bodies (truncated). Answers are not saved.
            </div>
          </span>
        </div>
        <p className="mt-3 text-zinc-400">
          Ask targeted questions about tasks in scope — the model sees summary
          stats and excerpted prompts, not the full database.
        </p>
      </header>

      {props.noEnvironmentAvailable ? (
        <p className="text-sm text-amber-200/90" role="status">
          No projects or evaluation environments found yet — ingest JSON under{" "}
          <code className="text-zinc-400">prompts/</code> first.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-500">
              <span className="whitespace-nowrap">Project</span>
              <select
                value={serializeProjectQueryValue(props.projectFilter)}
                onChange={(e) =>
                  applyProjectFilter(
                    parseProjectFilter({ project: e.target.value }),
                  )
                }
                className="max-w-[min(100vw-2rem,16rem)] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-amber-700/80"
              >
                {props.projectFilterOptions.map((opt) => (
                  <option
                    key={serializeProjectQueryValue(opt)}
                    value={serializeProjectQueryValue(opt)}
                  >
                    {getProjectFilterShortLabel(opt)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-500">
              <span className="whitespace-nowrap">Environment</span>
              <select
                value={selectEnvValue}
                onChange={(e) =>
                  applyEnvFilter(parseEnvFilter({ env: e.target.value }))
                }
                className="max-w-[min(100vw-2rem,18rem)] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-amber-700/80"
              >
                {props.envFilterOptions.map((opt) => {
                  const ser = serializeEnvQueryValue(opt);
                  return (
                    <option key={ser} value={ser}>
                      {getEnvFilterShortLabel(opt)}
                    </option>
                  );
                })}
              </select>
            </label>
            {props.guidelines.length > 0 ? (
              <details className="group relative">
                <summary className="cursor-pointer list-none rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none marker:content-none focus:border-amber-700/80 [&::-webkit-details-marker]:hidden">
                  Scoring rubrics{" "}
                  <span className="text-zinc-500">({guidelineScopeLabel})</span>
                </summary>
                <div className="absolute right-0 z-50 mt-1 max-h-64 w-[min(100vw-2rem,20rem)] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 p-3 shadow-xl">
                  <div className="mb-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => applyGuidelineFilter([])}
                      className="text-xs text-amber-200/90 hover:text-amber-100"
                    >
                      All rubrics
                    </button>
                  </div>
                  <ul className="space-y-2">
                    {props.guidelines.map((g) => (
                      <li key={g.id}>
                        <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
                          <input
                            type="checkbox"
                            className="mt-0.5 rounded border-zinc-600"
                            checked={
                              props.guidelineFilterIds.length === 0 ||
                              props.guidelineFilterIds.includes(g.id)
                            }
                            onChange={() => toggleGuideline(g.id)}
                          />
                          <span className="leading-snug">{g.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ) : null}
          </div>

          <p className="text-xs text-zinc-500">
            Scope:{" "}
            <strong className="font-medium text-zinc-400">
              {props.projectFilter === "all"
                ? "—"
                : getProjectFilterShortLabel(props.projectFilter)}
            </strong>
            {" · "}
            <strong className="font-medium text-zinc-400">
              {props.envFilter === "all"
                ? "All environments"
                : getEnvFilterShortLabel(props.envFilter)}
            </strong>
            {" · "}
            <strong className="font-medium text-zinc-400">
              {guidelineScopeLabel}
            </strong>
          </p>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-zinc-400">
              Question <span className="font-normal text-zinc-500">(required)</span>
            </span>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value.slice(0, 4000))}
              disabled={loading}
              rows={5}
              placeholder="e.g. “What patterns do you see in poor-tier prompts?” or “Do unscored tasks look ready for rubric scoring?”"
              className="resize-y rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 py-3 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-amber-700/80 focus:outline-none focus:ring-1 focus:ring-amber-600/30 disabled:opacity-50"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-zinc-400">
              Optional context for this question{" "}
              <span className="font-normal text-zinc-500">
                (clears if you leave this page)
              </span>
            </span>
            <textarea
              value={operatorNotes}
              onChange={(e) => setOperatorNotes(e.target.value.slice(0, 6000))}
              disabled={loading}
              rows={3}
              placeholder='e.g. "We changed the rubric last week — focus on tasks analyzed after Monday."'
              className="resize-y rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 py-3 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-amber-700/80 focus:outline-none focus:ring-1 focus:ring-amber-600/30 disabled:opacity-50"
            />
          </label>

          {error ? (
            <p className="text-sm text-red-300/95" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={
                loading ||
                props.projectFilter === "all" ||
                props.noEnvironmentAvailable ||
                question.trim().length === 0
              }
              className="rounded-xl border border-amber-800/70 bg-amber-950/40 px-5 py-2.5 text-sm font-medium text-amber-100 transition hover:border-amber-600/90 hover:bg-amber-900/35 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? "Asking…" : "Ask the model"}
            </button>
          </div>

          {answer ? (
            <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-5 py-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                  Answer
                </h2>
                <button
                  type="button"
                  onClick={exportAnswerAsMarkdown}
                  className="rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-amber-700/60 hover:text-amber-100"
                >
                  Export as .md
                </button>
              </div>
              <div className="mt-4 text-sm leading-relaxed text-zinc-200 [&_a]:text-amber-200 [&_a]:underline [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:border-b [&_h2]:border-zinc-700 [&_h2]:pb-1 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-medium [&_p]:my-2 [&_li]:my-1 [&_ul]:my-2 [&_ol]:my-2 [&_strong]:text-zinc-50 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-zinc-600 [&_th]:bg-zinc-900 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-zinc-600 [&_td]:px-2 [&_td]:py-1 [&_code]:rounded [&_code]:bg-zinc-900 [&_code]:px-1 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-zinc-900 [&_pre]:p-3">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
