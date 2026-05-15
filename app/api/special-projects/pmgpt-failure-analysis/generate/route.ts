import { existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  generateReportForTask,
  getPmgptFailureReportsDir,
  isSafeTaskDirName,
  listPmgptFailureTasks,
} from "@/lib/pmgpt-failure-analysis";
import { assertLlmConfigured, resolveLlmConfig } from "@/lib/llm-config";
import { prisma } from "@/lib/prisma";
import { getPmgptFailureRootRelative } from "@/lib/repo-paths";

export const runtime = "nodejs";
export const maxDuration = 300;

type GenerateBody = {
  taskId?: string;
  skipExisting?: boolean;
};

export async function POST(request: Request) {
  let body: GenerateBody = {};
  try {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      body = (await request.json()) as GenerateBody;
    }
  } catch {
    body = {};
  }

  const taskIdRaw =
    typeof body.taskId === "string" ? body.taskId.trim() : "";
  const skipExisting = body.skipExisting === true;

  let llmConfig;
  try {
    llmConfig = await resolveLlmConfig(prisma);
    assertLlmConfigured(llmConfig);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "LLM not configured" },
      { status: 400 },
    );
  }

  const reportsDir = getPmgptFailureReportsDir();

  if (taskIdRaw.length > 0) {
    if (!isSafeTaskDirName(taskIdRaw)) {
      return NextResponse.json(
        { error: "Invalid taskId (expected a directory name like task_…)." },
        { status: 400 },
      );
    }
    if (skipExisting) {
      const reportPath = path.join(reportsDir, `${taskIdRaw}.md`);
      if (existsSync(reportPath)) {
        return NextResponse.json({
          results: [
            {
              taskId: taskIdRaw,
              ok: true,
              skipped: true,
              reason: "Report already exists",
            },
          ],
        });
      }
    }
    const result = await generateReportForTask(llmConfig, taskIdRaw);
    return NextResponse.json({ results: [result] });
  }

  const tasks = await listPmgptFailureTasks();
  const eligible = tasks.filter((t) => t.runFiles.length > 0);
  if (eligible.length === 0) {
    return NextResponse.json(
      {
        error: `No task folders with run*.json found under ${getPmgptFailureRootRelative()}.`,
        results: [],
      },
      { status: 400 },
    );
  }

  const results: unknown[] = [];
  for (const t of eligible) {
    if (skipExisting && t.reportPath != null) {
      results.push({
        taskId: t.taskId,
        ok: true,
        skipped: true,
        reason: "Report already exists",
      });
      continue;
    }
    const r = await generateReportForTask(llmConfig, t.taskId);
    results.push(r);
  }

  return NextResponse.json({ results });
}
