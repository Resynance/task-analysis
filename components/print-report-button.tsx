"use client";

export function PrintReportButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-500"
    >
      Print / Save as PDF
    </button>
  );
}
