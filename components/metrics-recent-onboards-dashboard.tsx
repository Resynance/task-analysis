import Link from "next/link";
import { MetricCard } from "@/components/metrics-shared";
import type {
  RecentOnboardMetricsTask,
  RecentOnboardMetricsUser,
  RecentOnboardsMetrics,
  RecentOnboardsSortKey,
  RecentOnboardsViewOptions,
} from "@/lib/recent-onboards-metrics";
import { filterAndSortRecentOnboardUsers } from "@/lib/recent-onboards-metrics";
import { encodeUserKeyForPath } from "@/lib/users-directory";

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

function addSearchParam(params: URLSearchParams, searchQuery: string): void {
  const trimmedSearchQuery = searchQuery.trim();
  if (trimmedSearchQuery) params.set("search", trimmedSearchQuery);
}

function recentOnboardsHref(
  view: RecentOnboardsViewOptions,
  overrides: Partial<RecentOnboardsViewOptions> = {},
): string {
  const next = { ...view, ...overrides };
  const params = new URLSearchParams();
  addSearchParam(params, next.searchQuery);
  if (next.sortKey !== "joined") params.set("sort", next.sortKey);
  if (next.sortDirection !== "desc") params.set("dir", next.sortDirection);
  const qs = params.toString();
  return qs ? `/metrics/recent-onboards?${qs}` : "/metrics/recent-onboards";
}

function recentOnboardsReportHref(view: RecentOnboardsViewOptions): string {
  const params = new URLSearchParams();
  addSearchParam(params, view.searchQuery);
  const qs = params.toString();
  return qs
    ? `/metrics/recent-onboards/report?${qs}`
    : "/metrics/recent-onboards/report";
}

function SortHeader({
  label,
  sortKey,
  view,
  className = "",
}: {
  label: string;
  sortKey: RecentOnboardsSortKey;
  view: RecentOnboardsViewOptions;
  className?: string;
}) {
  const active = view.sortKey === sortKey;
  const nextDirection =
    active && view.sortDirection === "desc" ? "asc" : "desc";
  return (
    <Link
      href={recentOnboardsHref(view, {
        sortKey,
        sortDirection: nextDirection,
      })}
      className={`${className} underline-offset-2 transition hover:text-amber-200/90 hover:underline ${
        active ? "text-zinc-300" : ""
      }`}
      title={`Sort by ${label}`}
    >
      {label}
      {active ? (view.sortDirection === "desc" ? " ↓" : " ↑") : ""}
    </Link>
  );
}

function UserLink({ user }: { user: RecentOnboardMetricsUser }) {
  return (
    <Link
      href={`/users/${encodeUserKeyForPath(`id:${user.id.toLowerCase()}`)}`}
      className="font-medium text-zinc-100 underline-offset-2 hover:text-amber-200/90 hover:underline"
    >
      {user.displayName}
    </Link>
  );
}

function TaskRow({ task }: { task: RecentOnboardMetricsTask }) {
  return (
    <li className="grid gap-3 border-t border-zinc-800/70 px-4 py-3 text-sm md:grid-cols-[minmax(0,1.4fr)_8rem_8rem_minmax(0,1fr)_9rem]">
      <div className="min-w-0">
        <p className="truncate font-[family-name:var(--font-mono)] text-xs text-zinc-300">
          {task.key ?? task.id}
        </p>
        {task.key ? (
          <p className="mt-0.5 truncate font-[family-name:var(--font-mono)] text-[11px] text-zinc-600">
            {task.id}
          </p>
        ) : null}
      </div>
      <div className="text-zinc-400">{task.lifecycleStatus ?? "unknown"}</div>
      <div className="text-zinc-400">{task.envKey ?? "unmapped"}</div>
      <div className="min-w-0 truncate text-zinc-400">
        {task.projectName ?? task.projectKey ?? "unknown project"}
      </div>
      <time className="text-zinc-500" dateTime={task.createdAtIso ?? undefined}>
        {shortDateLabel(task.createdAtIso)}
      </time>
    </li>
  );
}

