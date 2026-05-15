import { prisma } from "@/lib/prisma";
import { resolveLlmConfig } from "@/lib/llm-config";

export async function LlmStatusBadge() {
  let cfg;
  try {
    cfg = await resolveLlmConfig(prisma);
  } catch {
    return (
      <span className="rounded-full border border-zinc-700 px-3 py-1 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-wider text-zinc-500">
        env misconfigured
      </span>
    );
  }

  const model =
    cfg.provider === "openrouter"
      ? cfg.openrouterModel
      : cfg.provider === "remote_api"
        ? cfg.remoteApiModel
        : cfg.lmstudioModel;
  const ready =
    cfg.provider === "lmstudio" ||
    (cfg.provider === "openrouter" && Boolean(cfg.openrouterApiKey?.trim())) ||
    (cfg.provider === "remote_api" && Boolean(cfg.remoteApiKey?.trim()));

  return (
    <span
      className={`rounded-full border px-3 py-1 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-wider ${
        ready
          ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-200/90"
          : "border-rose-800/60 bg-rose-950/35 text-rose-200/90"
      }`}
      title={
        ready
          ? "LLM configuration is ready for analysis"
          : cfg.provider === "remote_api"
            ? "Add a remote API key in LLM settings or set REMOTE_API_KEY / OPENAI_API_KEY"
            : "Add an OpenRouter API key in LLM settings or OPENROUTER_API_KEY"
      }
    >
      {cfg.provider} · {model}
      {!ready ? " · needs key" : ""}
    </span>
  );
}
