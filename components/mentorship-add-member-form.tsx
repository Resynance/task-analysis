"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertPodMemberAction } from "@/app/mentorship/actions";
import type { UserDirectoryEntry } from "@/lib/users-directory";
import { filterUserDirectoryByNameOrEmail } from "@/lib/users-directory";

export function MentorshipAddMemberForm(props: {
  podId: string;
  directory: UserDirectoryEntry[];
  memberKeysInPod: string[];
  /** Runs on the client after a successful add/update (e.g. close a modal). */
  afterSuccess?: () => void;
  /** Extra classes on the form element. */
  className?: string;
}) {
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const memberSet = useMemo(
    () => new Set(props.memberKeysInPod),
    [props.memberKeysInPod],
  );

  const filtered = useMemo(
    () => filterUserDirectoryByNameOrEmail(props.directory, search),
    [props.directory, search],
  );

  useEffect(() => {
    if (
      selectedKey &&
      !filtered.some((u) => u.key === selectedKey)
    ) {
      setSelectedKey("");
    }
  }, [filtered, selectedKey]);

  const searchActive = search.trim().length > 0;

  return (
    <form
      className={props.className ?? "mt-4 flex flex-col gap-4"}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          await upsertPodMemberAction(fd);
          props.afterSuccess?.();
          router.refresh();
        });
      }}
    >
      <input type="hidden" name="podId" value={props.podId} />

      <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
        <span>Search by name or email</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Type to filter the directory…"
          autoComplete="off"
          disabled={pending}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 disabled:opacity-60"
        />
      </label>

      {searchActive ? (
        <p className="text-xs text-zinc-500" aria-live="polite">
          {filtered.length === 0
            ? "No users match this search."
            : `Showing ${filtered.length} of ${props.directory.length} user${
                props.directory.length === 1 ? "" : "s"
              }`}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex min-w-[min(100%,18rem)] flex-1 flex-col gap-1.5 text-sm text-zinc-400">
          <span>User</span>
          <select
            name="userKey"
            required
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            disabled={pending}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 disabled:opacity-60"
          >
            <option value="">Select…</option>
            {filtered.map((u) => (
              <option key={u.key} value={u.key}>
                {u.displayName}
                {memberSet.has(u.key) ? " (in pod)" : ""}
                {" · "}
                {u.key}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
          <span>Role</span>
          <select
            name="role"
            required
            disabled={pending}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 disabled:opacity-60"
          >
            <option value="MENTOR">Mentor</option>
            <option value="MENTEE">Mentee</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-amber-800/80 bg-amber-950/40 px-4 py-2 text-sm font-medium text-amber-100 transition hover:bg-amber-950/70 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Add or update"}
        </button>
      </div>
    </form>
  );
}
