import Link from "next/link";
import { deletePodAction } from "@/app/mentorship/actions";
import { MentorshipNewPodModal } from "@/components/mentorship-new-pod-modal";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mentorship",
};

export default async function MentorshipPage() {
  const pods = await prisma.mentorshipPod.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { members: true } },
    },
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 px-5 py-14">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-zinc-800/80 pb-8">
        <div className="min-w-0 flex-1">
          <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
            Coaching
          </p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
            Mentorship
          </h1>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-zinc-400">
            Organize mentors and mentees into pods. Open a pod to see mentee-level prompt and
            feedback activity drawn from the same user keys as the Users directory.
          </p>
        </div>
        <div className="shrink-0 pt-1">
          <MentorshipNewPodModal />
        </div>
      </header>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Your pods
        </h2>
        {pods.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">
            No pods yet — use <span className="text-zinc-400">New pod</span> to create one.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {pods.map((pod) => (
              <li
                key={pod.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-800/90 bg-zinc-900/35 px-4 py-4"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/mentorship/${pod.id}`}
                    className="font-[family-name:var(--font-display)] text-lg font-semibold text-zinc-100 transition hover:text-amber-200/90"
                  >
                    {pod.name}
                  </Link>
                  {pod.description ? (
                    <p className="mt-1 text-sm text-zinc-500">{pod.description}</p>
                  ) : null}
                  <p className="mt-2 text-xs text-zinc-600">
                    {pod._count.members} member{pod._count.members === 1 ? "" : "s"}
                  </p>
                </div>
                <form action={deletePodAction}>
                  <input type="hidden" name="podId" value={pod.id} />
                  <button
                    type="submit"
                    className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-rose-900/80 hover:text-rose-300"
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
