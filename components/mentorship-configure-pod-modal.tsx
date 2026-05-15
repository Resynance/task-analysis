"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePodAction } from "@/app/mentorship/actions";

type Props = {
  podId: string;
  defaultName: string;
  defaultDescription: string | null;
};

export function MentorshipConfigurePodModal(props: Props) {
  const { podId, defaultName, defaultDescription } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

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
        Configure Pod
      </button>

      <dialog
        ref={dialogRef}
        className="fixed left-1/2 top-1/2 z-[200] m-0 max-h-[min(90vh,640px)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-950 p-0 text-zinc-200 shadow-2xl [&::backdrop]:bg-black/70"
        aria-labelledby="configure-pod-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeModal();
        }}
      >
        <div className="border-b border-zinc-800/80 px-5 py-4">
          <h2 id="configure-pod-title" className="text-lg font-semibold text-zinc-50">
            Configure Pod
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Update the display name and description for this mentorship pod.
          </p>
        </div>

        <form
          className="flex flex-col gap-4 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              await updatePodAction(fd);
              closeModal();
              router.refresh();
            });
          }}
        >
          <input type="hidden" name="podId" value={podId} />
          <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
            <span>Name</span>
            <input
              name="name"
              required
              defaultValue={defaultName}
              disabled={pending}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 disabled:opacity-60"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
            <span>Description</span>
            <textarea
              name="description"
              rows={4}
              defaultValue={defaultDescription ?? ""}
              disabled={pending}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 disabled:opacity-60"
            />
          </label>
          <div className="mt-1 flex flex-wrap justify-end gap-2 border-t border-zinc-800/80 pt-4">
            <button
              type="button"
              onClick={closeModal}
              disabled={pending}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-900/50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg border border-amber-700/60 bg-amber-950/30 px-4 py-2 text-sm text-amber-100/95 transition hover:border-amber-600/80 hover:bg-amber-950/50 disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
