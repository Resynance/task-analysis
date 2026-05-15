"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

export type GuidelineRow = {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export function GuidelineManager(props: { guidelines: GuidelineRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editContent, setEditContent] = useState("");
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [pdfSetName, setPdfSetName] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function createGuideline(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/guidelines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, content }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        typeof data.error === "string" ? data.error : "Could not create",
      );
      return;
    }
    setName("");
    setContent("");
    refresh();
  }

  async function createGuidelineFromPdf(e: React.FormEvent) {
    e.preventDefault();
    setPdfError(null);
    const input = pdfInputRef.current;
    const file = input?.files?.[0];
    if (!file) {
      setPdfError("Choose a PDF file.");
      return;
    }
    setPdfBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const trimmedName = pdfSetName.trim();
      if (trimmedName) fd.append("name", trimmedName);

      const res = await fetch("/api/guidelines/from-pdf", {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPdfError(
          typeof data.error === "string"
            ? data.error
            : "Could not create guideline from PDF.",
        );
        return;
      }
      if (input) input.value = "";
      setPdfSetName("");
      refresh();
    } finally {
      setPdfBusy(false);
    }
  }

  function startEdit(g: GuidelineRow) {
    setEditingId(g.id);
    setEditName(g.name);
    setEditContent(g.content);
  }

  async function saveEdit(id: string) {
    setError(null);
    const res = await fetch(`/api/guidelines/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, content: editContent }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        typeof data.error === "string" ? data.error : "Could not update",
      );
      return;
    }
    setEditingId(null);
    refresh();
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/guidelines/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        typeof data.error === "string" ? data.error : "Could not delete",
      );
      return;
    }
    refresh();
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 px-5 py-14">
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          Rubric
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
          Guideline sets
        </h1>
        <p className="mt-3 text-lg text-zinc-400">
          These texts are sent to the evaluator model alongside each prompt.
          Create different sets for distinct domains or experiments. JSON imports
          under <code className="text-zinc-500">Prompts/</code> use a fixed
          system rubric managed in the database — it does not appear in this list.
        </p>
      </header>

      <form
        onSubmit={createGuideline}
        className="flex flex-col gap-4 rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-6"
      >
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
          New set
        </h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Name (e.g. Code assistants)"
          className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100 placeholder:text-zinc-600 focus:border-amber-700/80 focus:outline-none focus:ring-1 focus:ring-amber-600/30"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
          rows={8}
          placeholder="Write the rubric, criteria, and any constraints the model should apply…"
          className="resize-y rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-amber-700/80 focus:outline-none focus:ring-1 focus:ring-amber-600/30"
        />
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-full bg-amber-500/90 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-40"
        >
          Create guideline set
        </button>
        {error ? (
          <p className="text-sm text-rose-300" role="alert">
            {error}
          </p>
        ) : null}
      </form>

      <form
        onSubmit={createGuidelineFromPdf}
        className="flex flex-col gap-4 rounded-2xl border border-zinc-800/90 bg-zinc-900/25 p-6"
      >
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
          Import from PDF
        </h2>
        <p className="text-sm leading-relaxed text-zinc-500">
          Upload a rubric or scoring document; plain text is extracted and saved as the
          guideline content. Image-only PDFs may extract little or no text — use a
          text-based PDF or paste manually above.
        </p>
        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border file:border-zinc-600 file:bg-zinc-950 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-200 hover:file:border-amber-700/60"
        />
        <input
          value={pdfSetName}
          onChange={(e) => setPdfSetName(e.target.value)}
          placeholder="Set name (optional — defaults to PDF filename)"
          className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100 placeholder:text-zinc-600 focus:border-amber-700/80 focus:outline-none focus:ring-1 focus:ring-amber-600/30"
        />
        <button
          type="submit"
          disabled={pending || pdfBusy}
          className="self-start rounded-full bg-zinc-100 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-white disabled:opacity-40"
        >
          {pdfBusy ? "Extracting…" : "Create guideline set from PDF"}
        </button>
        {pdfError ? (
          <p className="text-sm text-rose-300" role="alert">
            {pdfError}
          </p>
        ) : null}
      </form>

      <ul className="flex flex-col gap-5">
        {props.guidelines.length === 0 ? (
          <li className="rounded-xl border border-zinc-800 py-12 text-center text-zinc-500">
            No guideline sets yet.
          </li>
        ) : (
          props.guidelines.map((g) => (
            <li
              key={g.id}
              className="rounded-2xl border border-zinc-800/90 bg-zinc-950/40 p-5"
            >
              {editingId === g.id ? (
                <div className="flex flex-col gap-3">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                  />
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={10}
                    className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm leading-relaxed text-zinc-100"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => saveEdit(g.id)}
                      className="rounded-full bg-zinc-100 px-4 py-1.5 text-xs font-semibold text-zinc-900"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-full border border-zinc-600 px-4 py-1.5 text-xs text-zinc-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h3 className="font-[family-name:var(--font-display)] text-xl text-zinc-100">
                      {g.name}
                    </h3>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(g)}
                        className="text-xs font-medium text-amber-400/90 hover:text-amber-300"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(g.id)}
                        className="text-xs font-medium text-zinc-500 hover:text-rose-300"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap font-[family-name:var(--font-mono)] text-[13px] leading-relaxed text-zinc-400">
                    {g.content}
                  </pre>
                  <p className="mt-3 text-xs text-zinc-600">
                    Updated{" "}
                    {new Date(g.updatedAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
