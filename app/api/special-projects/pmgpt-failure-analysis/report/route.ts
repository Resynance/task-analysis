import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  getPmgptFailureOverviewReportPath,
  getPmgptFailureReportsDir,
  isSafeTaskDirName,
} from "@/lib/pmgpt-failure-analysis";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const overview = searchParams.get("overview")?.trim().toLowerCase();
  if (overview === "1" || overview === "true") {
    const filePath = getPmgptFailureOverviewReportPath();
    if (!existsSync(filePath)) {
      return NextResponse.json(
        { error: "Overview report not found." },
        { status: 404 },
      );
    }
    const markdown = await readFile(filePath, "utf8");
    return NextResponse.json({
      markdown,
      kind: "overview" as const,
    });
  }

  const taskId = searchParams.get("taskId")?.trim() ?? "";
  if (!isSafeTaskDirName(taskId)) {
    return NextResponse.json({ error: "Invalid taskId." }, { status: 400 });
  }
  const filePath = path.join(getPmgptFailureReportsDir(), `${taskId}.md`);
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }
  const markdown = await readFile(filePath, "utf8");
  return NextResponse.json({ markdown, taskId, kind: "task" as const });
}
