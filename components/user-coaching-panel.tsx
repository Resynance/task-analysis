"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type {
  UserCoachingAnalysisResult,
  UserCoachingStoredAnalysisResult,
} from "@/lib/user-coaching-analysis";
import type {
  UserCoachingSavedFilters,
  UserCoachingSavedPayload,
} from "@/lib/user-coaching-saved";
import { requestOpenRouterCreditsRefresh } from "@/lib/openrouter-credits-refresh";

type RecordFilter = "all" | "prompts" | "feedback";

function parseRecords(sp: URLSearchParams): RecordFilter {
  const r = sp.get("records");
  if (r === "prompts" || r === "feedback") return r;
  return "all";
}

function filtersMatchUrl(
  saved: UserCoachingSavedFilters,
  env: string,
  records: RecordFilter,
): boolean {
  const envNorm = env === "all" ? "all" : env;
  return saved.env === envNorm && saved.records === records;
}

function formatSavedFilters(f: UserCoachingSavedFilters): string {
  const rec =
    f.records === "all"
      ? "all record types"
      : f.records === "prompts"
        ? "prompts only"
        : "feedback only";
  const env = f.env === "all" ? "all environments" : `env ${f.env}`;
  return `${rec} · ${env}`;
}

function toHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * PDF-only: drop canned scope paragraphs that call out AVERAGE/POOR (or similar) by name.
 * On-screen coaching text is unchanged.
 */
