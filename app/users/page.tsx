import Link from "next/link";
import {
  buildUserDirectory,
  encodeUserKeyForPath,
  filterUserDirectoryByNameOrEmail,
  secondaryContactEmailLine,
} from "@/lib/users-directory";
import { prisma } from "@/lib/prisma";
import { loadUserDisplayNames } from "@/lib/users-lookup";

export const dynamic = "force-dynamic";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const searchQuery =
    typeof sp.search === "string" ? sp.search : "";

  const nameByUserId = loadUserDisplayNames();
  const allUsers = await buildUserDirectory(prisma, nameByUserId);
  const users = filterUserDirectoryByNameOrEmail(allUsers, searchQuery);
  const searchActive = searchQuery.trim().length > 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 px-5 py-14">
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          Directory
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
          Users
        </h1>
        <p className="mt-3 text-zinc-400">
          People who have at least one prompt (with a creator id) and/or feedback record. Select a
          user to see their items.
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/35 p-5">
        <p className="mb-3 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-zinc-500">
          Search
        </p>
        <form method="get" action="/users" className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[min(100%,280px)] flex-1 flex-col gap-1 text-sm text-zinc-500">
            <span>Name or email</span>
            <input
              type="search"
              name="search"
              defaultValue={searchQuery}
              placeholder="e.g. Taylor or taylor@company.com"
              autoComplete="off"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-500"
          >
            Search
          </button>
          {searchActive ? (
            <Link
              href="/users"
              className="text-sm text-zinc-500 underline-offset-2 hover:text-amber-200/90 hover:underline"
            >
              Clear
            </Link>
          ) : null}
        </form>
        {searchActive ? (
          <p className="mt-3 text-xs text-zinc-500">
            Showing {users.length} of {allUsers.length} user{allUsers.length === 1 ? "" : "s"}
            {users.length === 0 ? " — try a shorter or different term" : ""}
          </p>
        ) : null}
      </section>

      {allUsers.length === 0 ? (
        <section className="rounded-2xl border border-zinc-800 py-16 text-center text-zinc-500">
          No users found yet. Import prompts with <code className="text-zinc-400">created_by</code>{" "}
          in task metadata, or add feedback with author fields.
        </section>
      ) : users.length === 0 ? (
        <section className="rounded-2xl border border-zinc-800 py-16 text-center text-zinc-500">
          No users match <span className="text-zinc-400">&quot;{searchQuery.trim()}&quot;</span>.{" "}
          <Link href="/users" className="text-amber-200/90 hover:underline">
            Clear search
          </Link>
        </section>
      ) : (
        <ul className="flex flex-col gap-2">
          {users.map((u) => {
            const emailLine = secondaryContactEmailLine({
              key: u.key,
              displayName: u.displayName,
              contactEmail: u.contactEmail,
            });
            return (
            <li key={u.key}>
              <Link
                href={`/users/${encodeUserKeyForPath(u.key)}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800/90 bg-zinc-900/35 px-5 py-4 transition hover:border-zinc-700 hover:bg-zinc-900/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-zinc-100">{u.displayName}</div>
                  {emailLine ? (
                    <div className="mt-0.5 truncate text-sm text-zinc-500">{emailLine}</div>
                  ) : null}
                </div>
                <span className="flex flex-wrap gap-3 text-xs text-zinc-500">
                  {u.promptCount > 0 ? (
                    <span>
                      {u.promptCount} prompt{u.promptCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  {u.feedbackCount > 0 ? (
                    <span>
                      {u.feedbackCount} feedback record{u.feedbackCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
