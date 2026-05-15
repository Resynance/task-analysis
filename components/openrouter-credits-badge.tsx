"use client";

import { useCallback, useEffect, useState } from "react";
import { OPENROUTER_CREDITS_REFRESH_EVENT } from "@/lib/openrouter-credits-refresh";

type CreditsOk = {
  show: true;
  ok: true;
  remaining: number;
  totalCredits: number;
  totalUsage: number;
};

type CreditsErr = {
  show: true;
  ok: false;
  error: string;
};

type CreditsHidden = { show: false };

type CreditsResponse = CreditsOk | CreditsErr | CreditsHidden;

const usd = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export function OpenRouterCreditsBadge() {
  const [data, setData] = useState<CreditsResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/llm/openrouter-credits", {
        cache: "no-store",
      });
      const json = (await res.json()) as CreditsResponse;
      setData(json);
    } catch {
      setData({ show: true, ok: false, error: "Network error" });
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const onRefresh = () => {
      void load();
    };
    window.addEventListener(OPENROUTER_CREDITS_REFRESH_EVENT, onRefresh);
    return () =>
      window.removeEventListener(OPENROUTER_CREDITS_REFRESH_EVENT, onRefresh);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void load();
    }, 45_000);
    return () => window.clearInterval(id);
  }, [load]);

  if (data === null) {
    return null;
  }

  if (!data.show) {
    return null;
  }

  if (!data.ok) {
    return (
      <span
        className="max-w-[200px] truncate rounded-full border border-amber-900/50 bg-amber-950/30 px-3 py-1 font-[family-name:var(--font-mono)] text-[11px] text-amber-200/80"
        title={data.error}
      >
        balance · —
      </span>
    );
  }

  const title = `OpenRouter · ${usd.format(data.remaining)} remaining (${usd.format(data.totalUsage)} used of ${usd.format(data.totalCredits)})`;

  return (
    <span
      className="rounded-full border border-sky-800/55 bg-sky-950/35 px-3 py-1 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-wider text-sky-200/90"
      title={title}
    >
      balance · {usd.format(data.remaining)}
    </span>
  );
}
