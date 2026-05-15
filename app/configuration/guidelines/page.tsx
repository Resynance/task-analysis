import Link from "next/link";
import { GuidelineManager, type GuidelineRow } from "@/components/guideline-manager";
import { filterGuidelinesForUi } from "@/lib/guideline-scope";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function GuidelinesPage() {
  const guidelines = await prisma.guideline.findMany({
    orderBy: { updatedAt: "desc" },
  });

  const serialized: GuidelineRow[] = JSON.parse(JSON.stringify(guidelines));

  return (
    <>
      <div className="mx-auto mt-8 w-full max-w-3xl px-5">
        <Link
          href="/configuration"
          className="text-sm text-zinc-500 transition hover:text-amber-200/90"
        >
          ← Back to configuration
        </Link>
      </div>
      <GuidelineManager guidelines={filterGuidelinesForUi(serialized)} />
    </>
  );
}
