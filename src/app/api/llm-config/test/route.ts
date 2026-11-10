/**
 * POST /api/llm-config/test — probe an OpenAI-compatible endpoint with a
 * tiny chat completion so the UI can verify credentials (tenant-scoped).
 *
 * Accepts an explicit config in the body (test-before-save flow); when
 * the body is empty the organisation's currently resolved configuration
 * is probed. When the caller supplies an endpoint but no key, the org's
 * saved key is reused server-side when it belongs to the same endpoint —
 * so re-verifying after a model change never demands retyping
 * credentials.
 *
 * A successful probe of the ORG'S CURRENTLY SAVED config records a
 * Verified stamp (endpoint + model); the UI distinguishes Saved from
 * Verified so an untested config never implies a working connection.
 *
 * Failures return a human-readable reason, never a stack trace. Every
 * probe passes the shared SSRF URL guard first.
 * Requires "org:config:manage" — an org's credentials may only be
 * exercised by members allowed to manage its configuration.
 */

import { NextResponse } from "next/server";
import {
  AUTO_FREE_ROUTING,
  resolveAutoFreeModelForProbe,
  resolveLlmConfig,
  type LlmConfig,
} from "@/lib/agent/llm";
import { providerById, sanitizeApiKey } from "@/lib/agent/providers";
import {
  markOrgConfigVerified,
  readOrgLlmConfig,
  reusableOrgSavedKey,
} from "@/lib/agent/llmConfigStore";
import { assertSafeLlmUrl, UrlGuardError } from "@/lib/server/ssrf";
import { describeProviderHttpFailure, extractProviderMessage } from "@/lib/server/providerErrors";
import { clientKey, rateLimit } from "@/lib/server/guard";
import { guardMutation } from "@/lib/server/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProbeResult = { ok: true; latencyMs: number; model: string; verifiedSaved: boolean } | { ok: false; error: string };

async function probe(cfg: LlmConfig): Promise<ProbeResult> {
  /* SSRF guard before any outbound byte. Only the local Ollama provider
   * may target this machine; env configs need LLM_ALLOW_LOCAL=1. */
  const allowLocal = cfg.provider === "ollama" || process.env.LLM_ALLOW_LOCAL === "1";
  try {
    await assertSafeLlmUrl(cfg.baseUrl, { allowLocal });
  } catch (err) {
    const reason = err instanceof UrlGuardError ? err.message : "endpoint failed the safety check";
    return { ok: false, error: `Blocked: ${reason}` };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: "Reply with the single word: OK" }],
      max_tokens: 5,
      temperature: 0,
    };
    let effectiveModel = cfg.model;
    /* Automatic free routing resolves to a concrete $0 model so the probe
     * tests what investigations will actually call. */
    if (cfg.routing === AUTO_FREE_ROUTING || cfg.model === AUTO_FREE_ROUTING) {
      const resolved = await resolveAutoFreeModelForProbe(cfg);
      if (!resolved) {
        return { ok: false, error: "Automatic free routing found no zero-cost chat model in the catalogue right now" };
      }
      effectiveModel = resolved;
    }
    if (effectiveModel) body.model = effectiveModel;

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
      /* Honest failure mapping: read the provider's own error body and
       * distinguish a rejected KEY (401) from refused ACCESS (403 — WAF /
       * region blocks, e.g. Groq refusing datacenter IPs). */
      const providerMessage = extractProviderMessage(await res.text().catch(() => null));
      const providerName = cfg.provider ? providerById(cfg.provider)?.name : undefined;
      return { ok: false, error: describeProviderHttpFailure(res.status, providerMessage, providerName) };
    }

    const data: unknown = await res.json();
    const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
      ?.message?.content;
    const model =
      typeof (data as { model?: unknown })?.model === "string"
        ? (data as { model: string }).model
        : effectiveModel;
    if (typeof content !== "string" || !content.trim()) {
      return { ok: false, error: "Endpoint replied but returned an empty completion" };
    }
    return { ok: true, latencyMs: Date.now() - started, model: model || "endpoint default", verifiedSaved: false };
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
  const auth = await guardMutation(request, "org:config:manage");
  if (!auth.ok) return auth.response;
  const { organisationId } = auth.value;

  const rl = rateLimit(clientKey(request, "llm-probe"), 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: `Too many connection tests — retry in ${rl.retryAfterSec}s.` },
      { status: 429 },
    );
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null; // empty body = probe the current configuration
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const providedBase = typeof b.baseUrl === "string" ? b.baseUrl.trim().replace(/\/+$/, "") : "";
  /* Normalize pasted credentials (quotes / "Bearer " / whitespace). */
  const providedKey = typeof b.apiKey === "string" ? sanitizeApiKey(b.apiKey) : "";

  let cfg: LlmConfig | null = null;
  if (providedBase) {
    let extraHeaders: Record<string, string> = {};
    if (b.extraHeaders && typeof b.extraHeaders === "object" && !Array.isArray(b.extraHeaders)) {
      extraHeaders = Object.fromEntries(
        Object.entries(b.extraHeaders as Record<string, unknown>).flatMap(([k, v]) =>
          typeof v === "string" && v.length > 0 ? [[k, v] as [string, string]] : [],
        ),
      );
    }
    let apiKey = providedKey;
    /* Key reuse: an empty key field against the org's saved endpoint
     * reuses the stored credential server-side — the raw key never
     * round-trips. */
    if (!apiKey) {
      const reused = await reusableOrgSavedKey(
        organisationId,
        typeof b.provider === "string" ? b.provider : undefined,
        providedBase,
      );
      if (reused) apiKey = reused;
    }
    cfg = {
      baseUrl: providedBase,
      apiKey,
      model: typeof b.model === "string" ? b.model.trim() : "",
      extraHeaders,
      routing: typeof b.routing === "string" ? b.routing.trim() : undefined,
      provider: typeof b.provider === "string" ? b.provider : undefined,
    };
  } else {
    cfg = await resolveLlmConfig(organisationId);
  }

  if (!cfg || !cfg.apiKey) {
    return NextResponse.json(
      { ok: false, error: "No LLM configured yet — fill in the base URL and API key first" },
      { status: 200 },
    );
  }

  const result = await probe(cfg);

  /* Verification stamp: only when the probe ran against the config that
   * is actually saved for THIS organisation (same endpoint + model) does
   * it count as Verified. */
  if (result.ok) {
    const saved = await readOrgLlmConfig(organisationId);
    if (saved && saved.baseUrl === cfg.baseUrl && saved.model === cfg.model) {
      await markOrgConfigVerified(organisationId, result.model);
    }
  }

  return NextResponse.json(result);
}