function stripTierCalloutDisclaimerForPdf(text: string): string {
  let t = text.trim();

  const explicitBlocks: RegExp[] = [
    /\bThis feedback focuses on improving the quality of your accepted feedback submissions,?\s*as indicated by the AVERAGE and POOR ratings\.\s*The guidance provided here is aimed at enhancing your effectiveness in delivering constructive feedback\.?/giu,
    /\bThis feedback focuses on improving the quality of your accepted feedback submissions,?\s*as indicated by the average and poor ratings\.\s*The guidance provided here is aimed at enhancing your effectiveness in delivering constructive feedback\.?/giu,
  ];
  for (const re of explicitBlocks) {
    t = t.replace(re, " ");
  }

  const paras = t
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const kept = paras.filter((p) => {
    const norm = p.toLowerCase().replace(/\s+/g, " ");
    if (!norm.includes("as indicated by") || !norm.includes("rating")) return true;
    const callsOutAveragePoor =
      /\baverage\b/.test(norm) &&
      /\bpoor\b/.test(norm) &&
      /\bas indicated by\b/.test(norm);
    if (!callsOutAveragePoor) return true;
    const soundsLikeDisclaimer =
      norm.includes("accepted feedback") ||
      norm.includes("accepted tasks") ||
      norm.includes("this feedback focuses") ||
      norm.includes("this coaching focuses") ||
      norm.includes("guidance provided here is aimed");
    return !soundsLikeDisclaimer;
  });

  return kept.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

type SavedMeta = {
  savedAtIso: string;
  rowUpdatedAtIso: string;
  filters: UserCoachingSavedFilters;
  displayName: string;
  additionalContextPresent: boolean;
};

function buildSavedMetaFromPayload(
  payload: UserCoachingSavedPayload,
  rowUpdatedAtIso: string | null,
): SavedMeta {
  return {
    savedAtIso: payload.savedAt,
    rowUpdatedAtIso: rowUpdatedAtIso ?? payload.savedAt,
    filters: payload.filters,
    displayName: payload.displayName,
    additionalContextPresent: payload.additionalContextPresent,
  };
}

export function UserCoachingPanel(props: {
  userKeyCanonical: string;
  initialSavedPayload: UserCoachingSavedPayload | null;
  initialSavedRowUpdatedAtIso: string | null;
}) {
  const {
    userKeyCanonical,
    initialSavedPayload,
    initialSavedRowUpdatedAtIso,
  } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const env = searchParams.get("env") ?? "all";
  const records = parseRecords(searchParams);

  const [additionalContext, setAdditionalContext] = useState("");
  const [openContext, setOpenContext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UserCoachingStoredAnalysisResult | null>(
    () => initialSavedPayload?.result ?? null,
  );
  const [savedMeta, setSavedMeta] = useState<SavedMeta | null>(() =>
    initialSavedPayload
      ? buildSavedMetaFromPayload(
          initialSavedPayload,
          initialSavedRowUpdatedAtIso,
        )
      : null,
  );

  useEffect(() => {
    if (!initialSavedPayload) {
      setResult(null);
      setSavedMeta(null);
      return;
    }
    setResult(initialSavedPayload.result);
    setSavedMeta(
      buildSavedMetaFromPayload(
        initialSavedPayload,
        initialSavedRowUpdatedAtIso,
      ),
    );
  }, [initialSavedPayload, initialSavedRowUpdatedAtIso]);

  const scopeLabel =
    records === "all"
      ? "prompts and feedback"
      : records === "prompts"
        ? "prompts only"
        : "feedback only";

  const filtersDifferFromSaved =
    savedMeta != null && !filtersMatchUrl(savedMeta.filters, env, records);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/users/coaching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userKey: userKeyCanonical,
          env: env === "all" ? undefined : env,
          records,
          additionalContext: additionalContext.trim() || undefined,
        }),
      });

      const rawText = await res.text();
      let data: {
        error?: string;
        coaching?: UserCoachingAnalysisResult | UserCoachingStoredAnalysisResult;
        savedAt?: string;
        savedDisplayName?: string;
        savedFilters?: UserCoachingSavedFilters;
        additionalContextPresent?: boolean;
      } = {};
      if (rawText.trim()) {
        try {
          data = JSON.parse(rawText) as typeof data;
        } catch {
          const snippet = rawText.slice(0, 160).replace(/\s+/g, " ");
          setError(
            `Could not read server response (${res.status}). ${snippet || "Empty body."}`,
          );
          return;
        }
      }

      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      if (
        !data.coaching?.overview ||
        !data.coaching.strengths ||
        !data.coaching.coachingPriorities
      ) {
        setError("Unexpected response from coaching analysis.");
        return;
      }
      setResult(data.coaching);
      if (
        data.savedAt &&
        data.savedFilters &&
        typeof data.savedDisplayName === "string"
      ) {
        setSavedMeta({
          savedAtIso: data.savedAt,
          rowUpdatedAtIso: data.savedAt,
          filters: data.savedFilters,
          displayName: data.savedDisplayName,
          additionalContextPresent: Boolean(data.additionalContextPresent),
        });
      }
      requestOpenRouterCreditsRefresh();
      router.refresh();
    } catch (err) {
      const detail =
        err instanceof Error && err.message
          ? ` ${err.message}`
          : "";
      setError(
        `Could not reach the coaching service.${detail} Check your connection and try again.`,
      );
    } finally {
      setLoading(false);
    }
  }, [userKeyCanonical, env, records, additionalContext, router]);

  function exportCoachingPdfReport() {
    if (!result || !savedMeta) return;

    const overviewPdf = stripTierCalloutDisclaimerForPdf(result.overview);
    const dataNotePdf = stripTierCalloutDisclaimerForPdf(result.dataNote);

    const prioritiesHtml = result.coachingPriorities
      .map(
        (p) => `
        <section class="priority">
          <h3>${toHtml(p.theme)}</h3>
          <p class="obs">${toHtml(p.observation)}</p>
          ${
            p.example?.trim()
              ? `<p class="subh">Example</p><p class="example">${toHtml(stripTierCalloutDisclaimerForPdf(p.example))}</p>`
              : ""
          }
          <p class="subh">Suggested actions</p>
          <ul>
            ${p.coachingActions.map((a) => `<li>${toHtml(a)}</li>`).join("")}
          </ul>
        </section>`,
      )
      .join("");

    const strengthsHtml = result.strengths
      .map((s) => `<li>${toHtml(s)}</li>`)
      .join("");

    const generatedLine = `Saved ${new Date(savedMeta.savedAtIso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    })} · Scope when generated: ${toHtml(formatSavedFilters(savedMeta.filters))}${
      savedMeta.additionalContextPresent
        ? " · Extra operator instructions were included"
        : ""
    }`;

    const reportHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Coaching insights — ${toHtml(savedMeta.displayName)}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #111827; line-height: 1.45; }
      h1 { margin: 0 0 8px; font-size: 22px; }
      .meta { color: #4b5563; font-size: 12px; margin-bottom: 20px; }
      h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin: 24px 0 8px; }
      .overview { font-size: 13px; white-space: pre-wrap; }
      ul.strengths { margin: 0; padding-left: 1.2rem; font-size: 13px; }
      .priority { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; page-break-inside: avoid; }
      .priority h3 { margin: 0 0 8px; font-size: 15px; }
      .obs { margin: 0 0 8px; font-size: 13px; color: #374151; }
      .example { margin: 0 0 10px; font-size: 13px; color: #1f2937; white-space: pre-wrap; border-left: 3px solid #e5e7eb; padding-left: 10px; }
      .subh { margin: 8px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af; }
      .priority ul { margin: 0; padding-left: 1.2rem; font-size: 13px; }
      .datanote { margin-top: 20px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; }
      @page { size: A4; margin: 14mm; }
      @media print {
        body { margin: 0; }
      }
    </style>
  </head>
  <body>
    <h1>Contributor coaching insights</h1>
    <div class="meta">${toHtml(savedMeta.displayName)}<br />${generatedLine}</div>

    ${
      overviewPdf
        ? `<h2>Overview</h2>
    <p class="overview">${toHtml(overviewPdf)}</p>`
        : ""
    }

    <h2>Strengths</h2>
    <ul class="strengths">${strengthsHtml}</ul>

    <h2>Coaching priorities</h2>
    ${prioritiesHtml}

    ${dataNotePdf ? `<p class="datanote">${toHtml(dataNotePdf)}</p>` : ""}
    <script>
      window.addEventListener('load', () => {
        window.focus();
        window.print();
      });
    </script>
  </body>
</html>`;

    const blob = new Blob([reportHtml], { type: "text/html;charset=utf-8;" });
    const reportUrl = URL.createObjectURL(blob);
    const win = window.open(reportUrl, "_blank", "noopener,noreferrer");
    if (!win) {
      URL.revokeObjectURL(reportUrl);
      setError("Pop-up blocked. Allow pop-ups to export the PDF report.");
      return;
    }
    setTimeout(() => URL.revokeObjectURL(reportUrl), 20000);
  }

  const savedLine =
    savedMeta != null
      ? `Last saved ${new Date(savedMeta.rowUpdatedAtIso).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })} · ${formatSavedFilters(savedMeta.filters)}`
      : null;

  return (
    <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/35 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-zinc-500">
            Coaching insights
          </p>
          <p className="mt-1 max-w-xl text-sm text-zinc-400">
            Optional LLM review of this contributor&apos;s scores and rationales in the{" "}
            <span className="text-zinc-300">current URL filters</span> ({scopeLabel}
            {env !== "all" ? ` · env ${env}` : ""}). Requires at least one scored record in
            scope. The latest successful run is <span className="text-zinc-300">saved</span>{" "}
            for this user and replaced on the next run.
          </p>
          {savedLine ? (
            <p className="mt-2 text-xs text-zinc-500">{savedLine}</p>
          ) : null}
          {filtersDifferFromSaved ? (
            <p className="mt-2 text-xs text-amber-200/80">
              Page filters differ from the saved report scope. Generate again to refresh the
              saved copy for the current filters, or use PDF to capture the saved version as
              shown below.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {result && savedMeta ? (
            <button
              type="button"
              onClick={() => exportCoachingPdfReport()}
              className="shrink-0 rounded-lg border border-zinc-600 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-900/80"
            >
              PDF report
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void run()}
            disabled={loading}
            className="shrink-0 rounded-lg border border-amber-800/70 bg-amber-950/40 px-4 py-2 text-sm font-medium text-amber-100/95 transition hover:bg-amber-950/55 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Generating…" : "Generate coaching insights"}
          </button>
        </div>
      </div>

      <div className="mt-4 border-t border-zinc-800/80 pt-4">
        <button
          type="button"
          onClick={() => setOpenContext((o) => !o)}
          className="text-sm text-zinc-500 underline-offset-2 hover:text-amber-200/90 hover:underline"
        >
          {openContext ? "Hide" : "Add"} extra instructions for the model
        </button>
        {openContext ? (
          <textarea
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
            rows={4}
            maxLength={8000}
            placeholder="e.g. focus on clarity vs. safety tradeoffs; this person is new to the rubric…"
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
          />
        ) : null}
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-sm text-rose-200/95">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-6 flex flex-col gap-6">
          <div>
            <h3 className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-zinc-500">
              Overview
            </h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
              {result.overview}
            </p>
          </div>
          <div>
            <h3 className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-zinc-500">
              Strengths
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-300">
              {result.strengths.map((s, i) => (
                <li key={`st-${i}-${s.slice(0, 48)}`}>{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-zinc-500">
              Coaching priorities
            </h3>
            <ul className="mt-3 flex flex-col gap-4">
              {result.coachingPriorities.map((p, idx) => (
                <li
                  key={`${idx}-${p.theme}`}
                  className="rounded-xl border border-zinc-800/90 bg-zinc-950/40 p-4"
                >
                  <p className="font-medium text-zinc-100">{p.theme}</p>
                  <p className="mt-2 text-sm text-zinc-400">{p.observation}</p>
                  {p.example?.trim() ? (
                    <div className="mt-3 rounded-lg border border-zinc-800/70 bg-zinc-950/60 px-3 py-2.5">
                      <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                        Example
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
                        {p.example}
                      </p>
                    </div>
                  ) : null}
                  <p className="mt-3 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                    Suggested actions
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-zinc-300">
                    {p.coachingActions.map((a, i) => (
                      <li key={`${idx}-a-${i}-${a.slice(0, 32)}`}>{a}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
          <p className="border-t border-zinc-800/80 pt-4 text-xs text-zinc-500">
            {result.dataNote}
          </p>
        </div>
      ) : (
        <p className="mt-6 text-sm text-zinc-500">
          No saved coaching report yet for this user. Run generate above (with at least one
          scored record in scope).
        </p>
      )}
    </section>
  );
}
