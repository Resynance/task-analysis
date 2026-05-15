"use client";

import { useRef } from "react";
import { MentorshipAddMemberForm } from "@/components/mentorship-add-member-form";
import type { UserDirectoryEntry } from "@/lib/users-directory";

type Props = {
  podId: string;
  directory: UserDirectoryEntry[];
  memberKeysInPod: string[];
};

export function MentorshipAddMemberModal(props: Props) {
  const { podId, directory, memberKeysInPod } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);

  function openModal() {
    dialogRef.current?.showModal();
  }

  function closeModal() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-900/60"
      >
        Add Member
      </button>

      <dialog
        ref={dialogRef}
        className="fixed left-1/2 top-1/2 z-[200] m-0 max-h-[min(90vh,720px)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-950 p-0 text-zinc-200 shadow-2xl [&::backdrop]:bg-black/70"
        aria-labelledby="add-member-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeModal();
        }}
      >
        {/* Inner layout stays off <dialog>: WebKit can swallow clicks on buttons when the dialog uses display:grid. */}
        <div className="flex max-h-[min(90vh,720px)] flex-col">
          <div className="relative z-10 shrink-0 border-b border-zinc-800/80 bg-zinc-950 px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id="add-member-title" className="text-lg font-semibold text-zinc-50">
                  Add Member
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Search the user directory by display name, email, or key, then choose a role.
                  Adding someone who is already in the pod updates their role.
                </p>
              </div>
              {/* Native dialog close — reliable in Safari; avoids JS close() quirks */}
              <form method="dialog" className="shrink-0">
                <button
                  type="submit"
                  className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
                >
                  Close
                </button>
              </form>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <MentorshipAddMemberForm
              podId={podId}
              directory={directory}
              memberKeysInPod={memberKeysInPod}
              afterSuccess={closeModal}
              className="flex flex-col gap-4"
            />
          </div>
        </div>
      </dialog>
    </>
  );
}
