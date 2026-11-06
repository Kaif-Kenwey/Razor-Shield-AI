/**
 * /api/llm-config — inspect and manage the investigator's LLM endpoint
 * from the UI (top-bar "AI" panel).
 *
 * GET    — current status: whether an LLM is live, where the config came
 *          from (runtime UI config vs .env vs none), a MASKED key and the
 *          Saved / Verified state. The raw key never leaves the server.
 * POST   — save a runtime config (db/llm-config.json, gitignored, local
 *          to this machine, key encrypted at rest). Runtime config
 *          overrides .env. When the operator re-saves the SAME provider +
 *          endpoint with an empty key field, the previously saved key is
 *          reused server-side — switching models never demands retyping
 *          credentials. Guarded by the admin token when one is configured.
 * DELETE — clear the runtime config; the investigator falls back to .env
 *          and, when that is missing too, to the deterministic heuristic
 *          engine. The UI labels the active mode either way.
 *
 * SSRF: the base URL is validated through the shared URL guard before it
 * is accepted — private/loopback targets fail closed except for the
 * explicitly local Ollama provider.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  readRuntimeLlmConfig,
  reusableSavedKey,
  runtimeConfigVerified,
  writeRuntimeLlmConfig,
} from "@/lib/agent/llmConfigStore";
import { resolveLlmConfig } from "@/lib/agent/llm";
import { assertSafeLlmUrl, UrlGuardError } from "@/lib/server/ssrf";
import { adminGuardState, checkAdminGuard, clientKey, rateLimit } from "@/lib/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function maskKey(key: string): string {
  if (key.length <= 8) return "••••••";
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

function statusFor() {
  const runtime = readRuntimeLlmConfig();
  const active = resolveLlmConfig();
  const verified = runtimeConfigVerified();
  /* Verified only counts while it describes the config actually in use. */
  const verifiedCurrent = Boolean(
    runtime && verified && verified.verifiedModel === (runtime.model || ""),
  );
  return {
    configured: active !== null,
    source: runtime ? ("runtime" as const) : active ? ("env" as const) : ("none" as const),
    baseUrl: active?.baseUrl ?? "",
    model: active?.model ?? "",
    keyMasked: active ? maskKey(active.apiKey) : "",
    hasRuntimeConfig: runtime !== null,
    provider: runtime?.provider ?? (active ? "env" : null),
    savedBaseUrl: runtime?.baseUrl ?? null,
    savedModel: runtime?.model ?? null,
    /** Saved | Verified — "Saved" alone never implies a working connection. */
    verification: verifiedCurrent
      ? ({ state: "verified" as const, at: verified!.verifiedAt, model: verified!.verifiedModel })
      : runtime
        ? ({ state: "saved" as const, at: null, model: null })
        : null,
    adminGuard: adminGuardState().mode,
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
  const guard = checkAdminGuard(request);
  if (!guard.ok) {
    return NextResponse.json({ ok: false, adminRequired: true, error: guard.message }, { status: 401 });
  }
  const rl = rateLimit(clientKey(request, "llm-config-save"), 15, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: `Too many config changes — retry in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

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

  const { baseUrl: rawBase, apiKey: rawKey, model, extraHeaders, provider, routing } = parsed.data;
  const baseUrl = rawBase.replace(/\/+$/, "");

  /* SSRF guard — Ollama is the only provider allowed to target this machine. */
  try {
    await assertSafeLlmUrl(baseUrl, { allowLocal: provider === "ollama" });
  } catch (err) {
    const reason = err instanceof UrlGuardError ? err.message : "endpoint failed the safety check";
    return NextResponse.json({ ok: false, error: `Blocked: ${reason}` }, { status: 400 });
  }

  /* Key resolution — typed key wins; otherwise reuse the stored key when
   * the operator is re-saving the same provider + endpoint (model or
   * header changes must not demand retyping credentials). The raw key is
   * never echoed back to the client. */
  let apiKey = rawKey;
  if (provider === "ollama" && (!apiKey || apiKey === "ollama-local")) {
    /* Ollama ignores credentials — keep the documented placeholder so the
     * saved config always loads. */
    apiKey = "ollama-local";
  } else if (!apiKey) {
    const reused = reusableSavedKey(provider, baseUrl);
    if (reused) {
      apiKey = reused;
    } else {
      return NextResponse.json(
        {
          ok: false,
          error:
            "API key is required the first time a provider is connected — after that it is reused server-side when you only change the model.",
        },
        { status: 400 },
      );
    }
  }

  /* Preserve prior verification only when endpoint AND model are unchanged. */
  const saved = readRuntimeLlmConfig();
  const unchangedTarget = saved && saved.baseUrl === baseUrl && saved.model === (model ?? "");
  writeRuntimeLlmConfig({
    baseUrl,
    apiKey,
    model,
    extraHeaders,
    provider,
    routing,
    verifiedAt: unchangedTarget ? saved!.verifiedAt : undefined,
    verifiedModel: unchangedTarget ? saved!.verifiedModel : undefined,
  });

  return NextResponse.json({ ok: true, ...statusFor() });
}

export async function DELETE(request: Request) {
  const guard = checkAdminGuard(request);
  if (!guard.ok) {
    return NextResponse.json({ ok: false, adminRequired: true, error: guard.message }, { status: 401 });
  }
  writeRuntimeLlmConfig(null);
  return NextResponse.json({ ok: true, ...statusFor() });
}
