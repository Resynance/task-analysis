"use client";

import { useState } from "react";
import {
  downloadUserTaskAuthenticityPdf,
  type UserTaskAuthenticityPdfInput,
} from "@/lib/user-task-authenticity-pdf";

export function UserTaskAuthenticityPdfExport({
  report,
}: {
  report: UserTaskAuthenticityPdfInput;
}) {
  const [error, setError] = useState<string | null>(null);

  function handleExport(): void {
    setError(null);
    try {
      downloadUserTaskAuthenticityPdf(report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not export PDF report.");
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={handleExport}
        className="rounded-xl border border-sky-700/70 bg-sky-950/30 px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-sky-900/40"
      >
        Export PDF report
      </button>
      {error ? (
        <p className="max-w-xs text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
