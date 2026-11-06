/**
 * RazorShield AI — provider-agnostic LLM client (server-side only).
 *
 * Talks to ANY OpenAI-compatible chat-completions endpoint (OpenAI, Groq,
 * Together, Ollama, vLLM, private gateways...). The endpoint can come from
 * two places, in priority order:
 *
 *   1. Runtime config saved from the in-app AI panel (db/llm-config.json,
 *      gitignored, local to this machine) — see llmConfigStore.ts
 *   2. Environment variables, so deployments can configure via infra:
 *
 *   LLM_BASE_URL      e.g. https://api.openai.com/v1
 *   LLM_API_KEY       bearer credential for that endpoint
 *   LLM_MODEL         optional model id (endpoint default when empty)
 *   LLM_EXTRA_HEADERS optional JSON object of extra headers some corporate
 *                     gateways require, e.g. {"X-Token":"..."}
 *
 * When neither source is configured the deterministic heuristic
 * investigator handles the case and the UI says so. Nothing here is
 * provider-locked: no SDK dependency, one fetch call. This module is
 * imported only from API routes — never ship the key to the browser.
 */

import { readRuntimeLlmConfig } from "./llmConfigStore";
import { assertSafeLlmUrl, UrlGuardError } from "@/lib/server/ssrf";

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders: Record<string, string>;
  /** Provider registry id when configured from the AI panel ("openrouter",
   *  "gemini", "groq", "ollama"), "custom" for manual endpoints, absent
   *  for env-managed deployments. Metadata only — drives UI labels. */
  provider?: string;
  /** Which optional model routing was chosen, e.g. "openrouter/auto-free". */
  routing?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function resolveLlmConfig(): LlmConfig | null {
  /* 1. Runtime config saved from the in-app AI panel wins. */
  const runtime = readRuntimeLlmConfig();
  if (runtime) return runtime;

  /* 2. Environment fallback (infra-managed deployments). */
  const baseUrl = process.env.LLM_BASE_URL?.trim();
  const apiKey = process.env.LLM_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;

  let extraHeaders: Record<string, string> = {};
  const raw = process.env.LLM_EXTRA_HEADERS?.trim();
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        extraHeaders = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>)
            .filter(([, v]) => typeof v === "string" && v.length > 0)
            .map(([k, v]) => [k, v as string]),
        );
      }
    } catch {
      // Malformed LLM_EXTRA_HEADERS is a config error — ignore and continue
      // with bearer auth only; the request will fail loudly if the gateway
      // truly needs the header.
    }
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    model: process.env.LLM_MODEL?.trim() ?? "",
    extraHeaders,
    provider: "env" as const,
  };
}

export function llmConfigured(): boolean {
  return resolveLlmConfig() !== null;
}

/* ------------------------------------------------------------------ */
/* Automatic free-model routing (OpenRouter)                           */
/* ------------------------------------------------------------------ */

/** The well-known automatic-free routing id (documented in the AI panel). */
export const AUTO_FREE_ROUTING = "openrouter/free";

interface FreeModelCache {
  model: string | null;
  fetchedAt: number;
}

let freeModelCache: FreeModelCache | null = null;
const FREE_MODEL_TTL_MS = 10 * 60 * 1000;

/**
 * Resolves the automatic-free routing id to a CONCRETE free model by
 * reading OpenRouter's live catalogue and picking the first model whose
 * own pricing metadata is genuinely $0 (prompt + completion). Cached for
 * 10 minutes so investigations don't hammer the catalogue. Returns null
 * when no free model is currently listed — the caller then fails loudly
 * rather than silently spending money.
 */
/**
 * Chat-compatibility check from OpenRouter's own architecture metadata:
 * a model can serve the investigator only when BOTH input and output
 * modalities include text. Embedding/reranker/image-only models are
 * excluded even when their pricing is $0 — zero cost does not mean the
 * endpoint can answer a chat completion.
 */
function openRouterChatCompatible(m: {
  architecture?: { input_modalities?: unknown; output_modalities?: unknown; modality?: unknown };
}): boolean {
  const arch = m.architecture ?? {};
  const inputs = Array.isArray(arch.input_modalities) ? (arch.input_modalities as unknown[]).map(String) : null;
  const outputs = Array.isArray(arch.output_modalities) ? (arch.output_modalities as unknown[]).map(String) : null;
  if (inputs && !inputs.includes("text")) return false;
  if (outputs && !outputs.includes("text")) return false;
  // Fallback for catalogues that only expose the combined "text->text" form.
  if (!inputs && !outputs && typeof arch.modality === "string") {
    const [inSide, outSide] = arch.modality.split("->").map((s) => s.trim());
    if (outSide && !outSide.includes("text")) return false;
    if (inSide && !inSide.includes("text") && !inSide.includes("image")) return false;
  }
  return true;
}

