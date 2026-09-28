/**
 * POST /api/llm-config/test — probe an OpenAI-compatible endpoint with a
 * tiny chat completion so the UI can verify credentials BEFORE saving.
 *
 * Accepts an explicit config in the body (test-before-save flow); when
 * the body is empty the currently resolved configuration is probed.
 * Failures return a human-readable reason, never a stack trace.
 */

import { NextResponse } from "next/server";
import { resolveLlmConfig, type LlmConfig } from "@/lib/agent/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProbeResult = { ok: true; latencyMs: number; model: string } | { ok: false; error: string };

async function probe(cfg: LlmConfig): Promise<ProbeResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: "Reply with the single word: OK" }],
      max_tokens: 5,
      temperature: 0,
    };
    if (cfg.model) body.model = cfg.model;

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

    if (!res.ok) {
      const detail =
        res.status === 401 || res.status === 403
          ? "Authentication failed — the endpoint rejected the API key"
          : res.status === 404
            ? "Endpoint not found — check the base URL (it should end at /v1; /chat/completions is added automatically)"
            : `Endpoint responded ${res.status}`;
      return { ok: false, error: detail };
    }

    const data: unknown = await res.json();
    const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
      ?.message?.content;
    const model =
      typeof (data as { model?: unknown })?.model === "string"
        ? (data as { model: string }).model
        : cfg.model;
    if (typeof content !== "string" || !content.trim()) {
      return { ok: false, error: "Endpoint replied but returned an empty completion" };
    }
    return { ok: true, latencyMs: Date.now() - started, model: model || "endpoint default" };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "Timed out after 12s — endpoint unreachable" };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Request failed" };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null; // empty body = probe the current configuration
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const providedBase = typeof b.baseUrl === "string" ? b.baseUrl.trim() : "";
  const providedKey = typeof b.apiKey === "string" ? b.apiKey.trim() : "";

  let cfg: LlmConfig | null = null;
  if (providedBase && providedKey) {
    let extraHeaders: Record<string, string> = {};
    if (b.extraHeaders && typeof b.extraHeaders === "object" && !Array.isArray(b.extraHeaders)) {
      extraHeaders = Object.fromEntries(
        Object.entries(b.extraHeaders as Record<string, unknown>).flatMap(([k, v]) =>
          typeof v === "string" && v.length > 0 ? [[k, v] as [string, string]] : [],
        ),
      );
    }
    cfg = {
      baseUrl: providedBase.replace(/\/+$/, ""),
      apiKey: providedKey,
      model: typeof b.model === "string" ? b.model.trim() : "",
      extraHeaders,
    };
  } else {
    cfg = resolveLlmConfig();
  }

  if (!cfg) {
    return NextResponse.json(
      { ok: false, error: "No LLM configured yet — fill in the base URL and API key first" },
      { status: 200 },
    );
  }

  return NextResponse.json(await probe(cfg));
}
