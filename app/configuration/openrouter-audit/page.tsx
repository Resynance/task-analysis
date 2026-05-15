import Link from "next/link";
import { getOpenRouterApiAuditLogDb } from "@/lib/openrouter-audit-prisma";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type AuditRow = {
  id: string;
  createdAt: Date;
  source: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  completionId: string | null;
};

function parsePage(raw: string | string[] | undefined): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(s ?? "1", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function formatUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(n);
}

function formatTokens(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

export default async function OpenRouterAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const audit = getOpenRouterApiAuditLogDb();
  if (!audit) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-14">
        <div>
          <Link
            href="/configuration"
            className="text-sm text-zinc-500 transition hover:text-amber-200/90"
          >
            ← Back to configuration
          </Link>
        </div>
        <header className="border-b border-zinc-800/80 pb-6">
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-zinc-50">
            OpenRouter audit log
          </h1>
        </header>
        <div className="rounded-2xl border border-amber-900/40 bg-amber-950/20 px-5 py-6 text-sm leading-relaxed text-amber-100/90">
          <p className="font-medium text-amber-50/95">Prisma client is out of date</p>
          <p className="mt-2 text-amber-100/80">
            The running app does not include the <code className="text-amber-200/90">OpenRouterApiAuditLog</code>{" "}
            model (the generated client under <code className="text-amber-200/90">generated/</code>{" "}
            is gitignored and must match your schema).
          </p>
          <p className="mt-3 font-mono text-xs text-amber-200/70">
            npx prisma generate
            <br />
            npx prisma db push
          </p>
          <p className="mt-3 text-xs text-amber-200/60">
            Then restart the dev server (<code className="text-amber-200/80">npm run dev</code>) so
            Next.js reloads the new client.
          </p>
        </div>
      </div>
    );
  }

  const sp = await searchParams;
  const pageParsed = parsePage(sp.page);

  const total = await audit.count();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageSafe = Math.min(Math.max(1, pageParsed), totalPages);
  const skip = (pageSafe - 1) * PAGE_SIZE;

  const [rowsRaw, sumAgg] = await Promise.all([
    audit.findMany({
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip,
      select: {
        id: true,
        createdAt: true,
        source: true,
        model: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        costUsd: true,
        completionId: true,
      },
    }),
    audit.aggregate({
      _sum: { costUsd: true },
    }),
  ]);

  const rows = rowsRaw as AuditRow[];

  const sumCost = sumAgg._sum.costUsd;

  const prevHref =
    pageSafe > 1
      ? `/configuration/openrouter-audit?page=${pageSafe - 1}`
      : null;
  const nextHref =
    pageSafe < totalPages
      ? `/configuration/openrouter-audit?page=${pageSafe + 1}`
      : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-14">
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
          Configuration / Observability
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
          OpenRouter audit log
        </h1>
        <p className="mt-3 max-w-3xl text-zinc-400">
          Each row is one successful in-app chat completion when the LLM provider is{" "}
          <strong className="font-medium text-zinc-300">OpenRouter</strong>. Token counts come
          from the API response; <strong className="font-medium text-zinc-300">Cost</strong> uses
          OpenRouter&rsquo;s <code className="text-zinc-300">usage.cost</code> field when present.
          Local <strong className="font-medium text-zinc-300">LM Studio</strong> calls are not
          logged here.
        </p>
        <p className="mt-3 text-sm text-zinc-500">
          Total logged calls:{" "}
          <span className="text-zinc-300">{total.toLocaleString("en-US")}</span>
          {sumCost != null && Number.isFinite(sumCost) ? (
            <>
              {" "}
              · Sum of recorded costs:{" "}
              <span className="text-zinc-300">{formatUsd(sumCost)}</span>
            </>
          ) : null}
        </p>
        <p className="mt-3 text-xs text-zinc-600">
          Subprocess or browser-only OpenRouter usage (for example external audit scripts) is not
          captured here—only completions created through this app&rsquo;s shared server helper.
        </p>
      </header>

      {total === 0 ? (
        <p className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 px-5 py-8 text-sm text-zinc-400">
          No rows yet. Entries appear after you run flows that call the shared LLM helper while
          OpenRouter is the active provider (for example prompt analysis, coaching insights, or
          dataset QA).
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-zinc-800/90 bg-zinc-900/40">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800/80 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-3 font-medium">Time (UTC)</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 text-right font-medium">In</th>
                  <th className="px-4 py-3 text-right font-medium">Out</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody className="text-zinc-200">
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30"
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-zinc-400">
                      {r.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-2.5 text-zinc-300" title={r.source}>
                      {r.source}
                    </td>
                    <td
                      className="max-w-[220px] truncate px-4 py-2.5 text-zinc-400"
                      title={r.model}
                    >
                      {r.model || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-xs text-zinc-400">
                      {formatTokens(r.promptTokens)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-xs text-zinc-400">
                      {formatTokens(r.completionTokens)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-xs text-zinc-400">
                      {formatTokens(r.totalTokens)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-xs text-amber-200/90">
                      {formatUsd(r.costUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav className="flex items-center justify-between gap-4 text-sm text-zinc-400">
            <span>
              Page {pageSafe} of {totalPages}
            </span>
            <div className="flex gap-3">
              {prevHref ? (
                <Link
                  href={prevHref}
                  className="rounded-full border border-zinc-700/80 px-4 py-1.5 text-zinc-200 transition hover:border-amber-700/50 hover:text-amber-100/90"
                >
                  Previous
                </Link>
              ) : (
                <span className="cursor-not-allowed rounded-full border border-zinc-800/50 px-4 py-1.5 text-zinc-600">
                  Previous
                </span>
              )}
              {nextHref ? (
                <Link
                  href={nextHref}
                  className="rounded-full border border-zinc-700/80 px-4 py-1.5 text-zinc-200 transition hover:border-amber-700/50 hover:text-amber-100/90"
                >
                  Next
                </Link>
              ) : (
                <span className="cursor-not-allowed rounded-full border border-zinc-800/50 px-4 py-1.5 text-zinc-600">
                  Next
                </span>
              )}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