async function resolveAutoFreeModel(cfg: LlmConfig): Promise<string | null> {
  if (freeModelCache && Date.now() - freeModelCache.fetchedAt < FREE_MODEL_TTL_MS) {
    return freeModelCache.model;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${cfg.apiKey}`, ...cfg.extraHeaders },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) throw new LlmError(`OpenRouter catalogue responded ${res.status}`, res.status);
    const data = (await res.json()) as {
      data?: {
        id?: unknown;
        pricing?: { prompt?: unknown; completion?: unknown };
        architecture?: { input_modalities?: unknown; output_modalities?: unknown; modality?: unknown };
      }[];
    };
    const models = data?.data ?? [];
    const free = models.find((m) => {
      const prompt = Number.parseFloat(String(m.pricing?.prompt ?? "1"));
      const completion = Number.parseFloat(String(m.pricing?.completion ?? "1"));
      return typeof m.id === "string" && prompt === 0 && completion === 0 && openRouterChatCompatible(m);
    });
    const model = typeof free?.id === "string" ? free.id : null;
    freeModelCache = { model, fetchedAt: Date.now() };
    return model;
  } catch {
    /* Catalogue unreachable — do not cache the failure, retry next call. */
    return null;
  }
}

/** True when the config asks for automatic free-model routing. */
function wantsAutoFree(cfg: LlmConfig): boolean {
  return cfg.routing === AUTO_FREE_ROUTING || cfg.model === AUTO_FREE_ROUTING;
}

/** Probe-side alias — same resolution, exported for the test route. */
export const resolveAutoFreeModelForProbe = resolveAutoFreeModel;

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/** One-shot chat completion. Throws LlmError on any failure. */
export async function chatComplete(
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; timeoutMs?: number },
): Promise<{ content: string; model: string }> {
  const cfg = resolveLlmConfig();
  if (!cfg) throw new LlmError("LLM is not configured (set it in the AI panel or via LLM_BASE_URL / LLM_API_KEY)");

  /* SSRF guard — the endpoint may come from operator config; validate it
   * before every call. Only the local Ollama provider may target this
   * machine; env configs need LLM_ALLOW_LOCAL=1 to opt in explicitly. */
  const allowLocal = cfg.provider === "ollama" || process.env.LLM_ALLOW_LOCAL === "1";
  try {
    await assertSafeLlmUrl(cfg.baseUrl, { allowLocal });
  } catch (err) {
    const reason = err instanceof UrlGuardError ? err.message : "endpoint failed the safety check";
    throw new LlmError(`LLM endpoint blocked by the URL guard — ${reason}`);
  }

  /* Automatic free-model routing: resolve the routing id to a concrete
   * zero-cost model from the live catalogue before calling the endpoint. */
  let effectiveModel = cfg.model;
  if (wantsAutoFree(cfg)) {
    const resolved = await resolveAutoFreeModel(cfg);
    if (!resolved) {
      throw new LlmError("Automatic free routing found no zero-cost model in the OpenRouter catalogue right now");
    }
    effectiveModel = resolved;
  }

  const body: Record<string, unknown> = {
    messages,
    temperature: opts?.temperature ?? 0.2,
    max_tokens: opts?.maxTokens ?? 900,
  };
  if (effectiveModel) body.model = effectiveModel;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 30_000);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
        ...cfg.extraHeaders,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new LlmError(`LLM endpoint responded ${res.status}`, res.status);
    const data: unknown = await res.json();
    const content = (data as { choices?: { message?: { content?: unknown } }[] })
      ?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new LlmError("LLM returned an empty completion");
    }
    const model =
      typeof (data as { model?: unknown })?.model === "string"
        ? (data as { model: string }).model
        : effectiveModel || "llm";
    return { content, model };
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new LlmError("LLM request timed out");
    }
    throw new LlmError(err instanceof Error ? err.message : "LLM request failed");
  } finally {
    clearTimeout(timer);
  }
}
