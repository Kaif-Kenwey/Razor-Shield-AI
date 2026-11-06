/**
 * /api/llm-config — inspect and manage the investigator's LLM endpoint
 * from the UI (top-bar "AI" panel).
 *
 * GET    — current status: whether an LLM is live, where the config came
 *          from (runtime UI config vs .env vs none) and a MASKED key.
 *          The raw key never leaves the server.
 * POST   — save a runtime config (db/llm-config.json, gitignored, local
 *          to this machine). Runtime config overrides .env.
 * DELETE — clear the runtime config; the investigator falls back to .env
 *          and, when that is missing too, to the deterministic heuristic
 *          engine. The UI labels the active mode either way.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { readRuntimeLlmConfig, writeRuntimeLlmConfig } from "@/lib/agent/llmConfigStore";
import { resolveLlmConfig } from "@/lib/agent/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function maskKey(key: string): string {
  if (key.length <= 8) return "••••••";
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

function statusFor() {
  const runtime = readRuntimeLlmConfig();
  const active = resolveLlmConfig();
  return {
    configured: active !== null,
    source: runtime ? ("runtime" as const) : active ? ("env" as const) : ("none" as const),
    baseUrl: active?.baseUrl ?? "",
    model: active?.model ?? "",
    keyMasked: active ? maskKey(active.apiKey) : "",
    hasRuntimeConfig: runtime !== null,
    provider: runtime?.provider ?? (active ? "env" : null),
  };
}

export async function GET() {
  return NextResponse.json(statusFor());
}

const configSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .min(8, "Base URL looks too short")
    .max(300, "Base URL is too long")
    .refine((u) => {
      try {
        const url = new URL(u);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    }, "Enter a valid http(s) endpoint URL — e.g. https://api.groq.com/openai/v1"),
  apiKey: z
    .string()
    .trim()
    .max(400, "API key is too long")
    /* Ollama (local) is keyless: a placeholder is accepted so the same
     * schema drives every provider. Non-local providers still require a
     * real key at test time — the probe validates it against the endpoint. */
    .refine((k) => k.length >= 8 || k === "ollama-local", "API key looks too short")
    .default(""),
  model: z.string().trim().max(120, "Model id is too long").optional().default(""),
  extraHeaders: z
    .record(z.string(), z.string())
    .optional()
    .default({}),
  provider: z.string().trim().max(40).optional(),
  routing: z.string().trim().max(60).optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = configSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid configuration" },
      { status: 400 },
    );
  }

  writeRuntimeLlmConfig({
    baseUrl: parsed.data.baseUrl.replace(/\/+$/, ""),
    apiKey: parsed.data.apiKey,
    model: parsed.data.model,
    extraHeaders: parsed.data.extraHeaders,
    provider: parsed.data.provider,
    routing: parsed.data.routing,
  });

  return NextResponse.json({ ok: true, ...statusFor() });
}

export async function DELETE() {
  writeRuntimeLlmConfig(null);
  return NextResponse.json({ ok: true, ...statusFor() });
}
