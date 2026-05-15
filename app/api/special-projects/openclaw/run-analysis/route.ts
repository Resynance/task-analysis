import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { OpenclawAnalysisStreamEvent } from "@/lib/openclaw-analysis-stream";
import {
  removeAllAuditReportMarkdownFiles,
  writeAuditOverviewReport,
} from "@/lib/openclaw-audit-report-read";
import {
  getOpenclawAuditReportsDir,
  getOpenclawAuditScriptPath,
  getOpenclawTasksExportJsonPath,
  getOpenclawTraceExportsDir,
  getOpenclawWorkflowStepsOutDir,
} from "@/lib/openclaw-trace-exports";
import { resolveLlmConfig } from "@/lib/llm-config";
import { prisma } from "@/lib/prisma";
import { runProcessStreaming } from "@/lib/run-process";
import { getSpecialProjectUiLabels } from "@/lib/special-project-labels";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  worldsText: z.string(),
  taskKey: z.string().optional(),
  limit: z.number().int().positive().optional(),
  model: z.string().optional(),
  skipExisting: z.boolean().optional(),
});

const encoder = new TextEncoder();

function ndjsonLine(event: OpenclawAnalysisStreamEvent): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

const OPENCLAW_QUEUE_MARKER = "__OPENCLAW_AUDIT_QUEUE__ ";

