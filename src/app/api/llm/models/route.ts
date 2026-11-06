/**
 * POST /api/llm/models — live model catalogue for the AI panel.
 *
 * Server-side proxy to the selected provider's model endpoint. The API
 * key (if the caller supplies one) is used for THIS request only, never
 * logged, never echoed back. When no key is supplied and the catalogue
 * needs one, the response says `needsAuth` instead of failing. When the
 * caller omits the key but the saved config belongs to the same
 * provider, the stored key is reused server-side.
 *
 * FREE labels are computed from each provider's own pricing metadata at
 * fetch time (OpenRouter: prompt+completion price = 0). Models are ALSO
 * filtered for chat compatibility: OpenRouter's architecture metadata
 * must include text on both the input and output side, so embedding or
 * image-only models never appear as selectable options for the
 * investigator. Nothing here is a hardcoded model list.
 *
 * Body: { provider, baseUrl?, apiKey?, extraHeaders? }
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { providerById, type ProviderId } from "@/lib/agent/providers";
import { readRuntimeLlmConfig, reusableSavedKey } from "@/lib/agent/llmConfigStore";
import { assertSafeLlmUrl, UrlGuardError } from "@/lib/server/ssrf";
import { clientKey, rateLimit } from "@/lib/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface CatalogueModel {
  id: string;
  name: string;
  free: boolean;
  contextLength?: number;
  providerName?: string;
  note?: string;
}

const bodySchema = z.object({
  provider: z.enum(["openrouter", "gemini", "groq", "ollama", "custom"]),
  baseUrl: z.string().trim().max(300).optional(),
  apiKey: z.string().trim().max(400).optional(),
  extraHeaders: z.record(z.string(), z.string()).optional().default({}),
});

async function fetchJson(url: string, headers: Record<string, string>, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal, cache: "no-store" });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      if (!res.ok) throw new Error(`Provider responded ${res.status} with a non-JSON body`);
      throw new Error("Provider returned invalid JSON");
    }
    if (!res.ok) {
      const apiMessage =
        typeof (data as { error?: { message?: string } })?.error?.message === "string"
          ? (data as { error: { message: string } }).error.message
          : undefined;
      throw Object.assign(new Error(apiMessage || `Provider responded ${res.status}`), { status: res.status });
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function friendlyError(err: unknown): { message: string; status?: number } {
  const e = err as { message?: string; status?: number; code?: string; name?: string };
  if (e instanceof UrlGuardError) {
    return { message: e.message, status: 400 };
  }
  if (e?.name === "AbortError" || e?.code === "ABORT_ERR") {
    return { message: "Provider catalogue request timed out — try Refresh Models." };
  }
  const status = e?.status;
  if (status === 401 || status === 403) {
    return { message: "Authentication failed — the endpoint rejected the API key.", status };
  }
  if (status === 429) {
    return { message: "Rate limited by the provider — wait a moment and refresh.", status };
  }
  if (status && status >= 500) {
    return { message: `Provider unavailable (HTTP ${status}) — try again shortly.`, status };
  }
  return { message: e?.message || "Could not reach the provider's model catalogue.", status };
}

/* ------------------------------------------------------------------ */
/* Per-provider catalogue fetchers                                     */
/* ------------------------------------------------------------------ */

/**
 * Chat-compatibility from OpenRouter's architecture metadata — a model
 * must accept text input and produce text output to serve the
 * investigator. Embeddings/rerankers/image-only models are excluded.
 */
function chatCompatible(m: Record<string, unknown>): boolean {
  const arch = (m.architecture ?? {}) as Record<string, unknown>;
  const inputs = Array.isArray(arch.input_modalities) ? (arch.input_modalities as unknown[]).map(String) : null;
  const outputs = Array.isArray(arch.output_modalities) ? (arch.output_modalities as unknown[]).map(String) : null;
  if (inputs && !inputs.includes("text")) return false;
  if (outputs && !outputs.includes("text")) return false;
  if (!inputs && !outputs && typeof arch.modality === "string") {
    const [inSide, outSide] = arch.modality.split("->").map((s) => s.trim());
    if (outSide && !outSide.includes("text")) return false;
    if (inSide && !inSide.includes("text") && !inSide.includes("image")) return false;
  }
  return true;
}

