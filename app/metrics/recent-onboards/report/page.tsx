import Link from "next/link";
import { PrintReportButton } from "@/components/print-report-button";
import {
  filterRecentOnboardUsers,
  loadRecentOnboardsMetrics,
  sortRecentOnboardUsersByLastName,
  type RecentOnboardMetricsTask,
  type RecentOnboardMetricsUser,
} from "@/lib/recent-onboards-metrics";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recent Onboards PDF Report",
};

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function dateLabel(iso: string | null): string {
  if (!iso) return "—";
  return DATE_TIME_FORMATTER.format(new Date(iso));
}

function shortDateLabel(iso: string | null): string {
  if (!iso) return "—";
  return DATE_FORMATTER.format(new Date(iso));
}

function searchQueryFromParams(
  sp: Record<string, string | string[] | undefined>,
): string {
  return typeof sp.search === "string" ? sp.search : "";
}

function reportBackHref(searchQuery: string): string {
  const params = new URLSearchParams();
  if (searchQuery.trim()) params.set("search", searchQuery.trim());
  const qs = params.toString();
  return qs ? `/metrics/recent-onboards?${qs}` : "/metrics/recent-onboards";
}

function taskTitle(task: RecentOnboardMetricsTask): string {
  return task.key ?? task.id;
}

