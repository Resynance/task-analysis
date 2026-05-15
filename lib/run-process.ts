import { spawn } from "node:child_process";

export type RunProcessResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

/**
 * Run a command and capture stdout/stderr (Node App Route / server only).
 */
export type RunProcessStreamOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
};

export function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<RunProcessResult> {
  return runProcessStreaming(command, args, options);
}

/**
 * Like {@link runProcess} but forwards stdout/stderr chunks as they arrive.
 */
export function runProcessStreaming(
  command: string,
  args: string[],
  options: RunProcessStreamOptions = {},
): Promise<RunProcessResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason ?? new Error("Process run was aborted."));
      return;
    }

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
    });
    let killTimer: NodeJS.Timeout | null = null;
    let settled = false;

    const abort = () => {
      if (settled) return;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 5000);
    };

    const cleanup = () => {
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      options.signal?.removeEventListener("abort", abort);
    };

    options.signal?.addEventListener("abort", abort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out.push(Buffer.from(chunk, "utf8"));
      options.onStdout?.(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      err.push(Buffer.from(chunk, "utf8"));
      options.onStderr?.(chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        code: options.signal?.aborted && code == null ? 130 : code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}
