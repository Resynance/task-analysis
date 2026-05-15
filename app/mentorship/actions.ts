"use server";

import { PodMemberRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { normalizeCanonicalUserKeyString } from "@/lib/users-directory";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createPodAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const descriptionRaw = String(formData.get("description") ?? "").trim();
  await prisma.mentorshipPod.create({
    data: {
      name,
      description: descriptionRaw ? descriptionRaw : null,
    },
  });
  revalidatePath("/mentorship");
}

export async function deletePodAction(formData: FormData) {
  const id = String(formData.get("podId") ?? "").trim();
  if (!id) return;
  await prisma.mentorshipPod.delete({ where: { id } });
  revalidatePath("/mentorship");
}

export async function deletePodFromDetailAction(formData: FormData) {
  const id = String(formData.get("podId") ?? "").trim();
  if (!id) return;
  await prisma.mentorshipPod.delete({ where: { id } });
  revalidatePath("/mentorship");
  redirect("/mentorship");
}

export async function updatePodAction(formData: FormData) {
  const podId = String(formData.get("podId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!podId || !name) return;
  const descriptionRaw = String(formData.get("description") ?? "").trim();
  await prisma.mentorshipPod.update({
    where: { id: podId },
    data: {
      name,
      description: descriptionRaw ? descriptionRaw : null,
    },
  });
  revalidatePath("/mentorship");
  revalidatePath(`/mentorship/${podId}`);
}

export async function upsertPodMemberAction(formData: FormData) {
  const podId = String(formData.get("podId") ?? "").trim();
  const rawKey = String(formData.get("userKey") ?? "").trim();
  const userKey = normalizeCanonicalUserKeyString(rawKey);
  const roleRaw = String(formData.get("role") ?? "").trim().toUpperCase();
  if (!podId || userKey === "unknown" || !rawKey) return;
  const role =
    roleRaw === "MENTEE"
      ? PodMemberRole.MENTEE
      : roleRaw === "MENTOR"
        ? PodMemberRole.MENTOR
        : null;
  if (!role) return;

  await prisma.podMembership.upsert({
    where: {
      podId_userKey: { podId, userKey },
    },
    create: { podId, userKey, role },
    update: { role },
  });
  revalidatePath("/mentorship");
  revalidatePath(`/mentorship/${podId}`);
}

export async function removePodMemberAction(formData: FormData) {
  const membershipId = String(formData.get("membershipId") ?? "").trim();
  const podId = String(formData.get("podId") ?? "").trim();
  if (!membershipId || !podId) return;
  await prisma.podMembership.delete({ where: { id: membershipId } });
  revalidatePath("/mentorship");
  revalidatePath(`/mentorship/${podId}`);
}
