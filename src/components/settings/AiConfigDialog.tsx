"use client";

/**
 * AI configuration panel — the in-app way to connect an OpenAI-compatible
 * LLM to the investigator, or to disconnect it and fall back to the
 * deterministic heuristic engine.
 *
 * Flow: pick a provider (registry metadata from src/lib/agent/providers.ts)
 * → base URL is prefilled → the LIVE model catalogue is fetched through
 * POST /api/llm/models (server reuses the saved key when one exists) →
 * the key is probed with a live chat completion BEFORE saving →
 * POST /api/llm-config stores it server-side only (db/llm-config.json,
 * gitignored). The raw key never round-trips through the browser and is
 * always displayed masked.
 *
 * Reachable from the "AI" button in the top command bar (visible on every
 * page) and from System → environment. The UI always labels which mode
 * produced the analysis — LLM or heuristic.
 */

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  Gem,
  KeyRound,
  Loader2,
  PlugZap,
  Puzzle,
  Route,
  Save,
  Server,
  Sparkles,
  Trash2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppStore, type LlmStatus } from "@/store/appStore";
import { getAdminToken, setAdminToken } from "@/services/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PROVIDERS, providerById, type ProviderId } from "@/lib/agent/providers";
import {
  AUTOMATIC_FREE_MODEL_ID,
  ModelCombobox,
  type CatalogueModel,
  type ModelCatalogueState,
} from "@/components/settings/ModelCombobox";

type TestResult = { ok: true; latencyMs: number; model: string; verifiedSaved?: boolean } | { ok: false; error: string } | null;

/** Wire shape of POST /api/llm/models — every variant it can return. */
type ModelsResponse =
  | { ok: true; models: CatalogueModel[]; catalogueSupported: true }
  | { ok: true; needsAuth: true; models: CatalogueModel[] }
  | { ok: true; models: CatalogueModel[]; catalogueSupported: false; note: string }
  | { ok: false; error: string };

const PROVIDER_ICONS: Record<ProviderId, LucideIcon> = {
  openrouter: Route,
  gemini: Gem,
  groq: Zap,
  ollama: Server,
  custom: Puzzle,
};

const PROVIDER_IDS: readonly ProviderId[] = ["openrouter", "gemini", "groq", "ollama", "custom"];

function isProviderId(v: string): v is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(v);
}

/**
 * Ollama needs no credential, but POST /api/llm-config requires an apiKey
 * of at least 8 chars. This fixed, non-secret filler is documented in the
 * UI — Ollama ignores the Authorization header entirely.
 */
const OLLAMA_PLACEHOLDER_KEY = "ollama-local";

function parseModelsResponse(data: unknown): ModelCatalogueState {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.ok !== true) {
    return {
      kind: "error",
      message: typeof d.error === "string" && d.error ? d.error : "Could not load the model catalogue.",
    };
  }
  if (d.needsAuth === true) return { kind: "needs-auth" };
  if (d.catalogueSupported === false) {
    return {
      kind: "unsupported",
      note:
        typeof d.note === "string" && d.note
          ? d.note
          : "This provider doesn't expose a standard catalogue — type the model id instead.",
    };
  }
  return { kind: "ready", models: Array.isArray(d.models) ? (d.models as CatalogueModel[]) : [] };
}

/** Same validation the server applies (http(s) URL, ≥ 8 chars). */
function isValidHttpUrl(raw: string): boolean {
  if (raw.length < 8) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}

function normUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function AiConfigDialog() {
  const open = useAppStore((s) => s.aiConfigOpen);
  const setOpen = useAppStore((s) => s.setAiConfigOpen);
  const status = useAppStore((s) => s.llmStatus);
  const refreshStatus = useAppStore((s) => s.refreshLlmStatus);
  const { toast } = useToast();

  const [providerId, setProviderId] = useState<ProviderId | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState("");
  const [extraHeaders, setExtraHeaders] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);
  const [modelState, setModelState] = useState<ModelCatalogueState>({ kind: "idle" });
  const [refreshTick, setRefreshTick] = useState(0);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  const meta = providerId ? providerById(providerId) : undefined;
  /** The server also reports which provider the saved config belongs to. */
  const statusProvider = (status as (LlmStatus & { provider?: string | null }) | null)?.provider ?? null;

  /* ---------------------------------------------------------------- */
  /* Saved-key detection (server holds the real key, never the client) */
  /* ---------------------------------------------------------------- */
  const savedSameProvider = Boolean(status?.hasRuntimeConfig) && statusProvider === providerId;
  const savedSameBaseUrl =
    Boolean(status?.hasRuntimeConfig && status?.baseUrl) &&
    baseUrl.trim() !== "" &&
    normUrl(status?.baseUrl ?? "") === normUrl(baseUrl);
  const savedKeyApplies = Boolean(status?.hasRuntimeConfig) && (savedSameProvider || savedSameBaseUrl);

  const keyLen = apiKey.trim().length;
  /* Key rules (server-enforced): a typed key always works; an EMPTY key
   * field also works when the saved config covers this provider/endpoint
   * — the server reuses the stored credential without ever echoing it.
   * Switching models therefore never demands retyping the key. */
  const keyRequired = Boolean(meta?.requiresKey) && !savedKeyApplies;
  const keyValid = keyRequired ? keyLen >= 8 : true;
  const headersError = (() => {
    const raw = extraHeaders.trim();
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return "Must be a JSON object, e.g. {\"X-Token\":\"…\"}";
      return null;
    } catch {
      return "Invalid JSON — check quotes and commas";
    }
  })();

  const parsedHeaders: Record<string, string> = (() => {
    if (headersError) return {};
    const raw = extraHeaders.trim();
    if (!raw) return {};
    return Object.fromEntries(
      Object.entries(JSON.parse(raw) as Record<string, unknown>).flatMap(([k, v]) =>
        typeof v === "string" && v.length > 0 ? [[k, v] as [string, string]] : [],
      ),
    );
  })();

  const baseUrlValid = isValidHttpUrl(baseUrl.trim());
  const modelValid = meta?.hasCatalogue ? model.trim().length > 0 : true;
  const canTest = baseUrlValid && modelValid && keyValid && !headersError;
  const canSave = baseUrlValid && modelValid && keyValid && !headersError;

  /**
   * Key that travels with test/save calls: the user's input, or — for
   * keyless local providers — the documented non-secret placeholder.
   */
  const effectiveApiKey = apiKey.trim() || (meta?.requiresKey ? "" : OLLAMA_PLACEHOLDER_KEY);

  /* Reset everything when the dialog closes so each session starts fresh. */
  useEffect(() => {
    if (open) return;
    setProviderId(null);
    setBaseUrl("");
    setApiKey("");
    setShowKey(false);
    setModel("");
    setExtraHeaders("");
    setFreeOnly(false);
    setModelState({ kind: "idle" });
    setRefreshTick(0);
    setTestResult(null);
  }, [open]);

  /* Fresh status every time the panel opens. */
  useEffect(() => {
    if (!open) return;
    void refreshStatus();
    setTestResult(null);
  }, [open, refreshStatus]);

  /* Prefill from the saved runtime config once the status resolves —
     the saved provider becomes the selected card, endpoint + model too. */
  useEffect(() => {
    if (!open || !status || providerId !== null) return;
    const sp = (status as LlmStatus & { provider?: string | null }).provider ?? null;
    if (!status.hasRuntimeConfig || !sp || !isProviderId(sp)) return;
    setProviderId(sp);
    setBaseUrl(status.baseUrl || providerById(sp)?.baseUrl || "");
    setModel(status.model || "");
  }, [open, status, providerId]);

  /*
   * Model catalogue — fetched through POST /api/llm/models whenever the
   * provider, endpoint, key or headers change (debounced), and on Refresh.
   * When the catalogue needs a key and none is available (typed or saved
   * server-side for this provider), no call is made: the needs-auth state
   * is shown instead.
   */
  const catalogueKeyAvailable = meta
    ? !meta.catalogueNeedsKey || keyLen >= 8 || savedSameProvider
    : false;

  useEffect(() => {
    if (!open || !meta?.hasCatalogue || !catalogueKeyAvailable) {
      if (open && meta?.hasCatalogue && !catalogueKeyAvailable) {
        setModelState({ kind: "needs-auth" });
      }
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setModelState({ kind: "loading" });
      void (async () => {
        try {
          const res = await fetch("/api/llm/models", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: providerId,
              baseUrl: baseUrl.trim() || undefined,
              apiKey: apiKey.trim() || undefined,
              extraHeaders: parsedHeaders,
            }),
            signal: AbortSignal.timeout(15_000),
          });
          const data: unknown = await res.json();
          if (cancelled) return;
          setModelState(parseModelsResponse(data));
        } catch (err) {
          if (cancelled) return;
          const name = (err as { name?: string })?.name;
          setModelState({
            kind: "error",
            message:
              name === "TimeoutError" || name === "AbortError"
                ? "Model catalogue request timed out — hit Refresh models to try again."
                : "Could not reach the model catalogue endpoint — is the app server running?",
          });
        }
      })();
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, providerId, meta, baseUrl, apiKey, extraHeaders, catalogueKeyAvailable, refreshTick]);

  function selectProvider(id: ProviderId) {
    const next = providerById(id);
    setProviderId(id);
    setBaseUrl(next?.baseUrl ?? "");
    setModel("");
    setApiKey("");
    setShowKey(false);
    setFreeOnly(false);
    setModelState({ kind: "idle" });
    setTestResult(null);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/llm-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminHeadersExtra() },
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          /* Empty key = let the server reuse the stored credential for
           * this endpoint (it never echoes the key back). */
          apiKey: effectiveApiKey,
          model: model.trim(),
          extraHeaders: parsedHeaders,
          provider: providerId ?? undefined,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      setTestResult((await res.json()) as TestResult);
    } catch {
      setTestResult({ ok: false, error: "Could not reach the test endpoint — is the app server running?" });
    } finally {
      setTesting(false);
    }
  }

  /** When a deployment sets ADMIN_TOKEN, config writes answer 401 —
   * capture the token once per session and retry transparently. */
  function adminHeadersExtra(): Record<string, string> {
    return getAdminToken() ? { "x-admin-token": getAdminToken() } : {};
  }

  async function saveConfig(adminToken?: string): Promise<{ ok: boolean; error?: string; adminRequired?: boolean }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (adminToken) headers["x-admin-token"] = adminToken;
    const res = await fetch("/api/llm-config", {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseUrl: baseUrl.trim(),
        apiKey: effectiveApiKey,
        model: model.trim(),
        extraHeaders: parsedHeaders,
        provider: providerId ?? undefined,
        /* The OpenRouter "Automatic Free Model" choice is recorded as routing. */
        routing:
          providerId === "openrouter" && model.trim() === AUTOMATIC_FREE_MODEL_ID
            ? AUTOMATIC_FREE_MODEL_ID
            : undefined,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; adminRequired?: boolean };
    if (!res.ok || !data.ok) return { ok: false, error: data.error, adminRequired: data.adminRequired };
    return { ok: true };
  }

  async function handleSave() {
    if (!meta) return;
    setSaving(true);
    try {
      let result = await saveConfig();
      /* Deployment requires an admin token — prompt inline, then retry. */
      if (!result.ok && result.adminRequired) {
        const token = window.prompt(
          "This deployment requires an admin token to change AI configuration. Enter ADMIN_TOKEN:",
          "",
        );
        if (!token) {
          toast({ title: "Save cancelled", description: "An admin token is required to change the AI configuration on this deployment." });
          return;
        }
        setAdminToken(token);
        result = await saveConfig(token);
      }
      if (!result.ok) {
        toast({ title: "Could not save the configuration", description: result.error ?? "Check the fields and try again." });
        return;
      }
      await refreshStatus();
      const modelLabel =
        model.trim() === AUTOMATIC_FREE_MODEL_ID ? "automatic free model" : model.trim() || "endpoint default";
      /* HONEST ACTIVATION: save = activate (runtime config wins), but the
       * Verified state only comes from a real probe — run it right away. */
      const testRes = await fetch("/api/llm-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), model: model.trim(), provider: providerId ?? undefined }),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null);
      const test = testRes ? ((await testRes.json()) as TestResult) : null;
      setTestResult(test);
      await refreshStatus();
      toast({
        title: test?.ok ? `LLM connected & verified — ${modelLabel} via ${meta.name}` : `Saved — ${modelLabel} via ${meta.name} (not verified yet)`,
        description: test?.ok
          ? `Live probe passed in ${test.latencyMs}ms on ${test.model}. The investigator now answers from this endpoint.`
          : (test && "error" in test && test.error) || "Saved server-side. The status chip stays amber until a connection test passes.",
      });
      setOpen(false);
    } catch {
      toast({ title: "Could not save the configuration", description: "Network error — is the app server running?" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setClearing(true);
    try {
      await fetch("/api/llm-config", { method: "DELETE", headers: { "Content-Type": "application/json", ...adminHeadersExtra() } });
      await refreshStatus();
      setProviderId(null);
      setBaseUrl("");
      setApiKey("");
      setShowKey(false);
      setModel("");
      setExtraHeaders("");
      setFreeOnly(false);
      setModelState({ kind: "idle" });
      setTestResult(null);
      toast({ title: "LLM disconnected", description: "The deterministic heuristic investigator answers again." });
    } catch {
      toast({ title: "Could not disconnect", description: "Network error — try again." });
    } finally {
      setClearing(false);
    }
  }

  /* ------------------------------ render ------------------------------ */

  const live = status?.configured ?? false;
  const liveMeta = !live
    ? null
    : status?.source === "env"
      ? "from .env"
      : statusProvider
        ? (providerById(statusProvider)?.name ?? statusProvider)
        : null;

  const freeCount = modelState.kind === "ready" ? modelState.models.filter((m) => m.free).length : 0;

  const testButton = (
    <>
      {testing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <PlugZap className="h-3.5 w-3.5" aria-hidden />
      )}
      Test connection
    </>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        aria-label="AI investigator configuration"
        className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto border-line bg-surface-0 p-0 sm:max-w-[640px]"
      >
        <DialogHeader className="border-b border-line px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold text-slate-100">
            <Sparkles className="h-4 w-4 text-intel" aria-hidden />
            AI investigator
          </DialogTitle>
          <DialogDescription className="text-[12.5px] leading-relaxed text-slate-500">
            Connect an OpenAI-compatible LLM and it investigates every case. Without one, the
            deterministic heuristic engine answers — the UI always labels which mode produced the analysis.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          {/* Current mode — always honest about what is answering */}
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "flex items-center gap-2.5 rounded-sm border px-3 py-2.5 text-[12px]",
              live ? "border-intel/35 bg-intel/8 text-intel" : "border-risk-medium/30 bg-risk-medium/8 text-risk-medium"
            )}
          >
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", live ? "bg-intel" : "bg-risk-medium")} aria-hidden />
            {!status ? (
              <span className="text-slate-400">Checking investigator status…</span>
            ) : live ? (
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                <span>
                  LLM live ·{" "}
                  <span className="font-mono font-medium">
                    {status.model === AUTOMATIC_FREE_MODEL_ID ? "automatic free model" : status.model || "endpoint default"}
                  </span>
                  <span className="text-slate-500"> · {hostOf(status.baseUrl)}</span>
                  {liveMeta && <span className="text-slate-500"> ({liveMeta})</span>}
                </span>
                {/* Saved vs Verified — a saved config without a passing
                    probe never claims a working connection. */}
                {status.verification?.state === "verified" ? (
                  <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-sm border border-risk-low/45 bg-risk-low/10 px-1.5 py-px text-[9px] font-semibold tracking-wide text-risk-low">
                    <Check className="h-2.5 w-2.5" aria-hidden />
                    VERIFIED
                  </span>
                ) : status.source === "runtime" ? (
                  <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-sm border border-risk-medium/40 bg-risk-medium/10 px-1.5 py-px text-[9px] font-semibold tracking-wide text-risk-medium">
                    SAVED · NOT VERIFIED
                  </span>
                ) : null}
              </span>
            ) : (
              <span>Heuristic mode — no LLM connected. The rules engine produces evidence and the verdict.</span>
            )}
          </div>

          {/* A — provider selection */}
          <section aria-label="Provider" className="space-y-2">
            <div className="micro text-slate-600">Provider</div>
            <div role="group" aria-label="LLM provider" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PROVIDERS.map((p) => {
                const Icon = PROVIDER_ICONS[p.id];
                const selected = providerId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => selectProvider(p.id)}
                    className={cn(
                      "rounded-sm border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-intel/60",
                      p.id === "custom" && "sm:col-span-2",
                      selected
                        ? "border-intel/50 bg-intel/10"
                        : "border-line bg-surface-1 hover:border-line-strong hover:bg-surface-2"
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "shrink-0 rounded-sm border p-1.5",
                          selected ? "border-intel/40 bg-intel/10" : "border-line bg-surface-2"
                        )}
                        aria-hidden
                      >
                        <Icon className={cn("h-3.5 w-3.5", selected ? "text-intel" : "text-slate-400")} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className={cn("truncate text-[12.5px] font-medium", selected ? "text-slate-100" : "text-slate-300")}>
                            {p.name}
                          </span>
                          {p.local && (
                            <span className="shrink-0 rounded-sm border border-risk-low/40 bg-risk-low/10 px-1 py-px text-[8.5px] font-semibold tracking-wider text-risk-low">
                              LOCAL
                            </span>
                          )}
                        </span>
                        <span className={cn("block truncate text-[10.5px]", selected ? "text-intel" : "text-slate-500")}>
                          {p.tagline}
                        </span>
                      </span>
                      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-intel" aria-hidden />}
                    </span>
                    <span className="mt-2 line-clamp-2 block text-[10.5px] leading-snug text-slate-600">
                      {p.description}
                    </span>
                  </button>
                );
              })}
            </div>
            {meta && <p className="text-[10px] leading-snug text-slate-600">{meta.pricingNote}</p>}
          </section>

          {!meta ? (
            <div className="rounded-sm border border-dashed border-line-strong bg-surface-1 px-4 py-6 text-center">
              <Sparkles className="mx-auto h-4 w-4 text-intel" aria-hidden />
              <p className="mt-2 text-[12px] text-slate-300">Select a provider to connect an endpoint</p>
              <p className="mx-auto mt-1 max-w-sm text-[10.5px] leading-snug text-slate-600">
                OpenRouter, Google Gemini, Groq, local Ollama, or any custom OpenAI-compatible API.
                If an endpoint is already saved, its provider is preselected.
              </p>
            </div>
          ) : (
            <>
              {/* Base URL — prefilled from the registry, still editable */}
              <section aria-label="Base URL" className="space-y-1.5">
                <div className="micro text-slate-600">Endpoint</div>
                <div className="space-y-1.5">
                  <Label htmlFor="llm-base-url" className="text-[11.5px] text-slate-400">
                    Base URL (OpenAI-compatible) <span className="text-risk-critical">*</span>
                  </Label>
                  <Input
                    id="llm-base-url"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.groq.com/openai/v1"
                    className="h-9 border-line bg-surface-1 font-mono text-[12px] text-slate-200"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="text-[10.5px] leading-snug text-slate-600">
                    {meta.id === "custom" ? (
                      meta.setupHint
                    ) : (
                      <>
                        Just the root — <span className="font-mono">/chat/completions</span> is appended automatically.
                      </>
                    )}
                  </p>
                </div>
              </section>

              {/* B — model selection */}
              <section aria-label="Model" className="space-y-1.5">
                <div className="micro text-slate-600">Model</div>
                {meta.hasCatalogue ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="llm-model-trigger" className="text-[11.5px] text-slate-400">
                        Model <span className="text-risk-critical">*</span>
                      </Label>
                      {model === AUTOMATIC_FREE_MODEL_ID && (
                        <span className="rounded-sm border border-intel/30 bg-intel/10 px-1 py-px text-[9px] font-medium tracking-wide text-intel">
                          automatic routing
                        </span>
                      )}
                    </div>
                    <ModelCombobox
                      state={modelState}
                      value={model}
                      onSelect={(id) => {
                        setModel(id);
                        setTestResult(null);
                      }}
                      onRefresh={() => setRefreshTick((t) => t + 1)}
                      freeOnly={freeOnly}
                      onFreeOnlyChange={setFreeOnly}
                      showAutomaticOption={providerId === "openrouter"}
                    />
                    {modelState.kind === "needs-auth" && (
                      <p className="flex items-start gap-1.5 text-[10.5px] leading-snug text-slate-500">
                        <KeyRound className="mt-px h-3 w-3 shrink-0 text-intel" aria-hidden />
                        Add your API key below to load the model list.
                      </p>
                    )}
                    {modelState.kind === "error" && (
                      <p role="alert" className="text-[10.5px] leading-snug text-risk-critical">
                        {modelState.message}
                      </p>
                    )}
                    {modelState.kind === "unsupported" && (
                      <p className="text-[10.5px] leading-snug text-slate-500">{modelState.note}</p>
                    )}
                    {modelState.kind === "ready" && (
                      <p className="text-[10px] leading-snug text-slate-600">
                        {modelState.models.length} models · {freeCount} free — live from {meta.name}
                        {freeOnly ? " · showing free only" : ""}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="llm-model" className="text-[11.5px] text-slate-400">
                      Model <span className="text-slate-600">(optional — endpoint default when empty)</span>
                    </Label>
                    <Input
                      id="llm-model"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="model id from your provider's docs"
                      className="h-9 border-line bg-surface-1 font-mono text-[12px] text-slate-200"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                )}
              </section>

              {/* C — API key (skipped for keyless local providers) */}
              {meta.requiresKey ? (
                <section aria-label="API key" className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="micro text-slate-600">API key</div>
                    {savedKeyApplies && (
                      <span className="rounded-sm border border-intel/30 bg-intel/10 px-1.5 py-px text-[9px] font-medium tracking-wide text-intel">
                        Key saved server-side
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="llm-api-key"
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={
                        savedKeyApplies && status?.keyMasked
                          ? `${status.keyMasked} — saved; type a new key to replace`
                          : "Paste the provider's key"
                      }
                      className="h-9 border-line bg-surface-1 pr-9 font-mono text-[12px] text-slate-200"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      aria-label={showKey ? "Hide API key" : "Show API key"}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-1.5 text-slate-500 transition-colors hover:text-slate-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-intel/60"
                    >
                      {showKey ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
                    </button>
                  </div>
                  <p className="text-[10.5px] leading-snug text-slate-600">
                    {meta.setupHint}{" "}
                    {meta.keyUrl && (
                      <a
                        href={meta.keyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-intel underline-offset-2 hover:underline"
                      >
                        Get an API key
                        <ExternalLink className="h-2.5 w-2.5" aria-hidden />
                      </a>
                    )}
                  </p>
                  {savedKeyApplies && keyLen === 0 && (
                    <p className="rounded-sm border border-intel/25 bg-intel/8 px-2.5 py-1.5 text-[10.5px] leading-snug text-slate-400">
                      Key already saved server-side (encrypted) — leave the field empty to REUSE it while you change the model
                      or headers. Type a new key only to replace the stored one.
                    </p>
                  )}
                </section>
              ) : (
                <p className="rounded-sm border border-line bg-surface-1 px-2.5 py-2 text-[10.5px] leading-snug text-slate-500">
                  No API key needed — Ollama runs locally and ignores credentials. A non-secret placeholder
                  value is stored to satisfy the server contract.
                </p>
              )}

              {/* D — extra headers (validation identical to the previous panel) */}
              <section aria-label="Extra headers" className="space-y-1.5">
                <Label htmlFor="llm-headers" className="text-[11.5px] text-slate-400">
                  Extra headers <span className="text-slate-600">(optional JSON — some gateways need them)</span>
                </Label>
                <Textarea
                  id="llm-headers"
                  value={extraHeaders}
                  onChange={(e) => setExtraHeaders(e.target.value)}
                  rows={2}
                  placeholder='{"X-Token":"…"}'
                  className={cn(
                    "resize-none border-line bg-surface-1 font-mono text-[11.5px] text-slate-200",
                    headersError && "border-risk-critical/50"
                  )}
                  spellCheck={false}
                />
                {headersError && (
                  <p className="text-[10.5px] text-risk-critical">{headersError}</p>
                )}
              </section>
            </>
          )}

          {/* G — connection test result: honest success, failure and rate-limit strips */}
          {testResult && (
            <div
              role="status"
              aria-live="polite"
              className={cn(
                "rounded-sm border px-3 py-2 text-[12px] leading-snug",
                testResult.ok
                  ? "border-risk-low/40 bg-risk-low/8 text-risk-low"
                  : "border-risk-critical/40 bg-risk-critical/8 text-risk-critical"
              )}
            >
              {testResult.ok ? (
                <span>
                  Connection OK — {testResult.latencyMs}ms · <span className="font-medium">{testResult.model}</span>.
                  {status?.verification?.state === "verified" ? " This exact config is VERIFIED." : " Save to activate this endpoint."}
                </span>
              ) : (
                <span>{testResult.error}</span>
              )}
            </div>
          )}

          {/* E — connection controls */}
          <div className="space-y-1.5 border-t border-line pt-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={!canTest || testing || !meta}
                className="h-8 gap-1.5 border-line bg-surface-1 text-[12px] text-slate-300 hover:bg-surface-2"
              >
                {testButton}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={!canSave || saving || !meta}
                className="h-8 gap-1.5 bg-intel text-[12px] font-medium text-white hover:bg-intel/85"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="h-3.5 w-3.5" aria-hidden />}
                Save &amp; activate
              </Button>
              {status?.hasRuntimeConfig && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={clearing}
                  className="ml-auto h-8 gap-1.5 text-[12px] text-slate-500 hover:bg-risk-critical/10 hover:text-risk-critical"
                >
                  {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
                  Disconnect
                </Button>
              )}
            </div>
            {status?.hasRuntimeConfig && (
              <p className="text-[10px] leading-snug text-slate-600">
                Saving activates the endpoint immediately — the status chip shows VERIFIED only after a real probe passes.
                Disconnect removes the saved config; the investigator falls back to <span className="font-mono">.env</span>, then
                to the heuristics engine.
              </p>
            )}
          </div>

          {/* F — privacy + security note */}
          <p className="text-[10.5px] leading-relaxed text-slate-600">
            Case evidence for investigated transactions is sent to the selected provider — minimum-necessary
            masking is applied before anything leaves the app. With Ollama everything runs locally and nothing
            leaves the machine. Keys are stored server-side only — <span className="font-mono">db/llm-config.json</span>{" "}
            (gitignored) with the key <span className="font-medium text-slate-500">encrypted at rest (AES-256-GCM)</span>,
            never returned to the browser and never logged. Local/private network endpoints are blocked except for
            your own Ollama install. Disconnect to fall back to <span className="font-mono">.env</span>, then to heuristics.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