/** Buffer stdout into lines and derive progress from audit_trace_workflow_steps.py output. */
function createAuditStdoutSplitter(safeEnqueue: (event: OpenclawAnalysisStreamEvent) => void) {
  let buf = "";
  let lastAuditingTotal: number | null = null;
  let lastQueue: {
    workflowJsonFiles: number;
    withStepsEligible: number;
    toAudit: number;
    skipExisting: boolean;
  } | null = null;

  function emitProgress(completed: number, total: number | null, label: string) {
    safeEnqueue({
      type: "progress",
      phase: "openclaw_analysis",
      completed,
      total,
      label,
    });
  }

  function parseLine(line: string) {
    const auditingMatch = line.match(/Auditing (\d+) task\(s\)/);
    if (auditingMatch) {
      const total = Number.parseInt(auditingMatch[1] ?? "0", 10);
      lastAuditingTotal = total;
      let label =
        total === 0 ? "No tasks to audit" : `0 / ${total} tasks`;
      if (total === 0 && lastQueue && lastQueue.workflowJsonFiles > 0) {
        if (lastQueue.withStepsEligible === 0) {
          label = `No tasks with steps (${lastQueue.workflowJsonFiles} JSON files — exports missing steps; see console)`;
        } else if (lastQueue.skipExisting && lastQueue.withStepsEligible > 0) {
          label = `Skipped ${lastQueue.withStepsEligible} task(s) — reports already exist (disable skip-existing to re-run)`;
        }
      }
      emitProgress(0, total, label);
      return;
    }
    const trimmed = line.trimStart();
    const bracketMatch = trimmed.match(/^\[(\d+)\/(\d+)\]/);
    if (bracketMatch) {
      const idx = Number.parseInt(bracketMatch[1] ?? "0", 10);
      const tot = Number.parseInt(bracketMatch[2] ?? "0", 10);
      lastAuditingTotal = tot;
      const completed = Math.max(0, idx - 1);
      emitProgress(
        completed,
        tot,
        `${completed} / ${tot} tasks · auditing ${idx}`,
      );
    }
  }

  function handleStdoutLine(line: string, emitLog: boolean) {
    if (line.startsWith(OPENCLAW_QUEUE_MARKER)) {
      const jsonPart = line.slice(OPENCLAW_QUEUE_MARKER.length).trim();
      try {
        const q = JSON.parse(jsonPart) as {
          workflow_json_files?: number;
          with_steps_eligible?: number;
          to_audit?: number;
          skip_existing?: boolean;
        };
        lastQueue = {
          workflowJsonFiles: Number(q.workflow_json_files ?? 0),
          withStepsEligible: Number(q.with_steps_eligible ?? 0),
          toAudit: Number(q.to_audit ?? 0),
          skipExisting: Boolean(q.skip_existing),
        };
        safeEnqueue({
          type: "queue_info",
          phase: "openclaw_analysis",
          workflowJsonFiles: lastQueue.workflowJsonFiles,
          withStepsEligible: lastQueue.withStepsEligible,
          toAudit: lastQueue.toAudit,
          skipExisting: lastQueue.skipExisting,
        });
      } catch {
        /* ignore malformed marker line */
      }
      return;
    }
    if (emitLog) {
      safeEnqueue({
        type: "log",
        phase: "openclaw_analysis",
        stream: "stdout",
        text: `${line}\n`,
      });
    }
    parseLine(line);
  }

  return {
    push(chunk: string) {
      buf += chunk;
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.replace(/\r$/, "");
        handleStdoutLine(line, true);
      }
    },
    flush() {
      if (buf.length === 0) return;
      const line = buf.replace(/\r$/, "");
      handleStdoutLine(line, true);
      buf = "";
    },
    getLastAuditingTotal(): number | null {
      return lastAuditingTotal;
    },
  };
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid request body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const body = parsed.data;
  const spUi = getSpecialProjectUiLabels();

  if (!body.worldsText.trim()) {
    return NextResponse.json(
      { error: "World text is empty. Paste or import worlds on the overview first." },
      { status: 400 },
    );
  }

  const llm = await resolveLlmConfig(prisma);
  if (llm.provider !== "openrouter" || !llm.openrouterApiKey?.trim()) {
    return NextResponse.json(
      {
        error: `${spUi.traceProjectDisplayName} workflow audit expects **OpenRouter** (Python stack + OPENROUTER_API_KEY). Switch the LLM provider to OpenRouter under Configuration → LLM target and configure a key, or set OPENROUTER_API_KEY for the Next.js process.`,
      },
      { status: 400 },
    );
  }
  const openrouterKey = llm.openrouterApiKey.trim();

  const traceDir = getOpenclawTraceExportsDir();
  const auditScript = getOpenclawAuditScriptPath();
  const workflowDir = getOpenclawWorkflowStepsOutDir();
  const tasksJson = getOpenclawTasksExportJsonPath();
  const reportsDir = getOpenclawAuditReportsDir();

  if (!existsSync(auditScript)) {
    return NextResponse.json(
      { error: `${spUi.traceProjectDisplayName} audit script is missing from this checkout.` },
      { status: 500 },
    );
  }

  if (!existsSync(workflowDir)) {
    return NextResponse.json(
      {
        error: `Workflow steps directory missing: ${workflowDir}. Run the export first.`,
      },
      { status: 400 },
    );
  }

  const processAbort = new AbortController();
  const abortProcess = () => processAbort.abort(new Error("Analysis request cancelled."));
  request.signal.addEventListener("abort", abortProcess, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (event: OpenclawAnalysisStreamEvent) => {
        try {
          controller.enqueue(ndjsonLine(event));
        } catch {
          /* closed */
        }
      };

      let tmpDir: string | null = null;
      try {
        await mkdir(traceDir, { recursive: true });
        await mkdir(reportsDir, { recursive: true });

        if (!body.skipExisting) {
          const cleared = await removeAllAuditReportMarkdownFiles(reportsDir);
          safeEnqueue({
            type: "reports_cleared",
            phase: "openclaw_analysis",
            count: cleared,
          });
          if (cleared > 0) {
            safeEnqueue({
              type: "log",
              phase: "openclaw_analysis",
              stream: "stdout",
              text: `Removed ${cleared} previous report markdown file(s) from reports/ (fresh run).\n`,
            });
          }
        }

        tmpDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-audit-"));
        const worldPath = path.join(tmpDir, "world.txt");
        await writeFile(worldPath, body.worldsText.trim(), "utf8");

        const args: string[] = [
          auditScript,
          "--world-text-file",
          worldPath,
          "--workflow-dir",
          workflowDir,
          "--tasks-json",
          tasksJson,
          "--reports-dir",
          reportsDir,
          "--guidelines",
          path.join(traceDir, "guidelines", "guidelines.md"),
        ];

        if (body.model?.trim()) {
          args.push("--model", body.model.trim());
        }
        if (body.taskKey?.trim()) {
          args.push("--task", body.taskKey.trim());
        }
        if (body.limit != null) {
          args.push("--limit", String(body.limit));
        }
        if (body.skipExisting) {
          args.push("--skip-existing");
        }

        safeEnqueue({
          type: "phase",
          phase: "openclaw_analysis",
          status: "started",
        });
        safeEnqueue({
          type: "progress",
          phase: "openclaw_analysis",
          completed: 0,
          total: null,
          label: "Starting audit script…",
        });

        const stdoutSplitter = createAuditStdoutSplitter(safeEnqueue);

        const result = await runProcessStreaming("python3", args, {
          env: { ...process.env, OPENROUTER_API_KEY: openrouterKey },
          signal: processAbort.signal,
          onStdout: (text) => stdoutSplitter.push(text),
          onStderr: (text) =>
            safeEnqueue({
              type: "log",
              phase: "openclaw_analysis",
              stream: "stderr",
              text,
            }),
        });

        stdoutSplitter.flush();

        const auditedTotal = stdoutSplitter.getLastAuditingTotal();
        if (result.code === 0 && auditedTotal !== null && auditedTotal > 0) {
          safeEnqueue({
            type: "progress",
            phase: "openclaw_analysis",
            completed: auditedTotal,
            total: auditedTotal,
            label: `Finished ${auditedTotal} task(s)`,
          });
        }

        safeEnqueue({
          type: "phase",
          phase: "openclaw_analysis",
          status: "finished",
          exitCode: result.code,
        });

        if (processAbort.signal.aborted) {
          safeEnqueue({
            type: "complete",
            ok: false,
            error: "Analysis run was stopped.",
          });
          controller.close();
          return;
        }

        if (result.code !== 0) {
          safeEnqueue({
            type: "complete",
            ok: false,
            error: "Audit script exited with an error. See console output above.",
          });
          controller.close();
          return;
        }

        try {
          const { fullPath, byteLength } = writeAuditOverviewReport(reportsDir);
          safeEnqueue({
            type: "log",
            phase: "openclaw_analysis",
            stream: "stdout",
            text: `Wrote overview report (${byteLength} bytes) → ${fullPath}\n`,
          });
        } catch (overviewErr) {
          const msg =
            overviewErr instanceof Error ? overviewErr.message : "overview write failed";
          safeEnqueue({
            type: "log",
            phase: "openclaw_analysis",
            stream: "stderr",
            text: `Could not write overview report: ${msg}\n`,
          });
        }

        safeEnqueue({
          type: "complete",
          ok: true,
          reportsDir,
          workflowStepsDir: workflowDir,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Request failed";
        safeEnqueue({ type: "fatal", message });
      } finally {
        if (tmpDir) {
          try {
            await rm(tmpDir, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        request.signal.removeEventListener("abort", abortProcess);
      }
    },
    cancel() {
      abortProcess();
      request.signal.removeEventListener("abort", abortProcess);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
