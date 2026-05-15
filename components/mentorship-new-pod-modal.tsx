"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPodAction } from "@/app/mentorship/actions";

export function MentorshipNewPodModal() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function openModal() {
    dialogRef.current?.showModal();
  }

  function closeModal() {
    dialogRef.current?.close();
    formRef.current?.reset();
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded-lg border border-amber-800/70 bg-amber-950/35 px-4 py-2 text-sm font-medium text-amber-100 transition hover:border-amber-700/90 hover:bg-amber-950/55"
      >
        New pod
      </button>

      <dialog
        ref={dialogRef}
        className="fixed left-1/2 top-1/2 z-[200] m-0 max-h-[min(90vh,640px)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-950 p-0 text-zinc-200 shadow-2xl [&::backdrop]:bg-black/70"
        aria-labelledby="new-pod-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeModal();
        }}
        onClose={() => formRef.current?.reset()}
      >
        <div className="flex max-h-[min(90vh,640px)] flex-col">
          <div className="relative z-10 shrink-0 border-b border-zinc-800/80 bg-zinc-950 px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id="new-pod-title" className="text-lg font-semibold text-zinc-50">
                  Create pod
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Name your pod and optionally add a short description for your team.
                </p>
              </div>
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
            <form
              ref={formRef}
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                startTransition(async () => {
                  await createPodAction(fd);
                  closeModal();
                  router.refresh();
                });
              }}
            >
              <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
                <span>Name</span>
                <input
                  name="name"
                  required
                  disabled={pending}
                  placeholder="e.g. Onboarding cohort Q2"
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 disabled:opacity-60"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
                <span>Description (optional)</span>
                <textarea
                  name="description"
                  rows={3}
                  disabled={pending}
                  placeholder="Optional context for your team"
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 disabled:opacity-60"
                />
              </label>
              <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-800/80 pt-4">
                <button
                  type="button"
                  disabled={pending}
                  onClick={closeModal}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-900/50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-lg border border-amber-800/80 bg-amber-950/40 px-4 py-2 text-sm font-medium text-amber-100 transition hover:bg-amber-950/70 disabled:opacity-60"
                >
                  {pending ? "Creating…" : "Create pod"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </dialog>
    </>
  );
}
