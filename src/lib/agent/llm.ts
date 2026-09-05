/**
 * RazorShield AI — provider-agnostic LLM client (server-side only).
 *
 * Talks to ANY OpenAI-compatible chat-completions endpoint (OpenAI, Groq,
 * Together, Ollama, vLLM, private gateways...) configured purely through
 * environment variables, so the investigator can run against whatever
 * provider the deployment trusts:
 *
 *   LLM_BASE_URL      e.g. https://api.openai.com/v1
 *   LLM_API_KEY       bearer credential for that endpoint
 *   LLM_MODEL         optional model id (endpoint default when empty)
 *   LLM_EXTRA_HEADERS optional JSON object of extra headers some corporate
 *                     gateways require, e.g. {"X-Token":"..."}
 *
 * Nothing here is provider-locked: no SDK dependency, one fetch call.
 * This module is imported only from API routes — never ship the key to
 * the browser.
 */

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders: Record<string, string>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function resolveLlmConfig(): LlmConfig | null {
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
  };
}

export function llmConfigured(): boolean {
  return resolveLlmConfig() !== null;
}

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
  if (!cfg) throw new LlmError("LLM is not configured (LLM_BASE_URL / LLM_API_KEY missing)");

  const body: Record<string, unknown> = {
    messages,
    temperature: opts?.temperature ?? 0.2,
    max_tokens: opts?.maxTokens ?? 900,
  };
  if (cfg.model) body.model = cfg.model;

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
        : cfg.model || "llm";
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
