"use client";

/**
 * AI configuration panel — the in-app way to connect an OpenAI-compatible
 * LLM (base URL, API key, model) to the investigator, or to disconnect it
 * and fall back to the deterministic heuristic engine.
 *
 * Reachable from the "AI" button in the top command bar (visible on every
 * page) and from System → environment. The key is validated by a live
 * probe BEFORE saving, stored server-side only (db/llm-config.json,
 * gitignored) and always displayed masked — it never round-trips through
 * the browser.
 */

import { useEffect, useState } from "react";
import { Loader2, PlugZap, Save, Sparkles, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAppStore } from "@/store/appStore";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type TestResult = { ok: true; latencyMs: number; model: string } | { ok: false; error: string } | null;

const PRESETS = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", modelHint: "gpt-4o-mini" },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", modelHint: "llama-3.3-70b-versatile" },
  { id: "ollama", label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", modelHint: "llama3.2" },
] as const;

export function AiConfigDialog() {
  const open = useAppStore((s) => s.aiConfigOpen);
  const setOpen = useAppStore((s) => s.setAiConfigOpen);
  const status = useAppStore((s) => s.llmStatus);
  const refreshStatus = useAppStore((s) => s.refreshLlmStatus);
  const { toast } = useToast();

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [extraHeaders, setExtraHeaders] = useState("");
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  /* Fresh status every time the panel opens. */
  useEffect(() => {
    if (!open) return;
    void refreshStatus();
    setTestResult(null);
  }, [open, refreshStatus]);

  /* Prefill from the live status once it resolves (only into empty fields). */
  useEffect(() => {
    if (!open || !status) return;
    setBaseUrl((cur) => cur || (status.source !== "none" ? status.baseUrl : ""));
    setModel((cur) => cur || status.model);
  }, [open, status]);

  const headersError = (() => {
    const raw = extraHeaders.trim();
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "Must be a JSON object, e.g. {\"X-Token\":\"…\"}";
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

  const canSubmit = baseUrl.trim().length > 7 && apiKey.trim().length >= 8 && !headersError;

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/llm-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim(), extraHeaders: parsedHeaders }),
        signal: AbortSignal.timeout(15_000),
      });
      setTestResult((await res.json()) as TestResult);
    } catch {
      setTestResult({ ok: false, error: "Could not reach the test endpoint — is the app server running?" });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/llm-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim(), extraHeaders: parsedHeaders }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: "Could not save the configuration", description: data.error ?? "Check the fields and try again." });
        return;
      }
      await refreshStatus();
      setApiKey("");
      toast({
        title: "LLM connected — investigator is live",
        description: `${model.trim() || "Endpoint default model"} · ${baseUrl.trim().replace(/^https?:\/\//, "")}`,
      });
      setOpen(false);
    } catch {
      toast({ title: "Could not save the configuration", description: "Network error — is the app server running?" });
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setClearing(true);
    try {
      await fetch("/api/llm-config", { method: "DELETE" });
      await refreshStatus();
      setBaseUrl("");
      setModel("");
      setExtraHeaders("");
      setTestResult(null);
      toast({ title: "LLM disconnected", description: "The deterministic heuristic investigator answers again." });
    } catch {
      toast({ title: "Could not disconnect", description: "Network error — try again." });
    } finally {
      setClearing(false);
    }
  }

  const live = status?.configured ?? false;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto border-line bg-surface-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b border-line px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold text-slate-100">
            <Sparkles className="h-4 w-4 text-intel" aria-hidden />
            AI investigator
          </DialogTitle>
          <DialogDescription className="text-[12.5px] leading-relaxed text-slate-500">
            Connect any OpenAI-compatible LLM and it investigates every case. Without one, the
            deterministic heuristic engine answers — the UI always labels which mode produced the analysis.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          {/* Current mode */}
          <div
            role="status"
            className={cn(
              "flex items-center gap-2.5 rounded-sm border px-3 py-2.5 text-[12px]",
              live ? "border-intel/35 bg-intel/8 text-intel" : "border-risk-medium/30 bg-risk-medium/8 text-risk-medium"
            )}
          >
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", live ? "bg-intel" : "bg-risk-medium")} aria-hidden />
            {live ? (
              <span className="min-w-0">
                LLM live · <span className="font-medium">{status?.model || "endpoint default"}</span>
                <span className="text-slate-500"> · {status?.baseUrl?.replace(/^https?:\/\//, "")}</span>
                {status?.source === "env" && <span className="text-slate-500"> (from .env)</span>}
              </span>
            ) : (
              <span>Heuristic mode — no LLM connected. The rules engine produces evidence and the verdict.</span>
            )}
          </div>

          {/* Presets */}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Provider presets">
            <span className="micro mr-1 text-slate-600">Presets</span>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setActivePreset(p.id);
                  setBaseUrl(p.baseUrl);
                  setModel("");
                  setTestResult(null);
                }}
                className={cn(
                  "rounded-sm border px-2 py-1 text-[11px] transition-colors",
                  activePreset === p.id
                    ? "border-intel/50 bg-intel/10 text-intel"
                    : "border-line bg-surface-1 text-slate-400 hover:border-line-strong hover:text-slate-200"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Fields */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="llm-base-url" className="text-[11.5px] text-slate-400">Base URL (OpenAI-compatible) *</Label>
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
                Just the root — <span className="font-mono">/chat/completions</span> is appended automatically.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="llm-api-key" className="text-[11.5px] text-slate-400">API key *</Label>
              <Input
                id="llm-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  activePreset === "ollama"
                    ? "Ollama ignores the key — type anything"
                    : status?.keyMasked
                      ? `${status.keyMasked} — type a new key to replace`
                      : "Paste the provider's key"
                }
                className="h-9 border-line bg-surface-1 font-mono text-[12px] text-slate-200"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="llm-model" className="text-[11.5px] text-slate-400">Model <span className="text-slate-600">(optional)</span></Label>
              <Input
                id="llm-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={PRESETS.find((p) => p.id === activePreset)?.modelHint ?? "endpoint default"}
                className="h-9 border-line bg-surface-1 font-mono text-[12px] text-slate-200"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="space-y-1.5">
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
              {headersError && <p className="text-[10.5px] text-risk-critical">{headersError}</p>}
            </div>
          </div>

          {/* Test result */}
          {testResult && (
            <div
              role="status"
              className={cn(
                "rounded-sm border px-3 py-2 text-[12px] leading-snug",
                testResult.ok
                  ? "border-risk-low/40 bg-risk-low/8 text-risk-low"
                  : "border-risk-critical/40 bg-risk-critical/8 text-risk-critical"
              )}
            >
              {testResult.ok ? (
                <span>
                  Connection OK — {testResult.latencyMs}ms · <span className="font-medium">{testResult.model}</span>. Save to activate.
                </span>
              ) : (
                <span>{testResult.error}</span>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={!canSubmit || testing}
              className="h-8 gap-1.5 border-line bg-surface-1 text-[12px] text-slate-300 hover:bg-surface-2"
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <PlugZap className="h-3.5 w-3.5" aria-hidden />}
              Test connection
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={!canSubmit || saving}
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
                onClick={handleClear}
                disabled={clearing}
                className="ml-auto h-8 gap-1.5 text-[12px] text-slate-500 hover:bg-risk-critical/10 hover:text-risk-critical"
              >
                {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
                Disconnect
              </Button>
            )}
          </div>

          <p className="text-[10.5px] leading-relaxed text-slate-600">
            The key is stored server-side only (<span className="font-mono">db/llm-config.json</span>, gitignored) and never
            sent back to the browser — investigations call the endpoint from the server, so nothing is exposed in the page.
            Disconnect to fall back to <span className="font-mono">.env</span>, then to heuristics.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
