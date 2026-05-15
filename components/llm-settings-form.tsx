"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type LlmProviderOption = "openrouter" | "lmstudio" | "remote_api";

export type LlmSafeDefaults = {
  provider: LlmProviderOption;
  openrouterBaseUrl: string;
  openrouterModel: string;
  lmstudioBaseUrl: string;
  lmstudioModel: string;
  remoteApiBaseUrl: string;
  remoteApiModel: string;
  openrouterHttpReferer: string;
  openrouterAppTitle: string;
};

type FormState = {
  provider: LlmProviderOption;
  openrouterBaseUrl: string;
  openrouterModel: string;
  lmstudioBaseUrl: string;
  lmstudioModel: string;
  remoteApiBaseUrl: string;
  remoteApiModel: string;
  openrouterHttpReferer: string;
  openrouterAppTitle: string;
};

export function LlmSettingsForm(props: {
  defaults: LlmSafeDefaults;
  initial: FormState;
  envHasOpenrouterKey: boolean;
  envHasRemoteApiKey: boolean;
  initialOpenrouterKeyStored: boolean;
  initialRemoteApiKeyStored: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(props.initial);
  const [newOpenrouterApiKey, setNewOpenrouterApiKey] = useState("");
  const [newRemoteApiKey, setNewRemoteApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    setPending(true);
    try {
      const body: Record<string, string> = {
        provider: form.provider,
        openrouterBaseUrl: form.openrouterBaseUrl,
        openrouterModel: form.openrouterModel,
        lmstudioBaseUrl: form.lmstudioBaseUrl,
        lmstudioModel: form.lmstudioModel,
        remoteApiBaseUrl: form.remoteApiBaseUrl,
        remoteApiModel: form.remoteApiModel,
        openrouterHttpReferer: form.openrouterHttpReferer,
        openrouterAppTitle: form.openrouterAppTitle,
      };
      if (newOpenrouterApiKey.trim()) {
        body.openrouterApiKey = newOpenrouterApiKey.trim();
      }
      if (newRemoteApiKey.trim()) {
        body.remoteApiKey = newRemoteApiKey.trim();
      }
      const res = await fetch("/api/llm/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Could not save",
        );
        return;
      }
      setNewOpenrouterApiKey("");
      setNewRemoteApiKey("");
      setSaved("Saved. Header badge updates after refresh.");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function clearStoredOpenrouterKey() {
    setError(null);
    setSaved(null);
    setPending(true);
    try {
      const res = await fetch("/api/llm/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openrouterApiKey: "" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          typeof data.error === "string" ? data.error : "Could not clear key",
        );
        return;
      }
      setSaved("Stored OpenRouter key removed. Using environment variable if set.");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function clearStoredRemoteKey() {
    setError(null);
    setSaved(null);
    setPending(true);
    try {
      const res = await fetch("/api/llm/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remoteApiKey: "" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          typeof data.error === "string" ? data.error : "Could not clear key",
        );
        return;
      }
      setSaved(
        "Stored remote API key removed. Using REMOTE_API_KEY / OPENAI_API_KEY from the environment if set.",
      );
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const d = props.defaults;

  return (
    <form
      onSubmit={save}
      className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-14"
    >
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          Configuration
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
          LLM target
        </h1>
        <p className="mt-3 text-lg text-zinc-400">
          Choose <strong className="font-medium text-zinc-200">OpenRouter</strong>, a{" "}
          <strong className="font-medium text-zinc-200">hosted OpenAI-compatible API</strong>{" "}
          (OpenAI, proxies, or other <code className="text-zinc-300">/v1</code> endpoints), or a
          local <strong className="font-medium text-zinc-200">LM Studio</strong> server. API keys
          can live in this database or in environment variables documented in{" "}
          <code className="text-zinc-300">.env.example</code>.
        </p>
      </header>

      <section className="flex flex-col gap-4 rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-6">
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-zinc-500">Provider</span>
          <select
            value={form.provider}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                provider: e.target.value as FormState["provider"],
              }))
            }
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-200 outline-none focus:border-amber-700/80 focus:ring-1 focus:ring-amber-600/40"
          >
            <option value="openrouter">OpenRouter</option>
            <option value="remote_api">Hosted OpenAI-compatible API</option>
            <option value="lmstudio">LM Studio (local)</option>
          </select>
        </label>
      </section>

      {form.provider === "openrouter" ? (
        <section className="flex flex-col gap-4 rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
            OpenRouter
          </h2>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-zinc-500">Base URL</span>
            <input
              value={form.openrouterBaseUrl}
              onChange={(e) =>
                setForm((f) => ({ ...f, openrouterBaseUrl: e.target.value }))
              }
              placeholder={d.openrouterBaseUrl}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-[family-name:var(--font-mono)] text-sm text-zinc-100 placeholder:text-zinc-600"
            />
            <span className="text-xs text-zinc-600">
              Leave empty to use default: {d.openrouterBaseUrl}
            </span>
          </label>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-zinc-500">Model id</span>
            <input
              value={form.openrouterModel}
              onChange={(e) =>
                setForm((f) => ({ ...f, openrouterModel: e.target.value }))
              }
              placeholder={d.openrouterModel}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-[family-name:var(--font-mono)] text-sm text-zinc-100 placeholder:text-zinc-600"
            />
            <span className="text-xs text-zinc-600">
              Example: openai/gpt-4o-mini — empty uses env default
            </span>
          </label>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-zinc-500">HTTP Referer (optional)</span>
            <input
              value={form.openrouterHttpReferer}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  openrouterHttpReferer: e.target.value,
                }))
              }
              placeholder={d.openrouterHttpReferer}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-zinc-500">X-Title (optional)</span>
            <input
              value={form.openrouterAppTitle}
              onChange={(e) =>
                setForm((f) => ({ ...f, openrouterAppTitle: e.target.value }))
              }
              placeholder={d.openrouterAppTitle}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
            />
          </label>
          <div className="flex flex-col gap-2 border-t border-zinc-800/80 pt-4">
            <span className="text-sm text-zinc-500">API key</span>
            <p className="text-xs text-zinc-600">
              {props.initialOpenrouterKeyStored
                ? "A key is stored in the database for this app."
                : "No key stored in the database."}{" "}
              {props.envHasOpenrouterKey
                ? "Environment variable OPENROUTER_API_KEY is set."
                : "No OPENROUTER_API_KEY in the environment."}
            </p>
            <input
              type="password"
              autoComplete="off"
              value={newOpenrouterApiKey}
              onChange={(e) => setNewOpenrouterApiKey(e.target.value)}
              placeholder="New OpenRouter key (optional — leave blank to keep current)"
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-[family-name:var(--font-mono)] text-sm text-zinc-100 placeholder:text-zinc-600"
            />
            {props.initialOpenrouterKeyStored ? (
              <button
                type="button"
                onClick={clearStoredOpenrouterKey}
                disabled={pending}
                className="self-start text-xs font-medium text-rose-400/90 hover:text-rose-300 disabled:opacity-40"
              >
                Remove stored database key (use env only)
              </button>
            ) : null}
          </div>
        </section>
      ) : form.provider === "remote_api" ? (
        <section className="flex flex-col gap-4 rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
            Hosted OpenAI-compatible API
          </h2>
          <p className="text-xs leading-relaxed text-zinc-600">
            Uses the standard chat completions path on your base URL (same wire format as OpenAI).
            Defaults target api.openai.com; you can point at another compatible host or gateway.
          </p>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-zinc-500">Base URL</span>
            <input
              value={form.remoteApiBaseUrl}
              onChange={(e) =>
                setForm((f) => ({ ...f, remoteApiBaseUrl: e.target.value }))
              }
              placeholder={d.remoteApiBaseUrl}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-[family-name:var(--font-mono)] text-sm text-zinc-100 placeholder:text-zinc-600"
            />
            <span className="text-xs text-zinc-600">
              Example: {d.remoteApiBaseUrl} — include <code className="text-zinc-400">/v1</code> if
              your provider expects it.
            </span>
          </label>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-zinc-500">Model id</span>
            <input
              value={form.remoteApiModel}
              onChange={(e) =>
                setForm((f) => ({ ...f, remoteApiModel: e.target.value }))
              }
              placeholder={d.remoteApiModel}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-[family-name:var(--font-mono)] text-sm text-zinc-100 placeholder:text-zinc-600"
            />
            <span className="text-xs text-zinc-600">
              Must match the model name your endpoint accepts (e.g. gpt-4o-mini).
            </span>
          </label>
          <div className="flex flex-col gap-2 border-t border-zinc-800/80 pt-4">
            <span className="text-sm text-zinc-500">API key</span>
            <p className="text-xs text-zinc-600">
              {props.initialRemoteApiKeyStored
                ? "A key is stored in the database for this app."
                : "No key stored in the database."}{" "}
              {props.envHasRemoteApiKey
                ? "REMOTE_API_KEY or OPENAI_API_KEY is set in the environment."
                : "No REMOTE_API_KEY / OPENAI_API_KEY in the environment."}
            </p>
            <input
              type="password"
              autoComplete="off"
              value={newRemoteApiKey}
              onChange={(e) => setNewRemoteApiKey(e.target.value)}
              placeholder="New API key (optional — leave blank to keep current)"
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-[family-name:var(--font-mono)] text-sm text-zinc-100 placeholder:text-zinc-600"
            />
            {props.initialRemoteApiKeyStored ? (
              <button
                type="button"
                onClick={clearStoredRemoteKey}
                disabled={pending}
                className="self-start text-xs font-medium text-rose-400/90 hover:text-rose-300 disabled:opacity-40"
              >
                Remove stored database key (use env only)
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="flex flex-col gap-4 rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
            LM Studio
          </h2>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-zinc-500">Base URL</span>
            <input
              value={form.lmstudioBaseUrl}
              onChange={(e) =>
                setForm((f) => ({ ...f, lmstudioBaseUrl: e.target.value }))
              }
              placeholder={d.lmstudioBaseUrl}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-[family-name:var(--font-mono)] text-sm text-zinc-100 placeholder:text-zinc-600"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-zinc-500">Model id</span>
            <input
              value={form.lmstudioModel}
              onChange={(e) =>
                setForm((f) => ({ ...f, lmstudioModel: e.target.value }))
              }
              placeholder={d.lmstudioModel}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-[family-name:var(--font-mono)] text-sm text-zinc-100 placeholder:text-zinc-600"
            />
            <span className="text-xs text-zinc-600">
              Must match the model loaded in LM Studio (OpenAI-compatible API).
            </span>
          </label>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-amber-500/90 px-6 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save settings"}
        </button>
        {saved ? (
          <span className="text-sm text-emerald-400/90">{saved}</span>
        ) : null}
        {error ? (
          <span className="text-sm text-rose-300" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
