"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { OpenclawExportStreamEvent } from "@/lib/openclaw-export-stream";
import { TRACE_EXPORTS_RELATIVE_DEFAULT } from "@/lib/repo-paths";

const STORAGE_PREFIX = "openclawPanel:";

type CutoffMode =
  | "gt_instant"
  | "on_or_after_utc_date"
  | "after_utc_date";

type TaskSource = "portal" | "explicit";

type RetrievalStepStatus = "pending" | "running" | "succeeded" | "failed";

function loadStored(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + key) ?? fallback;
  } catch {
    return fallback;
  }
}

function storeValue(key: string, value: string) {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, value);
  } catch {
    /* ignore */
  }
}

export function OpenclawSpecialProjectPanel(props: {
  /** Repo-relative trace-export root (must match `TASK_ANALYSIS_TRACE_EXPORTS_DIR` on the server). */
  traceExportsPathDisplay?: string;
  traceBreadcrumbLabel: string;
  traceOverviewWorldsBackLabel: string;
}) {
  const traceExportsPath =
    props.traceExportsPathDisplay ?? TRACE_EXPORTS_RELATIVE_DEFAULT;
  const [taskSource, setTaskSource] = useState<TaskSource>(() =>
    (loadStored("taskSource", "portal") as TaskSource) === "explicit"
      ? "explicit"
      : "portal",
  );
  const [portalProjectId, setPortalProjectId] = useState(() =>
    loadStored("portalProjectId", ""),
  );
  const [teamId, setTeamId] = useState(() => loadStored("teamId", ""));
  const [projectTargetIds, setProjectTargetIds] = useState(() =>
    loadStored("projectTargetIds", ""),
  );
  const [portalBaseUrl, setPortalBaseUrl] = useState(() =>
    loadStored("portalBaseUrl", ""),
  );
  const [portalCookie, setPortalCookie] = useState("");
  const [supabaseUrl, setSupabaseUrl] = useState(() =>
    loadStored("supabaseUrl", ""),
  );
  const [anonKey, setAnonKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [supabaseCookie, setSupabaseCookie] = useState("");
  const [harPath, setHarPath] = useState(() => loadStored("harPath", ""));
  const [startDate, setStartDate] = useState(() =>
    loadStored("startDate", ""),
  );
  const [cutoffMode, setCutoffMode] = useState<CutoffMode>(() =>
    (loadStored("cutoffMode", "on_or_after_utc_date") as CutoffMode),
  );
  const [lifecycle, setLifecycle] = useState(() =>
    loadStored("lifecycle", "any"),
  );
  const [deriveFleetHeaders, setDeriveFleetHeaders] = useState(true);
  const [nextAction, setNextAction] = useState("");
  const [nextRouterStateTree, setNextRouterStateTree] = useState("");
  const [deploymentId, setDeploymentId] = useState("");
  const [userAgent, setUserAgent] = useState("");
  const [workflowDelaySeconds, setWorkflowDelaySeconds] = useState("0");

  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runLogs, setRunLogs] = useState<string | null>(null);
  const [runOk, setRunOk] = useState(false);
  const [exportPaths, setExportPaths] = useState<{
    tasksJson: string;
    workflowDir: string;
  } | null>(null);
  const [retrievalProduction, setRetrievalProduction] =
    useState<RetrievalStepStatus>("pending");
  const [retrievalWorkflow, setRetrievalWorkflow] =
    useState<RetrievalStepStatus>("pending");
  const [retrievalProgress, setRetrievalProgress] = useState(0);

  const persistNonSecrets = useCallback(() => {
    storeValue("taskSource", taskSource);
    storeValue("portalProjectId", portalProjectId);
    storeValue("teamId", teamId);
    storeValue("projectTargetIds", projectTargetIds);
    storeValue("portalBaseUrl", portalBaseUrl);
    storeValue("supabaseUrl", supabaseUrl);
    storeValue("harPath", harPath);
    storeValue("startDate", startDate);
    storeValue("cutoffMode", cutoffMode);
    storeValue("lifecycle", lifecycle);
  }, [
    taskSource,
    portalProjectId,
    teamId,
    projectTargetIds,
    portalBaseUrl,
    supabaseUrl,
    harPath,
    startDate,
    cutoffMode,
    lifecycle,
  ]);

  function applyStreamEvent(ev: OpenclawExportStreamEvent) {
    switch (ev.type) {
      case "phase":
        if (ev.phase === "production_tasks") {
          if (ev.status === "started") {
            setRetrievalProduction("running");
            setRetrievalProgress(18);
            setRunLogs((p) => {
              const base = p ?? "";
              const sep = base ? "\n" : "";
              return `${base}${sep}--- export_openclaw_production_tasks.py ---\n`;
            });
          } else if (ev.exitCode === 0) {
            setRetrievalProduction("succeeded");
            setRetrievalProgress(48);
          } else {
            setRetrievalProduction("failed");
            setRetrievalProgress(48);
          }
        } else {
          if (ev.status === "started") {
            setRetrievalWorkflow("running");
            setRetrievalProgress(52);
            setRunLogs((p) => {
              const base = p ?? "";
              const sep = base ? "\n" : "";
              return `${base}${sep}--- export_openclaw_task_workflow_steps.py ---\n`;
            });
          } else if (ev.exitCode === 0) {
            setRetrievalWorkflow("succeeded");
            setRetrievalProgress(96);
          } else {
            setRetrievalWorkflow("failed");
            setRetrievalProgress(96);
          }
        }
        break;
      case "log":
        setRunLogs((p) => (p ?? "") + ev.text);
        break;
      case "complete":
        if (ev.ok) {
          setRunOk(true);
          setExportPaths({
            tasksJson: ev.tasksExportPath,
            workflowDir: ev.workflowStepsOutDir,
          });
          setRetrievalProgress(100);
        } else {
          setRunError(ev.error);
          if (ev.step === "production_tasks") {
            setRetrievalProduction("failed");
          }
          if (ev.step === "workflow_steps") {
            setRetrievalWorkflow("failed");
          }
        }
        break;
      case "fatal":
        setRunError(ev.message);
        break;
    }
  }

  async function onGetNewTasks() {
    setRunError(null);
    setRunLogs("");
    setRunOk(false);
    setExportPaths(null);
    setRetrievalProduction("pending");
    setRetrievalWorkflow("pending");
    setRetrievalProgress(0);
    persistNonSecrets();

    if (taskSource === "explicit" && !projectTargetIds.trim()) {
      setRunError("Paste at least one project target UUID (comma-separated).");
      return;
    }

    const delayRaw = workflowDelaySeconds.trim();
    const delayParsed = delayRaw === "" ? 0 : Number.parseFloat(delayRaw);
    if (Number.isNaN(delayParsed) || delayParsed < 0) {
      setRunError("Delay between workflow POSTs must be a non-negative number.");
      return;
    }

    setRetrievalProgress(8);
    setRunBusy(true);
    try {
      const res = await fetch("/api/special-projects/openclaw/get-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portalProjectId:
            taskSource === "portal" ? portalProjectId.trim() || undefined : undefined,
          teamId: teamId.trim() || undefined,
          projectTargetIds:
            taskSource === "explicit" ? projectTargetIds.trim() : undefined,
          portalBaseUrl: portalBaseUrl.trim() || undefined,
          portalCookie: portalCookie.trim() || undefined,
          supabaseUrl: supabaseUrl.trim() || undefined,
          anonKey: anonKey.trim() || undefined,
          accessToken: accessToken.trim() || undefined,
          supabaseCookie: supabaseCookie.trim() || undefined,
          harPath: harPath.trim() || undefined,
          startDate: startDate.trim() || undefined,
          cutoffMode: startDate.trim() ? cutoffMode : undefined,
          lifecycle: lifecycle.trim() || undefined,
          deriveFleetHeaders,
          nextAction: nextAction.trim() || undefined,
          nextRouterStateTree: nextRouterStateTree.trim() || undefined,
          deploymentId: deploymentId.trim() || undefined,
          userAgent: userAgent.trim() || undefined,
          workflowDelaySeconds: delayParsed,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setRunError(data.error ?? `Request failed (${res.status})`);
        setRetrievalProduction("pending");
        setRetrievalWorkflow("pending");
        setRetrievalProgress(0);
        return;
      }

      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("ndjson") || !res.body) {
        setRunError("Unexpected response from server.");
        setRetrievalProduction("pending");
        setRetrievalWorkflow("pending");
        setRetrievalProgress(0);
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        for (;;) {
          const nl = buffer.indexOf("\n");
          if (nl < 0) break;
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            applyStreamEvent(JSON.parse(line) as OpenclawExportStreamEvent);
          } catch {
            /* ignore malformed line */
          }
        }
      }
      const tail = buffer.trim();
      if (tail) {
        try {
          applyStreamEvent(JSON.parse(tail) as OpenclawExportStreamEvent);
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Request failed");
      setRetrievalProduction("pending");
      setRetrievalWorkflow("pending");
      setRetrievalProgress(0);
    } finally {
      setRunBusy(false);
    }
  }

  function stepLabel(status: RetrievalStepStatus): string {
    switch (status) {
      case "pending":
        return "Pending";
      case "running":
        return "Running…";
      case "succeeded":
        return "Done";
      case "failed":
        return "Failed";
      default:
        return "";
    }
  }

  function stepRowClass(status: RetrievalStepStatus): string {
    switch (status) {
      case "running":
        return "border-amber-700/50 bg-amber-950/20 text-amber-100";
      case "succeeded":
        return "border-emerald-800/60 bg-emerald-950/15 text-emerald-100/95";
      case "failed":
        return "border-red-800/60 bg-red-950/20 text-red-200";
      default:
        return "border-zinc-800 text-zinc-500";
    }
  }

  const showRetrievalStatus =
    runBusy ||
    retrievalProduction !== "pending" ||
    retrievalWorkflow !== "pending";

  const inputClass =
    "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-700/80 focus:outline-none focus:ring-1 focus:ring-amber-700/50";

  const detailsClass =
    "mt-4 rounded-xl border border-zinc-800/90 bg-zinc-950/40 [&_summary]:cursor-pointer [&_summary]:select-none [&_summary]:text-sm [&_summary]:font-medium [&_summary]:text-zinc-200";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 px-5 py-10">
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          {props.traceBreadcrumbLabel}
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-zinc-50">
          Run export
        </h1>
        <p className="mt-3 max-w-3xl text-zinc-400">
          Outputs go to{" "}
          <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">
            {traceExportsPath}/
          </code>
          . Portal page-data supplies target IDs; PostgREST reads (e.g.{" "}
          <code className="rounded bg-zinc-900 px-1 text-zinc-300">eval_tasks</code>) need the
          anon key for <code className="text-zinc-400">apikey</code>, a user JWT for{" "}
          <code className="text-zinc-400">Authorization</code> (URL from{" "}
          <code className="text-zinc-400">iss</code> when omitted), matching env vars, or a HAR
          with any successful GET/HEAD to your project’s{" "}
          <code className="rounded bg-zinc-900 px-1 text-zinc-300">/rest/v1/…</code> endpoint that
          includes <code className="text-zinc-400">apikey</code>. Portal IDs, team, and optional{" "}
          <code className="text-zinc-400">supabase_url</code> /{" "}
          <code className="text-zinc-400">supabase_anon_key</code> can live in{" "}
          <code className="rounded bg-zinc-900 px-1 text-zinc-300">
            openclaw_portal_defaults.json
          </code>{" "}
          next to the scripts. Cutoff is optional. Trusted local use only.
        </p>
        <p className="mt-3 text-sm">
          <Link
            href="/special-projects/openclaw"
            className="text-amber-200/90 underline-offset-4 hover:text-amber-100 hover:underline"
          >
            {props.traceOverviewWorldsBackLabel}
          </Link>
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6">
        <h2 className="text-lg font-semibold text-zinc-100">Session &amp; task list</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Leave the cookie blank when{" "}
          <code className="rounded bg-zinc-900 px-1 text-zinc-300">
            OPENCLAW_PORTAL_COOKIE
          </code>{" "}
          is already set for the Next.js process.
        </p>
        <label className="mt-4 block text-sm text-zinc-300">
          Portal cookie (optional)
          <textarea
            value={portalCookie}
            onChange={(e) => setPortalCookie(e.target.value)}
            rows={2}
            placeholder="Paste Cookie from the browser, or rely on OPENCLAW_PORTAL_COOKIE in env."
            className={`${inputClass} font-mono text-xs`}
            autoComplete="off"
          />
        </label>

        <fieldset className="mt-6 space-y-3">
          <legend className="text-sm font-medium text-zinc-200">
            Task targets
          </legend>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
            <input
              type="radio"
              name="taskSource"
              checked={taskSource === "portal"}
              onChange={() => setTaskSource("portal")}
              className="size-4 border-zinc-600 bg-zinc-950"
            />
            Portal page-data (optional IDs if you use{" "}
            <code className="rounded bg-zinc-900 px-1 text-xs text-zinc-400">
              openclaw_portal_defaults.json
            </code>
            )
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
            <input
              type="radio"
              name="taskSource"
              checked={taskSource === "explicit"}
              onChange={() => setTaskSource("explicit")}
              className="size-4 border-zinc-600 bg-zinc-950"
            />
            Explicit{" "}
            <code className="rounded bg-zinc-900 px-1 text-xs text-zinc-400">
              task_project_target
            </code>{" "}
            UUIDs
          </label>
        </fieldset>

        {taskSource === "portal" ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-zinc-300">
              Portal project ID (optional)
              <input
                value={portalProjectId}
                onChange={(e) => setPortalProjectId(e.target.value)}
                placeholder="Overrides JSON / OPENCLAW_PORTAL_PROJECT_ID"
                className={`${inputClass} font-mono text-xs`}
              />
            </label>
            <label className="block text-sm text-zinc-300">
              Team ID (optional)
              <input
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                placeholder="Overrides JSON / OPENCLAW_TEAM_ID"
                className={`${inputClass} font-mono text-xs`}
              />
            </label>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <label className="block text-sm text-zinc-300">
              Project target UUIDs
              <textarea
                value={projectTargetIds}
                onChange={(e) => setProjectTargetIds(e.target.value)}
                rows={3}
                placeholder="uuid, uuid, …"
                className={`${inputClass} font-mono text-xs`}
              />
            </label>
            <label className="block text-sm text-zinc-300">
              Team ID (optional)
              <input
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                placeholder="Workflow fallback if tasks lack team_id"
                className={`${inputClass} font-mono text-xs`}
              />
            </label>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-amber-900/35 bg-amber-950/10 p-6">
        <h2 className="text-lg font-semibold text-zinc-100">
          Supabase (needed to fetch task rows)
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          PostgREST needs an <code className="text-zinc-400">apikey</code> header (publishable
          anon) and a user session JWT in <code className="text-zinc-400">Authorization</code>{" "}
          so RLS allows your rows. The defaults file supplies URL/anon for local/dev only—it
          does not replace a user JWT. Anon in JSON is the same <code className="text-zinc-400">apikey</code>{" "}
          the script already used; it is not your session token.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-zinc-300 sm:col-span-2">
            Supabase URL (REST, e.g. https://….supabase.co)
            <input
              value={supabaseUrl}
              onChange={(e) => setSupabaseUrl(e.target.value)}
              placeholder="https://xxxxx.supabase.co"
              className={inputClass}
            />
          </label>
          <label className="block text-sm text-zinc-300 sm:col-span-2">
            Supabase anon (publishable) key
            <input
              value={anonKey}
              onChange={(e) => setAnonKey(e.target.value)}
              placeholder="Optional if supabase_anon_key is in openclaw_portal_defaults.json or env"
              className={`${inputClass} font-mono text-xs`}
              autoComplete="off"
            />
          </label>
          <label className="block text-sm text-zinc-300 sm:col-span-2">
            Supabase access token (user session JWT — not the anon key)
            <textarea
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              rows={2}
              placeholder="eyJ… session JWT (required for protected rows); anon is separate — see From Next.js"
              className={`${inputClass} font-mono text-xs`}
              autoComplete="off"
            />
          </label>
          <label className="block text-sm text-zinc-300 sm:col-span-2">
            Supabase cookie header (optional)
            <textarea
              value={supabaseCookie}
              onChange={(e) => setSupabaseCookie(e.target.value)}
              rows={2}
              placeholder="Raw Cookie header (sb-…-auth-token) if URL is set"
              className={`${inputClass} font-mono text-xs`}
              autoComplete="off"
            />
          </label>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Env vars on the Next.js process (loaded into the Python child):{" "}
          <code className="text-zinc-400">OPENCLAW_SUPABASE_URL</code>,{" "}
          <code className="text-zinc-400">OPENCLAW_SUPABASE_ANON_KEY</code>,{" "}
          <code className="text-zinc-400">OPENCLAW_SUPABASE_ACCESS_TOKEN</code>,{" "}
          <code className="text-zinc-400">SUPABASE_URL</code>,{" "}
          <code className="text-zinc-400">SUPABASE_ANON_KEY</code>.
        </p>
        <div className="mt-4 rounded-lg border border-amber-900/25 bg-zinc-950/40 px-3 py-3 text-xs leading-relaxed text-zinc-500">
          <p className="font-medium text-zinc-400">From Next.js</p>
          <ul className="mt-2 list-disc space-y-2 pl-4">
            <li>
              Put <code className="text-zinc-400">supabase_anon_key</code> (and optional{" "}
              <code className="text-zinc-400">supabase_url</code>) in{" "}
              <code className="text-zinc-400">openclaw_portal_defaults.json</code> next to the
              export scripts—handy for local dev; treat like any other secret if the repo is
              shared. See{" "}
              <code className="text-zinc-400">openclaw_portal_defaults.example.json</code>.
            </li>
            <li>
              Or rely on <code className="text-zinc-400">.env.local</code>: the API route spawns
              Python with the same <code className="text-zinc-400">process.env</code> as the dev
              server, so <code className="text-zinc-400">OPENCLAW_SUPABASE_ANON_KEY</code> and
              friends match what you set for Next.
            </li>
            <li>
              Or rely on the page-data scrape only when that request actually runs (portal project
              + team + cookie); use the JSON keys when page-data does not embed the anon key.
            </li>
          </ul>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6">
        <h2 className="text-lg font-semibold text-zinc-100">Date filter (optional)</h2>
        <p className="mt-2 text-sm text-zinc-400">
          If you leave start date empty, the export script uses its built-in default{" "}
          <code className="rounded bg-zinc-900 px-1 text-zinc-300">--cutoff</code>. When
          start date is set, the default mode includes that entire UTC calendar day and all later
          dates (<code className="rounded bg-zinc-900 px-1 text-xs text-zinc-400">
            on_or_after_utc_date
          </code>
          ).
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-zinc-300">
            Start date
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-sm text-zinc-300">
            Cutoff mode
            <select
              value={cutoffMode}
              onChange={(e) => setCutoffMode(e.target.value as CutoffMode)}
              disabled={!startDate.trim()}
              className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <option value="gt_instant">
                After UTC midnight on start date (excludes same-day before midnight)
              </option>
              <option value="on_or_after_utc_date">
                On or after start date (includes whole UTC day) — default
              </option>
              <option value="after_utc_date">
                After start date (UTC date &gt; start date)
              </option>
            </select>
          </label>
        </div>
      </section>

      <details className={detailsClass}>
        <summary className="px-4 py-3">
          Advanced: workflow HAR, portal origin, Fleet headers
        </summary>
        <div className="space-y-4 border-t border-zinc-800/80 px-4 py-4">
          <p className="text-xs text-zinc-500">
            HAR can supply workflow headers and, if it contains a PostgREST request to{" "}
            <code className="text-zinc-400">/rest/v1/…</code> with an{" "}
            <code className="text-zinc-400">apikey</code> header, the Supabase template URL and
            anon key.{" "}
            <code className="text-zinc-400">OPENCLAW_NEXT_*</code> and related env vars
            are passed through to Python.
          </p>
          <label className="block text-sm text-zinc-300">
            HAR path (server-visible absolute path)
            <input
              value={harPath}
              onChange={(e) => setHarPath(e.target.value)}
              placeholder="/path/to/capture.har"
              className={`${inputClass} font-mono text-xs`}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={deriveFleetHeaders}
              onChange={(e) => setDeriveFleetHeaders(e.target.checked)}
              className="size-4 rounded border-zinc-600 bg-zinc-950"
            />
            Derive fleet headers (per-task router tree)
          </label>
          <label className="block text-sm text-zinc-300">
            Delay between workflow POSTs (seconds)
            <input
              value={workflowDelaySeconds}
              onChange={(e) => setWorkflowDelaySeconds(e.target.value)}
              type="number"
              min={0}
              step="0.25"
              className={inputClass}
            />
          </label>
          <label className="block text-sm text-zinc-300">
            Portal base URL
            <input
              value={portalBaseUrl}
              onChange={(e) => setPortalBaseUrl(e.target.value)}
              placeholder="https://fleetai.com"
              className={inputClass}
            />
          </label>
          <label className="block text-sm text-zinc-300">
            Task lifecycle filter
            <input
              value={lifecycle}
              onChange={(e) => setLifecycle(e.target.value)}
              placeholder="any — default includes all lifecycle states"
              className={inputClass}
            />
          </label>
          <label className="block text-sm text-zinc-300">
            Next-Action (override)
            <input
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              className={`${inputClass} font-mono text-xs`}
            />
          </label>
          <label className="block text-sm text-zinc-300">
            Next-Router-State-Tree (override)
            <textarea
              value={nextRouterStateTree}
              onChange={(e) => setNextRouterStateTree(e.target.value)}
              rows={3}
              className={`${inputClass} font-mono text-xs`}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-zinc-300">
              x-deployment-id
              <input
                value={deploymentId}
                onChange={(e) => setDeploymentId(e.target.value)}
                className={`${inputClass} font-mono text-xs`}
              />
            </label>
            <label className="block text-sm text-zinc-300">
              User-Agent
              <input
                value={userAgent}
                onChange={(e) => setUserAgent(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={runBusy}
          onClick={() => void onGetNewTasks()}
          className="rounded-xl border border-amber-700/80 bg-amber-900/25 px-5 py-2.5 text-sm font-medium text-amber-100 transition hover:bg-amber-900/40 disabled:opacity-50"
        >
          {runBusy ? "Running exports…" : "Get new tasks"}
        </button>
      </div>

      {showRetrievalStatus ? (
        <section
          className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5"
          role="status"
          aria-live="polite"
          aria-busy={runBusy}
        >
          <h3 className="text-sm font-semibold text-zinc-100">Task retrieval</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Two steps: list production tasks, then fetch per-task workflow steps.
          </p>
          <div
            className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-800"
            aria-hidden
          >
            <div
              className="h-full rounded-full bg-amber-600/90 transition-[width] duration-300 ease-out"
              style={{
                width: `${Math.min(100, Math.max(0, retrievalProgress))}%`,
              }}
            />
          </div>
          <ol className="mt-4 space-y-2 text-sm">
            <li
              className={`flex items-center justify-between rounded-lg border px-3 py-2 ${stepRowClass(retrievalProduction)}`}
            >
              <span className="font-medium text-zinc-200">
                1. Production tasks export
              </span>
              <span className="tabular-nums text-xs">
                {stepLabel(retrievalProduction)}
              </span>
            </li>
            <li
              className={`flex items-center justify-between rounded-lg border px-3 py-2 ${stepRowClass(retrievalWorkflow)}`}
            >
              <span className="font-medium text-zinc-200">
                2. Workflow steps export
              </span>
              <span className="tabular-nums text-xs">
                {stepLabel(retrievalWorkflow)}
              </span>
            </li>
          </ol>
        </section>
      ) : null}

      {runError ? (
        <div className="space-y-3" role="alert">
          <p className="text-sm text-red-400">{runError}</p>
          {/Missing Supabase|anon key|REST URL|api_missing_config/i.test(runError) ? (
            <div className="rounded-lg border border-amber-800/50 bg-amber-950/25 px-4 py-3 text-sm text-zinc-300">
              <p className="font-medium text-amber-200">What to add</p>
              <ul className="mt-2 list-disc space-y-1.5 pl-5">
                <li>
                  <code className="text-zinc-400">supabase_url</code> /{" "}
                  <code className="text-zinc-400">supabase_anon_key</code> in{" "}
                  <code className="text-zinc-400">openclaw_portal_defaults.json</code>, or the
                  URL and anon fields above, or project Settings → API in the Supabase dashboard.
                </li>
                <li>
                  A user JWT sets <code className="text-zinc-400">Authorization</code> and
                  can derive the REST URL from <code className="text-zinc-400">iss</code>,
                  but you still need the anon key for the{" "}
                  <code className="text-zinc-400">apikey</code> header (Dashboard →
                  Settings → API).
                </li>
                <li>
                  Or export{" "}
                  <code className="text-zinc-400">OPENCLAW_SUPABASE_URL</code>,{" "}
                  <code className="text-zinc-400">OPENCLAW_SUPABASE_ANON_KEY</code>, and{" "}
                  <code className="text-zinc-400">OPENCLAW_SUPABASE_ACCESS_TOKEN</code>{" "}
                  (or <code className="text-zinc-400">SUPABASE_*</code>) so the Next.js dev
                  process inherits them (shell before <code className="text-zinc-400">pnpm dev</code>, launch config, IDE env, etc.). For in-app export,{" "}
                  <code className="text-zinc-400">openclaw_portal_defaults.json</code> or the
                  fields above are often easier.
                </li>
                <li>
                  Or a HAR (Advanced) with any successful PostgREST{" "}
                  <code className="text-zinc-400">GET</code>/<code className="text-zinc-400">HEAD</code>{" "}
                  to <code className="text-zinc-400">/rest/v1/…</code> that includes{" "}
                  <code className="text-zinc-400">apikey</code>, so the script can reuse URL and
                  anon key.
                </li>
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {runOk ? (
        <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-100/95">
          <p className="font-medium text-emerald-200">Exports finished</p>
          {exportPaths ? (
            <ul className="mt-2 list-none space-y-2 font-mono text-xs leading-relaxed text-zinc-300">
              <li>
                <span className="text-zinc-500">tasks_created_after_export.json — </span>
                {exportPaths.tasksJson}
              </li>
              <li>
                <span className="text-zinc-500">workflow-steps-by-task — </span>
                {exportPaths.workflowDir}
              </li>
            </ul>
          ) : (
            <p className="mt-2 text-xs text-zinc-400">
              Outputs are under{" "}
              <code className="rounded bg-zinc-900 px-1 text-zinc-300">
                {traceExportsPath}/
              </code>
              .
            </p>
          )}
        </div>
      ) : null}
      {runLogs ? (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Console output
          </p>
          <pre className="max-h-[480px] overflow-x-auto overflow-y-auto whitespace-pre rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs text-zinc-300">
            {runLogs}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
