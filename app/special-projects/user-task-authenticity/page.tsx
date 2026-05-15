import Link from "next/link";
import { UserTaskAuthenticityReview } from "@/components/user-task-authenticity-review";
import { getChatModel } from "@/lib/llm";
import { resolveLlmConfig } from "@/lib/llm-config";
import { prisma } from "@/lib/prisma";
import { analyzeUserTaskAuthenticity } from "@/lib/user-task-authenticity-analysis";

export const dynamic = "force-dynamic";

export default async function UserTaskAuthenticityPage() {
  const analysis = await analyzeUserTaskAuthenticity(prisma, { runLlm: false });
  const defaultModel = getChatModel(await resolveLlmConfig(prisma));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-14">
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          Special projects / User task authenticity
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
          User task authenticity review
        </h1>
        <p className="mt-3 max-w-3xl text-zinc-400">
          Reviews one user&apos;s task JSON for signals that prompts may be AI-generated
          before submission.
        </p>
        <p className="mt-3 text-sm">
          <Link
            href="/special-projects"
            className="text-amber-200/90 underline-offset-4 hover:text-amber-100 hover:underline"
          >
            ← All special projects
          </Link>
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Input</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Place the local task JSON at{" "}
              <code className="text-zinc-300">{analysis.jsonRelativePath}</code>. The file may
              be an array of task objects or an object with a{" "}
              <code className="text-zinc-300">tasks</code> array. Every task with
              extractable prompt text is analyzed.
            </p>
            <p className="mt-2 font-[family-name:var(--font-mono)] text-xs text-zinc-600">
              {analysis.jsonAbsolutePath}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm">
            <p className={analysis.jsonExists ? "text-emerald-300" : "text-amber-300"}>
              {analysis.jsonExists ? "JSON found" : "JSON missing"}
            </p>
            <p className="mt-1 text-zinc-500">
              {analysis.summary.total} task
              {analysis.summary.total === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        {analysis.parseError ? (
          <p className="mt-4 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
            JSON parse error: {analysis.parseError}
          </p>
        ) : null}
      </section>

      <UserTaskAuthenticityReview
        initialAnalysis={analysis}
        defaultModels={[defaultModel, "", ""]}
      />
    </div>
  );
}
