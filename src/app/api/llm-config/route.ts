/**
 * /api/llm-config — inspect and manage the investigator's LLM endpoint
 * from the UI (top-bar "AI" panel). Tenant-scoped (Phase 1 multi-tenancy).
 *
 * Every organisation owns its provider configuration: endpoint, model,
 * headers and an AES-256-GCM sealed API key (never returned in
 * plaintext). One org can never read or spend another org's credentials.
 *
 * GET    — current status for the ACTIVE organisation: whether an LLM is
 *          live, where the config came from (this org's saved config vs
 *          .env vs none), a MASKED key and the Saved / Verified state.
 *          `source` stays "runtime" when the ORG's saved config drives
 *          the investigator (UI type compatibility); `orgScoped: true`
 *          marks the per-tenant store. The legacy shared adminGuard
 *          field was removed — authorisation is the session + RBAC.
 *          Requires "org:config:manage".
 * POST   — save the organisation's config. When the operator re-saves
 *          the SAME provider + endpoint with an empty key field, the
 *          previously saved key is reused server-side — switching
 *          models never demands retyping credentials. Requires
 *          "org:config:manage".
 * DELETE — clear the organisation's config; the investigator falls back
 *          to .env and, when that is missing too, to the deterministic
 *          heuristic engine. Requires "org:config:manage".
 *
 * SSRF: the base URL is validated through the shared URL guard before it
 * is accepted — private/loopback targets fail closed except for the
 * explicitly local Ollama provider.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  markOrgConfigVerified,
  orgConfigVerified,
  readOrgLlmConfig,
  reusableOrgSavedKey,
  writeOrgLlmConfig,
} from "@/lib/agent/llmConfigStore";
import { resolveLlmConfig } from "@/lib/agent/llm";
import { sanitizeApiKey } from "@/lib/agent/providers";
import { assertSafeLlmUrl, UrlGuardError } from "@/lib/server/ssrf";
import { clientKey, rateLimit } from "@/lib/server/guard";
import { guardMutation, requirePermission } from "@/lib/server/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function maskKey(key: string): string {
  if (key.length <= 8) return "••••••";
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

async function statusFor(organisationId: string) {
  /* The organisation's own saved config — the only "runtime" surface. */
  const org = await readOrgLlmConfig(organisationId);
  const active = await resolveLlmConfig(organisationId);
  const verified = await orgConfigVerified(organisationId);
  /* Verified only counts while it describes the config actually in use. */
  const verifiedCurrent = Boolean(
    org && verified && verified.verifiedModel === (org.model || ""),
  );
  return {
    configured: active !== null,
    /* "runtime" = THIS organisation's saved config drives the endpoint;
     * "env" = infra-managed fallback (legacy file or .env); "none" =
     * deterministic heuristics only. */
    source: org ? ("runtime" as const) : active ? ("env" as const) : ("none" as const),
    baseUrl: active?.baseUrl ?? "",
    model: active?.model ?? "",
    keyMasked: active ? maskKey(active.apiKey) : "",
    hasRuntimeConfig: org !== null,
    provider: org?.provider ?? (active ? "env" : null),
    savedBaseUrl: org?.baseUrl ?? null,
    savedModel: org?.model ?? null,
    /** Saved | Verified — "Saved" alone never implies a working connection. */
    verification: verifiedCurrent
      ? ({ state: "verified" as const, at: verified!.verifiedAt, model: verified!.verifiedModel })
      : org
        ? ({ state: "saved" as const, at: null, model: null })
        : null,
    /* Phase 1 multi-tenancy marker: this config store is per-organisation
     * (session-authenticated, RBAC-gated) — the shared-file era is gone. */
    orgScoped: true,
  };
}

export async function GET(request: Request) {
  const auth = await requirePermission(request, "org:config:manage");
  if (!auth.ok) return auth.response;
  return NextResponse.json(await statusFor(auth.value.organisationId));
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
  const auth = await guardMutation(request, "org:config:manage");
  if (!auth.ok) return auth.response;
  const { organisationId } = auth.value;

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
  /* Normalize pasted credentials (quotes / "Bearer " / whitespace) so a
   * careless paste never gets stored and silently breaks auth. */
  const sanitizedKey = sanitizeApiKey(rawKey);

  /* SSRF guard — Ollama is the only provider allowed to target this machine. */
  try {
    await assertSafeLlmUrl(baseUrl, { allowLocal: provider === "ollama" });
  } catch (err) {
    const reason = err instanceof UrlGuardError ? err.message : "endpoint failed the safety check";
    return NextResponse.json({ ok: false, error: `Blocked: ${reason}` }, { status: 400 });
  }

  /* Key resolution — typed key wins; otherwise reuse the org's stored key
   * when the operator is re-saving the same provider + endpoint (model or
   * header changes must not demand retyping credentials). The raw key is
   * never echoed back to the client. */
  let apiKey = sanitizedKey;
  if (provider === "ollama" && (!apiKey || apiKey === "ollama-local")) {
    /* Ollama ignores credentials — keep the documented placeholder so the
     * saved config always loads. */
    apiKey = "ollama-local";
  } else if (!apiKey) {
    const reused = await reusableOrgSavedKey(organisationId, provider, baseUrl);
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
  const saved = await readOrgLlmConfig(organisationId);
  const unchangedTarget = saved && saved.baseUrl === baseUrl && saved.model === (model ?? "");
  await writeOrgLlmConfig(organisationId, {
    baseUrl,
    apiKey,
    model,
    extraHeaders,
    provider,
    routing,
    verifiedAt: unchangedTarget ? saved!.verifiedAt : undefined,
    verifiedModel: unchangedTarget ? saved!.verifiedModel : undefined,
  });

  return NextResponse.json({ ok: true, ...(await statusFor(organisationId)) });
}

export async function DELETE(request: Request) {
  const auth = await guardMutation(request, "org:config:manage");
  if (!auth.ok) return auth.response;
  await writeOrgLlmConfig(auth.value.organisationId, null);
  return NextResponse.json({ ok: true, ...(await statusFor(auth.value.organisationId)) });
}
