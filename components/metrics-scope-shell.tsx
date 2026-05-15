"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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

const TABS: { href: string; label: string; match: (path: string) => boolean }[] =
  [
    {
      href: "/metrics",
      label: "Overview",
      match: (path) => path === "/metrics",
    },
    {
      href: "/metrics/prompts",
      label: "Prompts",
      match: (path) => path === "/metrics/prompts",
    },
    {
      href: "/metrics/feedback",
      label: "Feedback",
      match: (path) => path === "/metrics/feedback",
    },
    {
      href: "/metrics/recent-onboards",
      label: "Recent Onboards",
      match: (path) => path === "/metrics/recent-onboards",
    },
  ];

export function MetricsScopeShell(props: {
  scopeLabel: string;
  projectFilter: ProjectFilter;
  projectFilterOptions: ProjectFilter[];
  envFilter: EnvFilter;
  envFilterOptions: EnvFilter[];
  hideScopeControls?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const suffix = qs ? `?${qs}` : "";

  function applyProjectFilter(next: ProjectFilter) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") {
      params.delete("project");
    } else {
      params.set("project", serializeProjectQueryValue(next));
    }
    params.delete("env");
    const nextQs = params.toString();
    router.push(nextQs ? `${pathname}?${nextQs}` : pathname, { scroll: false });
  }

  function applyEnvFilter(next: EnvFilter) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") {
      params.delete("env");
    } else {
      params.set("env", serializeEnvQueryValue(next));
    }
    const nextQs = params.toString();
    router.push(nextQs ? `${pathname}?${nextQs}` : pathname, { scroll: false });
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 px-5 py-14">
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          Analytics
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
          Metrics
        </h1>
        <p className="mt-3 max-w-2xl text-lg leading-relaxed text-zinc-400">
          Prompt rubrics, QA feedback, and reviewer outcomes — scoped the same way as
          the library (import project + evaluation environment).
        </p>

        <nav
          className="mt-8 flex flex-wrap gap-2 border-b border-zinc-800/80 pb-px"
          aria-label="Metrics sections"
        >
          {TABS.map((tab) => {
            const active = tab.match(pathname);
            return (
              <Link
                key={tab.href}
                href={`${tab.href}${suffix}`}
                className={
                  active
                    ? "relative -mb-px border-b-2 border-amber-500/90 px-4 py-2.5 text-sm font-medium text-zinc-100"
                    : "border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-zinc-500 transition hover:text-zinc-200"
                }
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {props.hideScopeControls ? null : (
        <section className="flex flex-wrap items-end gap-4 rounded-2xl border border-dashed border-zinc-700/80 bg-zinc-950/40 px-4 py-4 sm:px-5">
          <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
            <span>Project</span>
            <select
              value={serializeProjectQueryValue(props.projectFilter)}
              onChange={(e) =>
                applyProjectFilter(parseProjectFilter({ project: e.target.value }))
              }
              className="min-w-[12rem] rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-700/80"
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
          <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
            <span>Environment</span>
            <select
              value={serializeEnvQueryValue(props.envFilter)}
              onChange={(e) =>
                applyEnvFilter(parseEnvFilter({ env: e.target.value }))
              }
              className="min-w-[14rem] rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-700/80"
            >
              {props.envFilterOptions.map((opt) => (
                <option key={serializeEnvQueryValue(opt)} value={serializeEnvQueryValue(opt)}>
                  {getEnvFilterShortLabel(opt)}
                </option>
              ))}
            </select>
          </label>
          <p className="ml-auto text-xs text-zinc-600">
            Scope: <span className="text-zinc-400">{props.scopeLabel}</span>
          </p>
        </section>
      )}

      {props.children}
    </div>
  );
}