function OnboardRow({ user }: { user: RecentOnboardMetricsUser }) {
  return (
    <details className="group rounded-2xl border border-zinc-800/90 bg-zinc-950/45">
      <summary className="grid cursor-pointer list-none gap-4 px-5 py-4 marker:hidden md:grid-cols-[minmax(0,1.5fr)_7rem_7rem_7rem_8rem] md:items-center [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <UserLink user={user} />
          <p className="mt-1 truncate text-sm text-zinc-500">{user.email}</p>
          <p className="mt-1 text-xs text-zinc-600">
            Joined {user.dateJoinedLabel ?? shortDateLabel(user.dateJoinedIso)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-600">Total tasks</p>
          <p className="mt-1 font-[family-name:var(--font-mono)] text-lg text-zinc-100">
            {user.totalTasksLabel}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-600">Past 7 days</p>
          <p className="mt-1 font-[family-name:var(--font-mono)] text-lg text-zinc-100">
            {user.tasksLast7DaysLabel}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-600">Past 30 days</p>
          <p className="mt-1 font-[family-name:var(--font-mono)] text-lg text-zinc-100">
            {user.tasksLast30DaysLabel}
          </p>
        </div>
        <div className="text-sm text-zinc-500 md:text-right">
          <span className="group-open:hidden">Expand tasks</span>
          <span className="hidden group-open:inline">Collapse</span>
        </div>
      </summary>

      <div className="border-t border-zinc-800/80 bg-zinc-950/40">
        {user.hasMoreTasks ? (
          <p className="px-4 py-3 text-xs text-amber-200/80">
            Showing latest {user.taskLimit ?? user.tasks.length} tasks; more tasks exist.
          </p>
        ) : null}
        {user.tasks.length === 0 ? (
          <p className="px-4 py-5 text-sm text-zinc-500">No tasks in the export.</p>
        ) : (
          <ul>
            <li className="hidden gap-3 px-4 py-2 text-[11px] uppercase tracking-[0.16em] text-zinc-600 md:grid md:grid-cols-[minmax(0,1.4fr)_8rem_8rem_minmax(0,1fr)_9rem]">
              <span>Task</span>
              <span>Lifecycle</span>
              <span>Env</span>
              <span>Project</span>
              <span>Created</span>
            </li>
            {user.tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

export function MetricsRecentOnboardsDashboard({
  metrics,
  view,
}: {
  metrics: RecentOnboardsMetrics;
  view: RecentOnboardsViewOptions;
}) {
  if (!metrics.fileExists) {
    return (
      <section className="rounded-2xl border border-zinc-800/90 bg-zinc-950/40 p-8 text-zinc-500">
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-zinc-100">
          Recent Onboards
        </h2>
        <p className="mt-3 text-sm">
          Could not find <code className="text-zinc-300">users/users_recent_joins.json</code>.
          Run{" "}
          <code className="text-zinc-300">
            scripts/user_export/fetch_all_users.py --recent-joins
          </code>{" "}
          to generate it.
        </p>
      </section>
    );
  }

  const users = filterAndSortRecentOnboardUsers(metrics.users, view);
  const searchActive = view.searchQuery.trim().length > 0;
  const sortedByDefault =
    view.sortKey === "joined" && view.sortDirection === "desc";

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-zinc-100">
          Recent Onboards
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-500">
          Users from <code className="text-zinc-300">users/users_recent_joins.json</code>.
          Accounts matching <code className="text-zinc-300">EXPORT_EXCLUDED_EMAIL_SUFFIX</code>{" "}
          (when set) and recent users with QA permissions are excluded by the export script.
        </p>
        <p className="mt-2 text-xs text-zinc-600">
          Source run: {dateLabel(metrics.runTimeIso)} · Join window:{" "}
          {metrics.joinWindowDays ?? "—"} days · Task cap: {metrics.taskLimit ?? "—"}
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Recent users"
          value={metrics.users.length}
          hint="After export filters"
        />
        <MetricCard
          label="Users with tasks"
          value={metrics.usersWithTasks}
          hint="Known tasks > 0"
        />
        <MetricCard
          label="Known tasks (7d)"
          value={metrics.knownTasksLast7Days}
          hint="From exported task lists"
        />
        <MetricCard
          label="Known tasks (30d)"
          value={metrics.knownTasksLast30Days}
          hint="From exported task lists"
        />
      </section>

      <section className="rounded-2xl border border-dashed border-zinc-700/80 bg-zinc-950/35 p-4 sm:p-5">
        <form
          action="/metrics/recent-onboards"
          method="get"
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex min-w-[min(100%,280px)] flex-1 flex-col gap-1.5 text-sm text-zinc-500">
            <span>Search user</span>
            <input
              type="search"
              name="search"
              defaultValue={view.searchQuery}
              placeholder="Name, email, or user id"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-zinc-500">
            <span>Sort by</span>
            <select
              name="sort"
              defaultValue={view.sortKey}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
            >
              <option value="joined">Join date</option>
              <option value="user">User</option>
              <option value="total">Total tasks</option>
              <option value="7d">Past 7 days</option>
              <option value="30d">Past 30 days</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-zinc-500">
            <span>Direction</span>
            <select
              name="dir"
              defaultValue={view.sortDirection}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </label>
          <button
            type="submit"
            className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-500"
          >
            Apply
          </button>
          <Link
            href={recentOnboardsReportHref(view)}
            className="rounded-lg border border-amber-800/70 bg-amber-950/20 px-3 py-2 text-sm text-amber-100/90 transition hover:border-amber-600/80 hover:bg-amber-900/25"
          >
            PDF report
          </Link>
          {searchActive || !sortedByDefault ? (
            <Link
              href="/metrics/recent-onboards"
              className="text-sm text-zinc-500 underline-offset-2 hover:text-amber-200/90 hover:underline"
            >
              Reset
            </Link>
          ) : null}
        </form>
        <p className="mt-3 text-xs text-zinc-600">
          Showing {users.length.toLocaleString()} of{" "}
          {metrics.users.length.toLocaleString()} recent onboard users.
        </p>
      </section>

      {metrics.users.length === 0 ? (
        <section className="rounded-2xl border border-zinc-800 py-16 text-center text-zinc-500">
          No recent onboard users matched the export filters.
        </section>
      ) : users.length === 0 ? (
        <section className="rounded-2xl border border-zinc-800 py-16 text-center text-zinc-500">
          No recent onboard users match{" "}
          <span className="text-zinc-400">&quot;{view.searchQuery.trim()}&quot;</span>.
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <div className="grid gap-4 px-5 text-xs uppercase tracking-[0.16em] text-zinc-600 md:grid-cols-[minmax(0,1.5fr)_7rem_7rem_7rem_8rem]">
            <SortHeader label="User" sortKey="user" view={view} />
            <SortHeader label="Total" sortKey="total" view={view} />
            <SortHeader label="7 days" sortKey="7d" view={view} />
            <SortHeader label="30 days" sortKey="30d" view={view} />
            <span className="md:text-right">Tasks</span>
          </div>
          {users.map((user) => (
            <OnboardRow key={user.id} user={user} />
          ))}
        </section>
      )}
    </div>
  );
}
