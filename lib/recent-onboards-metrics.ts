import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const RECENT_ONBOARDS_JSON_REL = ["users", "users_recent_joins.json"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

type RawRecentOnboardTask = {
  id?: unknown;
  key?: unknown;
  task_lifecycle_status?: unknown;
  created_at?: unknown;
  env_key?: unknown;
  project_name?: unknown;
  project_key?: unknown;
};

type RawRecentOnboardMember = {
  id?: unknown;
  full_name?: unknown;
  email?: unknown;
  date_joined?: unknown;
  date_joined_raw?: unknown;
  task_count?: unknown;
  task_count_display?: unknown;
  task_limit?: unknown;
  has_more_tasks?: unknown;
  tasks?: unknown;
};

type RawRecentOnboardsFile = {
  total?: unknown;
  join_window_days?: unknown;
  task_limit?: unknown;
  run_time?: unknown;
  members?: unknown;
};

export type RecentOnboardMetricsTask = {
  id: string;
  key: string | null;
  lifecycleStatus: string | null;
  createdAtIso: string | null;
  envKey: string | null;
  projectName: string | null;
  projectKey: string | null;
};

export type RecentOnboardMetricsUser = {
  id: string;
  email: string;
  displayName: string;
  dateJoinedLabel: string | null;
  dateJoinedIso: string | null;
  totalTasksLabel: string;
  knownTaskCount: number;
  tasksLast7DaysLabel: string;
  tasksLast7DaysCount: number;
  tasksLast30DaysLabel: string;
  tasksLast30DaysCount: number;
  hasMoreTasks: boolean;
  taskLimit: number | null;
  tasks: RecentOnboardMetricsTask[];
};

export type RecentOnboardsSortKey = "joined" | "user" | "total" | "7d" | "30d";
export type RecentOnboardsSortDirection = "asc" | "desc";

export type RecentOnboardsViewOptions = {
  searchQuery: string;
  sortKey: RecentOnboardsSortKey;
  sortDirection: RecentOnboardsSortDirection;
};

export type RecentOnboardsMetrics = {
  filePath: string;
  fileExists: boolean;
  sourceTotal: number | null;
  joinWindowDays: number | null;
  taskLimit: number | null;
  runTimeIso: string | null;
  users: RecentOnboardMetricsUser[];
  usersWithTasks: number;
  knownTasks: number;
  knownTasksLast7Days: number;
  knownTasksLast30Days: number;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateMillis(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTask(raw: RawRecentOnboardTask): RecentOnboardMetricsTask | null {
  const id = stringValue(raw.id);
  if (!id) return null;
  return {
    id,
    key: stringValue(raw.key),
    lifecycleStatus: stringValue(raw.task_lifecycle_status),
    createdAtIso: stringValue(raw.created_at),
    envKey: stringValue(raw.env_key),
    projectName: stringValue(raw.project_name),
    projectKey: stringValue(raw.project_key),
  };
}

function countTasksSince(
  tasks: RecentOnboardMetricsTask[],
  now: Date,
  days: number,
): number {
  const nowMillis = now.getTime();
  const cutoff = nowMillis - days * DAY_MS;
  return tasks.filter((task) => {
    const t = dateMillis(task.createdAtIso);
    return t != null && t >= cutoff && t <= nowMillis;
  }).length;
}

function windowCount(
  tasks: RecentOnboardMetricsTask[],
  now: Date,
  days: number,
  hasMoreTasks: boolean,
): { count: number; label: string } {
  const count = countTasksSince(tasks, now, days);
  const oldestFetched = tasks.at(-1);
  const oldestFetchedMillis = dateMillis(oldestFetched?.createdAtIso ?? null);
  const cutoff = now.getTime() - days * DAY_MS;
  const hiddenTasksMayBeInWindow =
    hasMoreTasks && oldestFetchedMillis != null && oldestFetchedMillis >= cutoff;
  return { count, label: `${count}${hiddenTasksMayBeInWindow ? "+" : ""}` };
}

function normalizeMember(
  raw: RawRecentOnboardMember,
  now: Date,
): RecentOnboardMetricsUser | null {
  const id = stringValue(raw.id);
  const email = stringValue(raw.email);
  if (!id || !email) return null;

  const tasks = (Array.isArray(raw.tasks) ? raw.tasks : [])
    .map((task) => normalizeTask(task as RawRecentOnboardTask))
    .filter((task): task is RecentOnboardMetricsTask => Boolean(task))
    .sort((a, b) => (dateMillis(b.createdAtIso) ?? 0) - (dateMillis(a.createdAtIso) ?? 0));
  const hasMoreTasks = raw.has_more_tasks === true;
  const taskLimit = numberValue(raw.task_limit);
  const taskCountDisplay = stringValue(raw.task_count_display);
  const knownTaskCount = numberValue(raw.task_count) ?? tasks.length;
  const tasksLast7Days = windowCount(tasks, now, 7, hasMoreTasks);
  const tasksLast30Days = windowCount(tasks, now, 30, hasMoreTasks);

  return {
    id,
    email,
    displayName: stringValue(raw.full_name) ?? email,
    dateJoinedLabel: stringValue(raw.date_joined),
    dateJoinedIso: stringValue(raw.date_joined_raw),
    totalTasksLabel:
      taskCountDisplay ??
      `${knownTaskCount}${hasMoreTasks && taskLimit != null ? "+" : ""}`,
    knownTaskCount,
    tasksLast7DaysLabel: tasksLast7Days.label,
    tasksLast7DaysCount: tasksLast7Days.count,
    tasksLast30DaysLabel: tasksLast30Days.label,
    tasksLast30DaysCount: tasksLast30Days.count,
    hasMoreTasks,
    taskLimit,
    tasks,
  };
}

function userMatchesSearch(user: RecentOnboardMetricsUser, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    user.displayName,
    user.email,
    user.id,
  ].some((value) => value.toLowerCase().includes(q));
}

function sortValue(user: RecentOnboardMetricsUser, key: RecentOnboardsSortKey): string | number {
  switch (key) {
    case "user":
      return user.displayName.toLowerCase();
    case "total":
      return user.knownTaskCount;
    case "7d":
      return user.tasksLast7DaysCount;
    case "30d":
      return user.tasksLast30DaysCount;
    case "joined":
      return dateMillis(user.dateJoinedIso) ?? 0;
  }
}

function lastNameSortKey(user: RecentOnboardMetricsUser): string {
  const source =
    user.displayName === user.email
      ? user.email.split("@")[0] ?? user.email
      : user.displayName;
  const parts = source
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const last = parts.at(-1) ?? source;
  return `${last.toLowerCase()} ${source.toLowerCase()} ${user.email.toLowerCase()}`;
}

function compareUsers(
  a: RecentOnboardMetricsUser,
  b: RecentOnboardMetricsUser,
  key: RecentOnboardsSortKey,
): number {
  const av = sortValue(a, key);
  const bv = sortValue(b, key);
  if (typeof av === "number" && typeof bv === "number") {
    return av - bv;
  }
  return String(av).localeCompare(String(bv));
}

export function filterAndSortRecentOnboardUsers(
  users: RecentOnboardMetricsUser[],
  options: RecentOnboardsViewOptions,
): RecentOnboardMetricsUser[] {
  const direction = options.sortDirection === "asc" ? 1 : -1;
  return users
    .filter((user) => userMatchesSearch(user, options.searchQuery))
    .sort((a, b) => {
      const primary = compareUsers(a, b, options.sortKey) * direction;
      if (primary !== 0) return primary;
      return (
        compareUsers(a, b, "joined") * -1 ||
        compareUsers(a, b, "total") * -1 ||
        a.email.localeCompare(b.email)
      );
    });
}

export function filterRecentOnboardUsers(
  users: RecentOnboardMetricsUser[],
  searchQuery: string,
): RecentOnboardMetricsUser[] {
  return users.filter((user) => userMatchesSearch(user, searchQuery));
}

export function sortRecentOnboardUsersByLastName(
  users: RecentOnboardMetricsUser[],
): RecentOnboardMetricsUser[] {
  return [...users].sort((a, b) =>
    lastNameSortKey(a).localeCompare(lastNameSortKey(b)),
  );
}

export function getRecentOnboardsMetricsJsonPath(): string {
  return path.join(process.cwd(), ...RECENT_ONBOARDS_JSON_REL);
}

export function loadRecentOnboardsMetrics(now = new Date()): RecentOnboardsMetrics {
  const filePath = getRecentOnboardsMetricsJsonPath();
  if (!existsSync(filePath)) {
    return {
      filePath,
      fileExists: false,
      sourceTotal: null,
      joinWindowDays: null,
      taskLimit: null,
      runTimeIso: null,
      users: [],
      usersWithTasks: 0,
      knownTasks: 0,
      knownTasksLast7Days: 0,
      knownTasksLast30Days: 0,
    };
  }

  const raw = JSON.parse(readFileSync(filePath, "utf8")) as RawRecentOnboardsFile;
  const users = (Array.isArray(raw.members) ? raw.members : [])
    .map((member) => normalizeMember(member as RawRecentOnboardMember, now))
    .filter((member): member is RecentOnboardMetricsUser => Boolean(member))
    .sort(
      (a, b) =>
        (dateMillis(b.dateJoinedIso) ?? 0) - (dateMillis(a.dateJoinedIso) ?? 0) ||
        b.knownTaskCount - a.knownTaskCount ||
        a.email.localeCompare(b.email),
    );

  return {
    filePath,
    fileExists: true,
    sourceTotal: numberValue(raw.total),
    joinWindowDays: numberValue(raw.join_window_days),
    taskLimit: numberValue(raw.task_limit),
    runTimeIso: stringValue(raw.run_time),
    users,
    usersWithTasks: users.filter((user) => user.knownTaskCount > 0).length,
    knownTasks: users.reduce((sum, user) => sum + user.knownTaskCount, 0),
    knownTasksLast7Days: users.reduce(
      (sum, user) => sum + countTasksSince(user.tasks, now, 7),
      0,
    ),
    knownTasksLast30Days: users.reduce(
      (sum, user) => sum + countTasksSince(user.tasks, now, 30),
      0,
    ),
  };
}