async function openRouterCatalogue(key?: string): Promise<CatalogueModel[]> {
  const data = (await fetchJson("https://openrouter.ai/api/v1/models", {
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  })) as { data?: Record<string, unknown>[] };

  const models = (data?.data ?? [])
    .filter(chatCompatible)
    .map((m) => {
      const pricing = (m.pricing ?? {}) as Record<string, string>;
      const prompt = Number.parseFloat(pricing.prompt ?? "1");
      const completion = Number.parseFloat(pricing.completion ?? "1");
      const free = prompt === 0 && completion === 0;
      const context = typeof m.context_length === "number" ? m.context_length : undefined;
      const id = String(m.id ?? "");
      const name = typeof m.name === "string" ? m.name : id;
      // Provider segment of the namespaced id, e.g. "meta-llama" in
      // "meta-llama/llama-3.3-70b-instruct:free"
      const providerName = id.includes("/") ? id.split("/")[0] : undefined;
      return {
        id,
        name,
        free,
        contextLength: context,
        providerName,
        note: free ? "Free (prompt+completion = $0 per token — rate limits depend on your OpenRouter account status)" : undefined,
      } satisfies CatalogueModel;
    });

  models.sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name));
  return models;
}

async function openAiCompatCatalogue(
  base: string,
  key: string | undefined,
  extraHeaders: Record<string, string>,
  isOllama: boolean,
): Promise<CatalogueModel[]> {
  /* SSRF guard — Ollama is the only provider allowed to target localhost. */
  await assertSafeLlmUrl(base, { allowLocal: isOllama });
  const url = new URL(base);
  const data = (await fetchJson(`${url.origin}${url.pathname.replace(/\/+$/, "")}/models`, {
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
    ...extraHeaders,
  })) as { data?: Record<string, unknown>[] };

  return (data?.data ?? []).map((m) => {
    const id = String(m.id ?? "");
    return {
      id,
      name: typeof m.name === "string" ? m.name : id,
      free: isOllama, // local inference costs nothing — provider-verified (it's your own machine)
      contextLength:
        typeof m.context_length === "number"
          ? m.context_length
          : typeof m.context_window === "number"
            ? (m.context_window as number)
            : undefined,
      providerName: isOllama ? "installed" : undefined,
      note: isOllama ? "Runs locally via your Ollama install" : undefined,
    } satisfies CatalogueModel;
  });
}

export async function POST(request: Request) {
  const rl = rateLimit(clientKey(request, "llm-models"), 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: `Too many catalogue requests — retry in ${rl.retryAfterSec}s.` },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "provider is required" }, { status: 400 });
  }
  const { provider, extraHeaders } = parsed.data;
  const meta = providerById(provider);

  /* Key resolution: caller-supplied → saved key for the same provider /
   * same endpoint → none. The stored key never leaves the server. */
  const saved = readRuntimeLlmConfig();
  let key = parsed.data.apiKey || undefined;
  if (!key) {
    if (saved?.provider === provider) key = saved.apiKey;
    else if (parsed.data.baseUrl) key = reusableSavedKey(provider, parsed.data.baseUrl);
  }

  try {
    let models: CatalogueModel[] = [];

    if (provider === "custom") {
      return NextResponse.json({
        ok: true,
        models: [],
        catalogueSupported: false,
        note: "Custom endpoints don't expose a standard catalogue — type the model id from your provider's docs.",
      });
    }

    if (provider === "openrouter") {
      models = await openRouterCatalogue(key);
    } else {
      const base = (parsed.data.baseUrl || meta?.baseUrl || "").trim();
      if (!base) {
        return NextResponse.json({ ok: false, error: "Base URL is required" }, { status: 400 });
      }
      const isOllama = provider === "ollama";
      if (!isOllama && meta?.catalogueNeedsKey && !key) {
        return NextResponse.json({ ok: true, needsAuth: true, models: [] });
      }
      models = await openAiCompatCatalogue(base, key, extraHeaders, isOllama);
    }

    return NextResponse.json({ ok: true, models, catalogueSupported: true });
  } catch (err) {
    const friendly = friendlyError(err);
    return NextResponse.json({ ok: false, error: friendly.message }, { status: friendly.status ?? 502 });
  }
}
