"use client";

import Link from "next/link";
import { useState } from "react";

export default function IngestDataPage() {
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ingestFromDisk() {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/prompts/ingest", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Ingest failed",
        );
        return;
      }
      setNotice(
        typeof data.message === "string"
          ? data.message
          : "Ingest completed.",
      );
    } catch {
      setError("Request failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-14">
      <div>
        <Link
          href="/configuration"
          className="text-sm text-zinc-500 transition hover:text-amber-200/90"
        >
          ← Back to configuration
        </Link>
      </div>

      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          Configuration / Data
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
          Ingest data
        </h1>
        <p className="mt-3 text-zinc-400">
          Import prompt JSON or CSV exports from <code>Prompts/</code> or{" "}
          <code>prompts/</code> (each top-level file or nested folder is a project), and QA feedback CSV files
          under <code>feedback/samples/</code> (small fixtures in git) or{" "}
          <code>feedback/&lt;project&gt;/&lt;environment&gt;.csv</code> (local exports only, not
          committed) so feedback lines up with prompt projects and evaluation environments.
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-6">
        <button
          type="button"
          onClick={ingestFromDisk}
          disabled={running}
          className="rounded-full border border-sky-800/60 bg-sky-950/30 px-5 py-2.5 text-sm font-medium text-sky-200/90 transition hover:border-sky-600/70 hover:bg-sky-900/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? "Ingesting…" : "Run ingest from disk"}
        </button>
        <p className="mt-3 text-xs text-zinc-500">
          Runs the server-side ingest job and upserts prompt rows plus feedback
          rows in the local database.
        </p>

        {notice ? (
          <p
            className="mt-4 rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-200/90"
            role="status"
          >
            {notice}
          </p>
        ) : null}
        {error ? (
          <p
            className="mt-4 rounded-lg border border-rose-900/60 bg-rose-950/20 px-3 py-2 text-sm text-rose-200/90"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
