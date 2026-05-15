import type { ResolvedLlmConfig } from "@/lib/llm-config";

export type OpenRouterCreditsSnapshot = {
  totalCredits: number;
  totalUsage: number;
  /** totalCredits - totalUsage */
  remaining: number;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseCreditsPayload(json: unknown): OpenRouterCreditsSnapshot | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  const data =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : root;

  const totalRaw =
    data.total_credits ?? data.totalCredits ?? root.total_credits;
  const usedRaw = data.total_usage ?? data.totalUsage ?? root.total_usage;
  const remainingRaw =
    data.remaining_credits ?? data.remainingCredits ?? data.remaining;

  const totalCredits = num(totalRaw);
  const totalUsage = num(usedRaw);
  const remainingDirect = num(remainingRaw);

  if (remainingDirect != null && totalCredits == null && totalUsage == null) {
    return {
      totalCredits: remainingDirect,
      totalUsage: 0,
      remaining: Math.max(0, remainingDirect),
    };
  }

  if (totalCredits != null && totalUsage != null) {
    return {
      totalCredits,
      totalUsage,
      remaining: Math.max(0, totalCredits - totalUsage),
    };
  }

  return null;
}

/**
 * Fetches OpenRouter account credits (GET …/credits). Uses the same API key as chat.
 */
export async function fetchOpenRouterCredits(
  cfg: ResolvedLlmConfig,
): Promise<OpenRouterCreditsSnapshot> {
  if (cfg.provider !== "openrouter") {
    throw new Error("OpenRouter is not the active provider");
  }
  const key = cfg.openrouterApiKey?.trim();
  if (!key) {
    throw new Error("No OpenRouter API key configured");
  }

  const base = cfg.openrouterBaseUrl.replace(/\/$/, "");
  const url = `${base}/credits`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": cfg.openrouterHttpReferer,
      "X-Title": cfg.openrouterAppTitle,
    },
    cache: "no-store",
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    let msg = `Credits request failed (${res.status})`;
    if (json && typeof json === "object" && "error" in json) {
      const err = (json as { error?: unknown }).error;
      if (typeof err === "string") msg = err;
      else if (
        err &&
        typeof err === "object" &&
        "message" in err &&
        typeof (err as { message?: unknown }).message === "string"
      ) {
        msg = (err as { message: string }).message;
      }
    }
    throw new Error(msg);
  }

  const parsed = parseCreditsPayload(json);
  if (!parsed) {
    throw new Error("Unexpected credits response from OpenRouter");
  }
  return parsed;
}
