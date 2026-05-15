"use client";

import { useRouter } from "next/navigation";

export function UserDetailBackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-950/60 font-[family-name:var(--font-mono)] text-base leading-none text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-900 hover:text-amber-200/90"
      aria-label="Back to previous page"
    >
      {"<"}
    </button>
  );
}
