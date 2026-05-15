import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { OpenclawExportStreamEvent } from "@/lib/openclaw-export-stream";
import { readOpenclawPortalDefaultsFile } from "@/lib/openclaw-portal-defaults-file";
import { validateTasksExportHasRows } from "@/lib/openclaw-tasks-export-validation";
import {
  getOpenclawProductionExportScriptPath,
  getOpenclawTasksExportJsonPath,
  getOpenclawTraceExportsDir,
  getOpenclawWorkflowStepsOutDir,
  getOpenclawWorkflowStepsScriptPath,
} from "@/lib/openclaw-trace-exports";
import { runProcessStreaming } from "@/lib/run-process";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const cutoffModeSchema = z.enum([
  "gt_instant",
  "on_or_after_utc_date",
  "after_utc_date",
]);

const bodySchema = z
  .object({
    portalProjectId: z.string().optional(),
    teamId: z.string().optional(),
    projectTargetIds: z.string().optional(),
    portalBaseUrl: z.string().optional(),
    /** Omit or empty to use OPENCLAW_PORTAL_COOKIE on the server process. */
    portalCookie: z.string().optional(),
    supabaseUrl: z.string().optional(),
    anonKey: z.string().optional(),
    accessToken: z.string().optional(),
    supabaseCookie: z.string().optional(),
    harPath: z.string().optional(),
    /** Omit to use the Python script default (--cutoff). */
    startDate: z.string().optional(),
    cutoffMode: cutoffModeSchema.optional(),
    lifecycle: z.string().optional(),
    deriveFleetHeaders: z.boolean().optional(),
    nextAction: z.string().optional(),
    nextRouterStateTree: z.string().optional(),
    deploymentId: z.string().optional(),
    userAgent: z.string().optional(),
    workflowDelaySeconds: z.number().nonnegative().optional(),
  })
  .superRefine((data, ctx) => {
    const cookieFromBody = Boolean(data.portalCookie?.trim());
    const cookieFromEnv = Boolean(process.env.OPENCLAW_PORTAL_COOKIE?.trim());
    if (!cookieFromBody && !cookieFromEnv) {
      ctx.addIssue({
        code: "custom",
        message:
          "Paste a portal cookie here or set OPENCLAW_PORTAL_COOKIE in the environment of the Next.js server.",
        path: ["portalCookie"],
      });
    }

    const explicit = data.projectTargetIds?.trim() ?? "";
    if (explicit) {
      return;
    }

    const portalPid = data.portalProjectId?.trim() ?? "";
    const team = data.teamId?.trim() ?? "";
    if (portalPid && team) {
      return;
    }

    const traceDir = getOpenclawTraceExportsDir();
    const defaults = readOpenclawPortalDefaultsFile(traceDir);
    if (defaults.portalProjectId && defaults.teamId) {
      return;
    }

    ctx.addIssue({
      code: "custom",
      message:
        "For portal page-data: enter portal project ID and team ID, or add both to openclaw_portal_defaults.json next to the export scripts (see openclaw_portal_defaults.example.json). Or use explicit project target UUIDs.",
      path: ["portalProjectId"],
    });
  });

const encoder = new TextEncoder();