function SummaryTable({ users }: { users: RecentOnboardMetricsUser[] }) {
  return (
    <section className="report-section rounded-2xl border border-zinc-800 bg-zinc-950/35 p-5">
      <h2 className="text-lg font-semibold text-zinc-100">Summary</h2>
      <p className="report-muted mt-1 text-sm text-zinc-500">
        User counts from the recent-onboards export.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="report-table w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="py-2 pr-4">User</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Total</th>
              <th className="py-2 pr-4">7 days</th>
              <th className="py-2 pr-4">30 days</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-zinc-800">
                <td className="py-2 pr-4 text-zinc-100">{user.displayName}</td>
                <td className="py-2 pr-4 text-zinc-500">{user.email}</td>
                <td className="py-2 pr-4 font-[family-name:var(--font-mono)] text-zinc-200">
                  {user.totalTasksLabel}
                </td>
                <td className="py-2 pr-4 font-[family-name:var(--font-mono)] text-zinc-200">
                  {user.tasksLast7DaysLabel}
                </td>
                <td className="py-2 pr-4 font-[family-name:var(--font-mono)] text-zinc-200">
                  {user.tasksLast30DaysLabel}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TaskList({ tasks }: { tasks: RecentOnboardMetricsTask[] }) {
  if (tasks.length === 0) {
    return (
      <p className="report-muted mt-3 text-sm text-zinc-500">
        No tasks in export.
      </p>
    );
  }

  return (
    <ul className="mt-3 divide-y divide-zinc-800 rounded-xl border border-zinc-800">
      {tasks.map((task) => (
        <li key={task.id} className="grid gap-2 p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="font-[family-name:var(--font-mono)] text-xs text-zinc-200">
              {taskTitle(task)}
            </p>
            <time
              className="report-muted text-xs text-zinc-500"
              dateTime={task.createdAtIso ?? undefined}
            >
              {shortDateLabel(task.createdAtIso)}
            </time>
          </div>
          <p className="report-muted text-xs text-zinc-500">
            Lifecycle: {task.lifecycleStatus ?? "unknown"} · Env:{" "}
            {task.envKey ?? "unmapped"} · Project:{" "}
            {task.projectName ?? task.projectKey ?? "unknown project"}
          </p>
          {task.key ? (
            <p className="report-muted font-[family-name:var(--font-mono)] text-[11px] text-zinc-600">
              {task.id}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function UserTaskSection({ user }: { user: RecentOnboardMetricsUser }) {
  return (
    <section className="report-section break-inside-avoid rounded-2xl border border-zinc-800 bg-zinc-950/35 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">{user.displayName}</h2>
          <p className="report-muted mt-1 text-sm text-zinc-500">{user.email}</p>
          <p className="report-muted mt-1 text-xs text-zinc-600">
            Joined {user.dateJoinedLabel ?? shortDateLabel(user.dateJoinedIso)}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-3 text-right text-sm">
          <div>
            <dt className="report-muted text-xs uppercase tracking-wide text-zinc-600">
              Total
            </dt>
            <dd className="font-[family-name:var(--font-mono)] text-zinc-100">
              {user.totalTasksLabel}
            </dd>
          </div>
          <div>
            <dt className="report-muted text-xs uppercase tracking-wide text-zinc-600">
              7d
            </dt>
            <dd className="font-[family-name:var(--font-mono)] text-zinc-100">
              {user.tasksLast7DaysLabel}
            </dd>
          </div>
          <div>
            <dt className="report-muted text-xs uppercase tracking-wide text-zinc-600">
              30d
            </dt>
            <dd className="font-[family-name:var(--font-mono)] text-zinc-100">
              {user.tasksLast30DaysLabel}
            </dd>
          </div>
        </dl>
      </div>
      {user.hasMoreTasks ? (
        <p className="mt-3 rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-100/90">
          Showing latest {user.taskLimit ?? user.tasks.length} tasks; more tasks exist.
        </p>
      ) : null}
      <TaskList tasks={user.tasks} />
    </section>
  );
}

export default async function RecentOnboardsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const searchQuery = searchQueryFromParams(sp);
  const trimmedSearchQuery = searchQuery.trim();
  const metrics = loadRecentOnboardsMetrics();
  const users = sortRecentOnboardUsersByLastName(
    filterRecentOnboardUsers(metrics.users, searchQuery),
  );

  return (
    <div className="insights-report-print report-page mx-auto flex max-w-5xl flex-col gap-8 px-5 py-10 text-zinc-100">
      <style>{`
        @page { margin: 0.55in; }
        .report-table { border-collapse: collapse; }
        @media print {
          html,
          body,
          body > div,
          main {
            background: #ffffff !important;
            color: #111827 !important;
          }
          body > div > header { display: none !important; }
          main { min-height: 0 !important; }
          .report-page {
            display: block !important;
            visibility: visible !important;
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: none !important;
            padding: 0 !important;
            color: #111827 !important;
            background: #ffffff !important;
          }
          .report-page,
          .report-page * {
            visibility: visible !important;
            color: #111827 !important;
            text-shadow: none !important;
            box-shadow: none !important;
          }
          .report-section {
            break-inside: avoid;
            page-break-inside: avoid;
            border-color: #d4d4d8 !important;
            background: #ffffff !important;
          }
          .report-muted,
          .report-page .report-muted,
          .report-page .report-muted * {
            color: #52525b !important;
          }
          .report-table th,
          .report-table td,
          .report-table tr,
          .report-page li,
          .report-page ul {
            border-color: #d4d4d8 !important;
          }
          .no-print { display: none !important; }
          a { color: inherit !important; text-decoration: none !important; }
        }
      `}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <Link
          href={reportBackHref(searchQuery)}
          className="text-sm text-zinc-500 underline-offset-2 hover:text-amber-200/90 hover:underline"
        >
          Back to Recent Onboards
        </Link>
        <PrintReportButton />
      </div>

      <header className="border-b border-zinc-800 pb-6">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          Metrics / Recent Onboards
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
          Recent Onboards Task Report
        </h1>
        <p className="report-muted mt-3 text-sm text-zinc-500">
          {users.length.toLocaleString()} user{users.length === 1 ? "" : "s"} ·
          Source run {dateLabel(metrics.runTimeIso)} · Join window{" "}
          {metrics.joinWindowDays ?? "—"} days · Task cap {metrics.taskLimit ?? "—"}
        </p>
        {trimmedSearchQuery ? (
          <p className="report-muted mt-1 text-sm text-zinc-500">
            Search filter: &quot;{trimmedSearchQuery}&quot;
          </p>
        ) : null}
      </header>

      {!metrics.fileExists ? (
        <section className="report-section rounded-2xl border border-zinc-800 bg-zinc-950/35 p-6">
          <p className="text-zinc-500">
            Could not find <code>users/users_recent_joins.json</code>. Run{" "}
            <code>scripts/user_export/fetch_all_users.py --recent-joins</code> first.
          </p>
        </section>
      ) : users.length === 0 ? (
        <section className="report-section rounded-2xl border border-zinc-800 bg-zinc-950/35 p-6">
          <p className="text-zinc-500">No recent onboard users match this report filter.</p>
        </section>
      ) : (
        <>
          <SummaryTable users={users} />
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-zinc-100">
              Users and tasks
            </h2>
            {users.map((user) => (
              <UserTaskSection key={user.id} user={user} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}
