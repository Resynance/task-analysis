import Link from "next/link";
import { notFound } from "next/navigation";
import {
  deletePodFromDetailAction,
  removePodMemberAction,
} from "@/app/mentorship/actions";
import { MentorshipAddMemberModal } from "@/components/mentorship-add-member-modal";
import { MentorshipConfigurePodModal } from "@/components/mentorship-configure-pod-modal";
import { MentorshipPodMetrics } from "@/components/mentorship-pod-metrics";
import { PodMemberRole } from "@/generated/prisma/enums";
import { computePodMenteeMetrics } from "@/lib/mentorship-metrics";
import { prisma } from "@/lib/prisma";
import {
  buildUserDirectory,
  encodeUserKeyForPath,
  getDisplayNameForUserKey,
} from "@/lib/users-directory";
import { loadUserDisplayNames } from "@/lib/users-lookup";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ podId: string }>;
}): Promise<Metadata> {
  const { podId } = await params;
  const pod = await prisma.mentorshipPod.findUnique({
    where: { id: podId },
    select: { name: true },
  });
  return {
    title: pod ? `Mentorship · ${pod.name}` : "Mentorship · Pod",
  };
}

export default async function MentorshipPodPage({
  params,
}: {
  params: Promise<{ podId: string }>;
}) {
  const { podId } = await params;

  const pod = await prisma.mentorshipPod.findUnique({
    where: { id: podId },
    include: {
      members: {
        orderBy: [{ role: "asc" }, { userKey: "asc" }],
      },
    },
  });

  if (!pod) notFound();

  const nameByUserId = loadUserDisplayNames();
  const directory = await buildUserDirectory(prisma, nameByUserId);

  const mentors = pod.members.filter((m) => m.role === PodMemberRole.MENTOR);
  const mentees = pod.members.filter((m) => m.role === PodMemberRole.MENTEE);

  const metrics =
    mentees.length > 0
      ? await computePodMenteeMetrics(
          prisma,
          mentees.map((m) => m.userKey),
          nameByUserId,
        )
      : null;

  const memberKeys = new Set(pod.members.map((m) => m.userKey));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 px-5 py-14">
      <nav className="text-sm text-zinc-500">
        <Link href="/mentorship" className="hover:text-amber-200/90">
          Mentorship
        </Link>
        <span className="mx-2 text-zinc-700">/</span>
        <span className="text-zinc-400">{pod.name}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-zinc-800/80 pb-8">
        <div className="min-w-0 flex-1">
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-zinc-50">
            {pod.name}
          </h1>
          {pod.description ? (
            <p className="mt-3 text-zinc-400">{pod.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <MentorshipConfigurePodModal
            podId={pod.id}
            defaultName={pod.name}
            defaultDescription={pod.description}
          />
          <MentorshipAddMemberModal
            podId={pod.id}
            directory={directory}
            memberKeysInPod={Array.from(memberKeys)}
          />
          <form action={deletePodFromDetailAction}>
            <input type="hidden" name="podId" value={pod.id} />
            <button
              type="submit"
              className="rounded-lg border border-rose-900/70 px-3 py-2 text-sm text-rose-300/90 transition hover:bg-rose-950/40"
            >
              Delete pod
            </button>
          </form>
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/35 p-5">
          <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Mentors ({mentors.length})
          </h3>
          {mentors.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-600">No mentors yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {mentors.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-3 py-2"
                >
                  <Link
                    href={`/users/${encodeUserKeyForPath(m.userKey)}`}
                    className="min-w-0 flex-1 truncate text-sm text-amber-200/90 hover:underline"
                  >
                    <span className="block truncate font-medium">
                      {getDisplayNameForUserKey(m.userKey, nameByUserId)}
                    </span>
                    <span className="block truncate text-[11px] text-zinc-600">
                      {m.userKey}
                    </span>
                  </Link>
                  <form action={removePodMemberAction}>
                    <input type="hidden" name="membershipId" value={m.id} />
                    <input type="hidden" name="podId" value={pod.id} />
                    <button
                      type="submit"
                      className="text-xs text-zinc-500 hover:text-rose-300"
                    >
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/35 p-5">
          <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Mentees ({mentees.length})
          </h3>
          {mentees.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-600">No mentees yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {mentees.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-3 py-2"
                >
                  <Link
                    href={`/users/${encodeUserKeyForPath(m.userKey)}`}
                    className="min-w-0 flex-1 truncate text-sm text-amber-200/90 hover:underline"
                  >
                    <span className="block truncate font-medium">
                      {getDisplayNameForUserKey(m.userKey, nameByUserId)}
                    </span>
                    <span className="block truncate text-[11px] text-zinc-600">
                      {m.userKey}
                    </span>
                  </Link>
                  <form action={removePodMemberAction}>
                    <input type="hidden" name="membershipId" value={m.id} />
                    <input type="hidden" name="podId" value={pod.id} />
                    <button
                      type="submit"
                      className="text-xs text-zinc-500 hover:text-rose-300"
                    >
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-zinc-100">
          Mentee metrics
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-500">
          Aggregated across all prompts and feedback in the database that resolve to each mentee
          user key (same matching rules as the user profile pages). Feedback and prompt rubric tiers
          only include rows that have been analyzed (non-null score).
        </p>
        <div className="mt-6">
          {metrics ? (
            <MentorshipPodMetrics snapshot={metrics} />
          ) : (
            <p className="text-sm text-zinc-600">Add at least one mentee to see metrics.</p>
          )}
        </div>
      </section>
    </div>
  );
}
