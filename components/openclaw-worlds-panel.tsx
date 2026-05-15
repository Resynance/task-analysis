"use client";

import { useCallback, useEffect, useState } from "react";

type WorldListItem = {
  id: string;
  name: string;
  updatedAt: string;
};

const NEW_SENTINEL = "__new__";

export function OpenclawWorldsPanel() {
  const [worlds, setWorlds] = useState<WorldListItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass =
    "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-700/80 focus:outline-none focus:ring-1 focus:ring-amber-700/50";

  const refreshList = useCallback(async () => {
    const res = await fetch("/api/special-projects/openclaw/worlds");
    if (!res.ok) {
      setError(`Could not load worlds (${res.status})`);
      return;
    }
    const data = (await res.json()) as { worlds: WorldListItem[] };
    setWorlds(data.worlds ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError(null);
      try {
        await refreshList();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load worlds");
        }
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshList]);

  const loadWorld = useCallback(async (id: string) => {
    setError(null);
    const res = await fetch(`/api/special-projects/openclaw/worlds/${id}`);
    if (!res.ok) {
      setError("Could not load that world.");
      return;
    }
    const row = (await res.json()) as {
      id: string;
      name: string;
      body: string;
    };
    setEditingId(row.id);
    setName(row.name);
    setBody(row.body);
  }, []);

  function onSelectWorld(value: string) {
    setError(null);
    if (value === NEW_SENTINEL) {
      setEditingId(null);
      setName("");
      setBody("");
      return;
    }
    void loadWorld(value);
  }

  async function onSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a name before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        const res = await fetch(`/api/special-projects/openclaw/worlds/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmedName, body }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? "Save failed");
          return;
        }
      } else {
        const res = await fetch("/api/special-projects/openclaw/worlds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmedName, body }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? "Save failed");
          return;
        }
        const row = (await res.json()) as { id: string };
        setEditingId(row.id);
      }
      await refreshList();
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!editingId) return;
    if (!window.confirm(`Delete world “${name.trim() || "untitled"}”?`)) return;
    setError(null);
    const res = await fetch(`/api/special-projects/openclaw/worlds/${editingId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setError("Delete failed.");
      return;
    }
    setEditingId(null);
    setName("");
    setBody("");
    await refreshList();
  }

  async function onWorldsPdf(file: File | null) {
    setError(null);
    if (!file) return;
    setPdfBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/special-projects/openclaw/parse-worlds-pdf", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "PDF import failed");
        return;
      }
      if (typeof data.text === "string") {
        setBody(data.text);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF import failed");
    } finally {
      setPdfBusy(false);
    }
  }

  const selectValue = editingId ?? NEW_SENTINEL;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6">
      <h2 className="text-lg font-semibold text-zinc-100">Worlds</h2>
      <p className="mt-2 text-sm text-zinc-400">
        Save world reference text in the app database for reuse. On{" "}
        <a
          href="/special-projects/openclaw/analyze"
          className="text-amber-200/90 underline-offset-4 hover:text-amber-100 hover:underline"
        >
          Run analysis
        </a>
        , pick which saved world to audit against (or paste a one-off).
      </p>

      {listLoading ? (
        <p className="mt-4 text-sm text-zinc-500">Loading saved worlds…</p>
      ) : (
        <label className="mt-4 block text-sm text-zinc-300">
          Open for editing
          <select
            value={selectValue}
            onChange={(e) => onSelectWorld(e.target.value)}
            className={`${inputClass} font-mono text-xs`}
          >
            <option value={NEW_SENTINEL}>New world…</option>
            {worlds.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} — {new Date(w.updatedAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="mt-4 block text-sm text-zinc-300">
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. John Bryanson (bash)"
          className={inputClass}
        />
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-zinc-300">
          <span className="sr-only">PDF file</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={pdfBusy}
            onChange={(e) => void onWorldsPdf(e.target.files?.[0] ?? null)}
            className="text-sm text-zinc-400 file:mr-3 file:rounded-lg file:border file:border-zinc-600 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-sm file:text-zinc-200 hover:file:border-amber-700/60"
          />
        </label>
        {pdfBusy ? (
          <span className="text-sm text-zinc-500">Reading PDF…</span>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        placeholder="World reference text — paste, type, or import from PDF."
        className={`${inputClass} mt-4 min-h-[160px] font-mono text-xs`}
      />

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={saving}
          className="rounded-lg border border-amber-700/80 bg-amber-900/25 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-900/40 disabled:opacity-50"
        >
          {saving ? "Saving…" : editingId ? "Update" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => void onDelete()}
          disabled={!editingId}
          className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => void refreshList()}
          className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Refresh list
        </button>
      </div>
    </section>
  );
}