function ndjsonLine(event: OpenclawExportStreamEvent): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
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

  if (body.harPath?.trim()) {
    const har = path.resolve(body.harPath.trim());
    if (!existsSync(har)) {
      return NextResponse.json(
        { error: `HAR file not found (resolved path): ${har}` },
        { status: 400 },
      );
    }
  }

  const traceDir = getOpenclawTraceExportsDir();
  const productionScript = getOpenclawProductionExportScriptPath();
  const workflowScript = getOpenclawWorkflowStepsScriptPath();
  if (!existsSync(productionScript)) {
    return NextResponse.json(
      { error: "OpenClaw export script is missing from this checkout." },
      { status: 500 },
    );
  }
  if (!existsSync(workflowScript)) {
    return NextResponse.json(
      { error: "OpenClaw workflow-steps script is missing from this checkout." },
      { status: 500 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (event: OpenclawExportStreamEvent) => {
        try {
          controller.enqueue(ndjsonLine(event));
        } catch {
          /* stream closed */
        }
      };

      let tmpDir: string | null = null;
      try {
        await mkdir(traceDir, { recursive: true });

        tmpDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-export-"));
        let portalCookiePath: string | undefined;
        if (body.portalCookie?.trim()) {
          portalCookiePath = path.join(tmpDir, "portal-cookie.txt");
          await writeFile(portalCookiePath, body.portalCookie.trim(), "utf8");
        }

        let supabaseCookiePath: string | undefined;
        if (body.supabaseCookie?.trim()) {
          supabaseCookiePath = path.join(tmpDir, "supabase-cookie.txt");
          await writeFile(supabaseCookiePath, body.supabaseCookie.trim(), "utf8");
        }

        let routerTreeFile: string | undefined;
        const treeRaw = body.nextRouterStateTree?.trim() ?? "";
        if (treeRaw.length > 0) {
          routerTreeFile = path.join(tmpDir, "next-router-state-tree.txt");
          await writeFile(routerTreeFile, treeRaw, "utf8");
        }

        // Python inherits the same env as this Node process (including `.env.local` for dev).
        const baseEnv: NodeJS.ProcessEnv = { ...process.env };
        // Avoid stale server .env JWT shadowing cookie-derived tokens from the Python exporter.
        if (
          (portalCookiePath || supabaseCookiePath) &&
          !body.accessToken?.trim()
        ) {
          delete baseEnv.OPENCLAW_SUPABASE_ACCESS_TOKEN;
        }

        const productionEnv: NodeJS.ProcessEnv = { ...baseEnv };
        delete productionEnv.OPENCLAW_NEXT_ROUTER_STATE_TREE;

        const workflowEnv: NodeJS.ProcessEnv = { ...baseEnv };
        if (routerTreeFile) {
          delete workflowEnv.OPENCLAW_NEXT_ROUTER_STATE_TREE;
        }
        if (body.deriveFleetHeaders !== false) {
          workflowEnv.OPENCLAW_DERIVE_FLEET_HEADERS = "1";
        } else {
          delete workflowEnv.OPENCLAW_DERIVE_FLEET_HEADERS;
        }
        if (body.userAgent?.trim()) {
          workflowEnv.OPENCLAW_USER_AGENT = body.userAgent.trim();
        }

        const productionArgs: string[] = [productionScript, "--out-dir", traceDir];
        const start = body.startDate?.trim();
        if (start) {
          productionArgs.push(
            "--cutoff",
            start,
            "--cutoff-mode",
            body.cutoffMode ?? "on_or_after_utc_date",
          );
        }
        if (portalCookiePath) {
          productionArgs.push("--portal-cookie-file", portalCookiePath);
        }

        if (body.portalProjectId?.trim()) {
          productionArgs.push("--portal-project-id", body.portalProjectId.trim());
        }
        if (body.teamId?.trim()) {
          productionArgs.push("--team-id", body.teamId.trim());
        }
        if (body.projectTargetIds?.trim()) {
          productionArgs.push("--project-target-ids", body.projectTargetIds.trim());
        }
        if (body.portalBaseUrl?.trim()) {
          productionArgs.push("--portal-base-url", body.portalBaseUrl.trim());
        }
        if (body.supabaseUrl?.trim()) {
          productionArgs.push("--supabase-url", body.supabaseUrl.trim());
        }
        if (body.anonKey?.trim()) {
          productionArgs.push("--anon-key", body.anonKey.trim());
        }
        if (body.accessToken?.trim()) {
          productionArgs.push("--access-token", body.accessToken.trim());
        }
        if (supabaseCookiePath) {
          productionArgs.push("--supabase-cookie-file", supabaseCookiePath);
        }
        if (body.harPath?.trim()) {
          productionArgs.push("--har", path.resolve(body.harPath.trim()));
        }
        productionArgs.push("--lifecycle", body.lifecycle?.trim() || "any");

        safeEnqueue({
          type: "phase",
          phase: "production_tasks",
          status: "started",
        });

        const prodResult = await runProcessStreaming("python3", productionArgs, {
          env: productionEnv,
          onStdout: (text) =>
            safeEnqueue({
              type: "log",
              phase: "production_tasks",
              stream: "stdout",
              text,
            }),
          onStderr: (text) =>
            safeEnqueue({
              type: "log",
              phase: "production_tasks",
              stream: "stderr",
              text,
            }),
        });

        if (prodResult.code !== 0) {
          safeEnqueue({
            type: "phase",
            phase: "production_tasks",
            status: "finished",
            exitCode: prodResult.code,
          });
          safeEnqueue({
            type: "complete",
            ok: false,
            step: "production_tasks",
            error: "Production tasks export failed.",
          });
          controller.close();
          return;
        }

        const tasksJsonPath = getOpenclawTasksExportJsonPath();
        if (!existsSync(tasksJsonPath)) {
          safeEnqueue({
            type: "phase",
            phase: "production_tasks",
            status: "finished",
            exitCode: prodResult.code,
          });
          safeEnqueue({
            type: "complete",
            ok: false,
            step: "production_tasks",
            error: `Expected output missing: ${tasksJsonPath}`,
          });
          controller.close();
          return;
        }

        const rowCheck = validateTasksExportHasRows(tasksJsonPath);
        if (!rowCheck.ok) {
          safeEnqueue({
            type: "log",
            phase: "production_tasks",
            stream: "stderr",
            text: `\n${rowCheck.userMessage}\n`,
          });
          safeEnqueue({
            type: "phase",
            phase: "production_tasks",
            status: "finished",
            exitCode: 1,
          });
          safeEnqueue({
            type: "complete",
            ok: false,
            step: "production_tasks",
            error: rowCheck.userMessage,
          });
          controller.close();
          return;
        }

        safeEnqueue({
          type: "phase",
          phase: "production_tasks",
          status: "finished",
          exitCode: prodResult.code,
        });

        const workflowOutDir = getOpenclawWorkflowStepsOutDir();
        await mkdir(workflowOutDir, { recursive: true });

        const workflowArgs: string[] = [
          workflowScript,
          "--tasks-json",
          tasksJsonPath,
          "--out-dir",
          workflowOutDir,
        ];
        if (portalCookiePath) {
          workflowArgs.push("--portal-cookie-file", portalCookiePath);
        }

        if (body.portalBaseUrl?.trim()) {
          workflowArgs.push("--portal-base-url", body.portalBaseUrl.trim());
        }
        if (body.teamId?.trim()) {
          workflowArgs.push("--team-id", body.teamId.trim());
        }
        if (body.harPath?.trim()) {
          workflowArgs.push("--from-har", path.resolve(body.harPath.trim()));
        }
        if (body.deriveFleetHeaders !== false) {
          workflowArgs.push("--derive-fleet-headers");
        }
        if (body.nextAction?.trim()) {
          workflowArgs.push("--next-action", body.nextAction.trim());
        }
        if (routerTreeFile) {
          workflowArgs.push("--next-router-state-tree-file", routerTreeFile);
        }
        if (body.deploymentId?.trim()) {
          workflowArgs.push("--deployment-id", body.deploymentId.trim());
        }
        if (body.workflowDelaySeconds != null && body.workflowDelaySeconds > 0) {
          workflowArgs.push("--delay-seconds", String(body.workflowDelaySeconds));
        }

        safeEnqueue({
          type: "phase",
          phase: "workflow_steps",
          status: "started",
        });

        const wfResult = await runProcessStreaming("python3", workflowArgs, {
          env: workflowEnv,
          onStdout: (text) =>
            safeEnqueue({
              type: "log",
              phase: "workflow_steps",
              stream: "stdout",
              text,
            }),
          onStderr: (text) =>
            safeEnqueue({
              type: "log",
              phase: "workflow_steps",
              stream: "stderr",
              text,
            }),
        });

        safeEnqueue({
          type: "phase",
          phase: "workflow_steps",
          status: "finished",
          exitCode: wfResult.code,
        });

        if (wfResult.code !== 0) {
          safeEnqueue({
            type: "complete",
            ok: false,
            step: "workflow_steps",
            error: "Workflow steps export failed.",
            tasksExportPath: tasksJsonPath,
          });
          controller.close();
          return;
        }

        safeEnqueue({
          type: "complete",
          ok: true,
          tasksExportPath: tasksJsonPath,
          workflowStepsOutDir: workflowOutDir,
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
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
