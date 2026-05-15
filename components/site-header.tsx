import Link from "next/link";
import { LlmStatusBadge } from "@/components/llm-status-badge";
import { OpenRouterCreditsBadge } from "@/components/openrouter-credits-badge";
import { getSpecialProjectUiLabels } from "@/lib/special-project-labels";

export async function SiteHeader() {
  const sp = getSpecialProjectUiLabels();
  const nav = [
    { href: "/", label: "Prompts" },
    { href: "/feedback", label: "Feedback" },
    { href: "/users", label: "Users" },
    { href: "/mentorship", label: "Mentorship" },
    { href: "/flags", label: "Flags" },
    { href: "/reports", label: "Reports" },
    { href: "/special-projects", label: sp.projectsNavLabel },
    { href: "/metrics", label: "Metrics" },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-3">
          <Link
            href="/"
            className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight text-zinc-100"
          >
            Task Analysis
          </Link>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-zinc-500 transition hover:text-amber-200/90"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:shrink-0">
          <OpenRouterCreditsBadge />
          <LlmStatusBadge />
          <Link
            href="/configuration"
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-zinc-700/90 bg-zinc-900/55 p-2 text-zinc-400 transition hover:border-zinc-500 hover:bg-zinc-900/80 hover:text-amber-200/90"
            aria-label="Configuration"
            title="Configuration"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5"
              aria-hidden
            >
              <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.37.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.139-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.217.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
            </svg>
          </Link>
        </div>
      </div>
    </header>
  );
}
