"use client";

/**
 * SYSTEM — platform health page.
 *
 * Everything on this page is measured live against the real backend via
 * useSystemHealth(): database round-trip latency, ledger/customer/audit
 * counts, the investigation queue depth and the LLM endpoint state. The
 * "Recent events" panel streams the persisted audit trail (useAuditTrail).
 *
 * The demo controls are explicitly labelled: seeding inserts a synthetic
 * payment batch scored by the deterministic rules engine; clearing removes
 * demo-labelled rows only.
 */

import { Fragment, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Archive,
  ArrowRight,
  Database,
  Gauge,
  Loader2,
  Radio,
  Sparkles,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/shared/StatusDot";
import { EmptyState } from "@/components/shared/States";
import { useAuditTrail, useDemoControls, useSystemHealth } from "@/hooks/useLedger";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/appStore";
import { formatNumber, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Presentation order of the pipeline — metadata is built from live health data. */
const PIPELINE_STAGES: { id: string; icon: LucideIcon }[] = [
  { id: "events", icon: Radio },
  { id: "features", icon: Database },
  { id: "engine", icon: Gauge },
  { id: "ai", icon: Sparkles },
  { id: "cases", icon: Archive },
];

const SERVICE_TONE: Record<
  "operational" | "degraded" | "offline",
  { dot: "green" | "amber" | "red"; chip: string }
> = {
  operational: {
    dot: "green",
    chip: "border-risk-low/25 bg-risk-low/8 text-risk-low",
  },
  degraded: {
    dot: "amber",
    chip: "border-risk-medium/25 bg-risk-medium/8 text-risk-medium",
  },
  offline: {
    dot: "red",
    chip: "border-risk-critical/25 bg-risk-critical/8 text-risk-critical",
  },
};

/** Audit-event dot tone — derived from the persisted action string. */
function auditDotTone(action: string, actor: string): "red" | "amber" | "violet" | "green" {
  if (action.includes("BLOCK")) return "red";
  if (actor === "ANALYST") return "violet";
  if (action.startsWith("DEMO_")) return "violet";
  if (action.includes("SCORED") || action.includes("CREATED")) return "green";
  return "amber";
}

/** "TRANSACTION_SCORED" → "Transaction scored" */
function prettifyAction(action: string): string {
  return action
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface ServiceRow {
  id: string;
  name: string;
  status: "operational" | "degraded" | "offline";
  latencyMs: number | null;
  records: { label: string; value: number } | null;
  detail: string;
}

function ServiceRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5" role="status" aria-label="Loading service status">
      <div className="h-2 w-2 rounded-full bg-slate-500/20 animate-pulse" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3 w-32 rounded bg-slate-500/12 animate-pulse" />
        <div className="h-2.5 w-52 rounded bg-slate-500/8 animate-pulse" style={{ animationDelay: "100ms" }} />
      </div>
      <div className="hidden sm:block h-3 w-14 rounded bg-slate-500/8 animate-pulse" style={{ animationDelay: "180ms" }} />
      <div className="hidden md:block h-3 w-16 rounded bg-slate-500/8 animate-pulse" style={{ animationDelay: "240ms" }} />
      <div className="h-4 w-16 rounded bg-slate-500/10 animate-pulse" style={{ animationDelay: "300ms" }} />
    </div>
  );
}

export function SystemView() {
  const connection = useAppStore((s) => s.connection);
  const setConnection = useAppStore((s) => s.setConnection);
  const demoMode = useAppStore((s) => s.demoMode);
  const streamPaused = useAppStore((s) => s.streamPaused);
  const soundEnabled = useAppStore((s) => s.soundEnabled);
  const llmStatus = useAppStore((s) => s.llmStatus);
  const refreshLlmStatus = useAppStore((s) => s.refreshLlmStatus);
  const setAiConfigOpen = useAppStore((s) => s.setAiConfigOpen);

  const { data: health, isLoading: healthLoading, isError: healthError, refetch: refetchHealth } = useSystemHealth();
  const { seed, clear } = useDemoControls();
  const { toast: showToast } = useToast();
  const { data: auditEvents, isLoading: auditLoading } = useAuditTrail(undefined, 8);

  /* Keep the AI investigator row honest — resolve on mount. */
  useEffect(() => {
    void refreshLlmStatus();
  }, [refreshLlmStatus]);

  const offline = connection === "offline";

  /* Service rows built from the live health probe — no hardcoded latencies. */
  const services = useMemo<ServiceRow[]>(() => {
    if (!health) return [];
    const dbLatency = health.database.latencyMs;
    const openCases = health.queue.investigating + health.queue.underReview;
    return [
      {
        id: "engine",
        name: "Risk Engine",
        status: health.database.ok ? (offline ? "degraded" : "operational") : "offline",
        latencyMs: dbLatency,
        records: { label: "rows", value: health.counts.transactions },
        detail: `Deterministic rules engine · ${health.engine.version} · ${health.engine.kind}`,
      },
      {
        id: "ai",
        name: "AI Investigator",
        status: "operational",
        latencyMs: null,
        records: null,
        detail: health.llm.configured
          ? `LLM live · ${health.llm.provider ?? "custom"} · ${health.llm.model ?? "endpoint default"}`
          : "Heuristic mode — connect an LLM from the top bar",
      },
      {
        id: "features",
        name: "Feature Store",
        status: health.database.ok ? "operational" : "offline",
        latencyMs: dbLatency,
        records: { label: "customers", value: health.counts.customers },
        detail: `${formatNumber(health.counts.customers)} customer profiles in SQLite`,
      },
      {
        id: "events",
        name: "Event Stream",
        status: health.database.ok ? (offline ? "degraded" : "operational") : "offline",
        latencyMs: dbLatency,
        records: { label: "audit events", value: health.counts.auditEvents },
        detail: `${formatNumber(health.counts.auditEvents)} events appended to the audit log`,
      },
      {
        id: "cases",
        name: "Case Store",
        status: health.database.ok ? "operational" : "offline",
        latencyMs: dbLatency,
        records: { label: "open cases", value: openCases },
        detail: `${formatNumber(openCases)} open investigations in the queue`,
      },
    ];
  }, [health, offline]);

  const servicesById = new Map(services.map((svc) => [svc.id, svc]));
  const operationalCount = services.filter((s) => s.status === "operational").length;

  /* ---------------- demo controls ---------------- */

  const handleSeed = async () => {
    try {
      const res = await seed.mutateAsync();
      showToast({
        title: "Demo records loaded",
        description: `${formatNumber(res.created)} synthetic payments created${
          res.skipped > 0 ? ` · ${formatNumber(res.skipped)} already present` : ""
        }.`,
      });
    } catch (err) {
      showToast({
        title: "Could not load demo records",
        description: err instanceof Error ? err.message : "The demo endpoint is unreachable.",
        variant: "destructive",
      });
    }
  };

  const handleClear = async () => {
    if (
      !window.confirm(
        "Remove all demo-labelled rows from the ledger? Imported and manual rows are kept.",
      )
    ) {
      return;
    }
    try {
      const res = await clear.mutateAsync();
      showToast({
        title: "Demo data cleared",
        description: `${formatNumber(res.deleted)} demo-labelled rows deleted.`,
      });
    } catch (err) {
      showToast({
        title: "Could not clear demo data",
        description: err instanceof Error ? err.message : "The demo endpoint is unreachable.",
        variant: "destructive",
      });
    }
  };

  const envRows: { label: string; value: string; tone?: "good" | "bad" }[] = [
    { label: "Deployment", value: "Local demo sandbox" },
    {
      label: "Risk engine",
      value: health ? `${health.engine.version} · ${health.engine.kind}` : "—",
    },
    { label: "Data source", value: "SQLite ledger (Prisma) · demo arrivals labelled demo" },
    {
      label: "AI investigator",
      value: llmStatus?.configured
        ? `LLM live · ${llmStatus.model || llmStatus.baseUrl}${llmStatus.source === "env" ? " (.env)" : ""}`
        : "Heuristic engine — no LLM configured",
      tone: llmStatus?.configured ? "good" : undefined,
    },
    { label: "Live streaming", value: demoMode ? (streamPaused ? "Enabled · arrivals paused" : "Enabled (scripted arrivals)") : "Disabled" },
    { label: "Critical alerts", value: soundEnabled ? "Chime on critical arrivals" : "Muted (toast only)" },
    {
      label: "API connection",
      value: offline ? "Disconnected" : "Connected",
      tone: offline ? "bad" : "good",
    },
    {
      label: "Audit log",
      value: health ? `Enabled · append-only · ${formatNumber(health.counts.auditEvents)} events` : "Enabled · append-only",
    },
  ];

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 lg:px-6">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0, duration: 0.35, ease: "easeOut" }}
        className="mb-6"
      >
        <p className="micro mb-1.5 text-slate-500">Platform health</p>
        <h1 className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">System</h1>
        <p className="mt-1 text-[13px] text-slate-500">
          Service status for the RazorShield risk pipeline, measured against the live ledger.
        </p>
      </motion.header>

      {/* Risk pipeline */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.06, duration: 0.35, ease: "easeOut" }}
        className="panel overflow-hidden"
        aria-label="Risk pipeline"
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
          <h2 className="micro-11 font-semibold text-slate-200">Risk pipeline</h2>
          <span className={cn("micro", offline ? "text-risk-medium" : "text-slate-500")}>
            {offline ? "Degraded — engine unreachable" : "Live"}
          </span>
        </div>
        <div className="p-4">
          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
            {PIPELINE_STAGES.map((stage, i) => {
              const svc = servicesById.get(stage.id);
              const Icon = stage.icon;
              const dimmed = offline && stage.id === "engine";
              return (
                <Fragment key={stage.id}>
                  {i > 0 && (
                    <ArrowRight
                      className="h-3.5 w-3.5 shrink-0 rotate-90 text-slate-600 lg:rotate-0"
                      aria-hidden
                    />
                  )}
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.12 + i * 0.06, duration: 0.3 }}
                    className={cn(
                      "flex min-w-0 items-center gap-2.5 rounded-sm border border-line bg-surface-1 px-3 py-2.5",
                      dimmed && "opacity-50"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-medium text-slate-200">{svc?.name ?? "…"}</p>
                      <p className="num text-[10.5px] text-slate-500">
                        {svc ? (svc.latencyMs != null ? `${formatNumber(svc.latencyMs)} ms` : "no latency probe") : "measuring"}
                      </p>
                    </div>
                  </motion.div>
                </Fragment>
              );
            })}
          </div>
        </div>
      </motion.section>

      {/* Services */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.35, ease: "easeOut" }}
        className="panel mt-5 overflow-hidden"
        aria-label="Services"
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
          <h2 className="micro-11 font-semibold text-slate-200">Services</h2>
          <span className="micro text-slate-500">
            {health ? `${operationalCount}/${services.length} operational` : "measuring"}
          </span>
        </div>
        <div className="divide-y divide-line/60">
          {healthLoading || (!healthError && services.length === 0)
            ? [0, 1, 2, 3, 4].map((i) => <ServiceRowSkeleton key={i} />)
            : healthError ? (
                <EmptyState
                  icon={<WifiOff className="h-5 w-5 text-risk-medium" aria-hidden />}
                  title="Health probe unreachable"
                  body="Service status is unavailable right now — no cached or invented latencies are shown."
                  action={
                    <Button
                      variant="outline"
                      onClick={() => void refetchHealth()}
                      className="gap-2 border-line bg-surface-2 hover:bg-surface-3"
                    >
                      <Loader2 className="h-3.5 w-3.5" aria-hidden /> Retry probe
                    </Button>
                  }
                />
              ) : (
                services.map((svc, i) => {
                  const tone = SERVICE_TONE[svc.status];
                  return (
                    <motion.div
                      key={svc.id}
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.18 + i * 0.06, duration: 0.3 }}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <StatusDot
                        tone={tone.dot}
                        pulse={svc.status === "operational"}
                        label={`${svc.name} ${svc.status}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-slate-200">{svc.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {svc.id === "ai" && llmStatus
                            ? llmStatus.configured
                              ? `LLM live · ${llmStatus.model || "endpoint default"}`
                              : "Heuristic mode — connect an LLM from the top bar"
                            : svc.detail}
                        </p>
                      </div>
                      <div className="hidden text-right sm:block">
                        <p className="micro text-slate-600">Latency</p>
                        <p className="num text-[12px] text-slate-300">
                          {svc.latencyMs != null ? `${formatNumber(svc.latencyMs)} ms` : "—"}
                        </p>
                      </div>
                      <div className="hidden text-right md:block">
                        <p className="micro text-slate-600">{svc.records?.label ?? "Records"}</p>
                        <p className="num text-[12px] text-slate-300">
                          {svc.records ? formatNumber(svc.records.value) : "—"}
                        </p>
                      </div>
                      <span
                        className={cn("micro shrink-0 rounded-sm border px-1.5 py-0.5", tone.chip)}
                      >
                        {svc.status}
                      </span>
                    </motion.div>
                  );
                })
              )}
        </div>
      </motion.section>

      {/* Demo data */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16, duration: 0.35, ease: "easeOut" }}
        className="panel mt-5 overflow-hidden"
        aria-label="Demo data"
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
          <h2 className="micro-11 font-semibold text-slate-200">Demo data</h2>
          <span className="micro text-slate-500">synthetic · labelled demo</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="micro text-slate-500">Ledger rows</p>
            <p className="num mt-1 text-[22px] font-semibold leading-none text-slate-100">
              {health ? formatNumber(health.counts.transactions) : "—"}
            </p>
            <p className="mt-2 max-w-[420px] text-[11px] leading-relaxed text-slate-500">
              Seeding inserts a labelled synthetic payment batch scored by the deterministic rules
              engine. Clearing removes demo-labelled rows only — imported and manual rows are kept.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              onClick={() => void handleSeed()}
              disabled={seed.isPending}
              className="gap-2 border border-risk-low/40 bg-risk-low/10 text-[12px] font-semibold text-risk-low hover:bg-risk-low/20"
            >
              {seed.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Database className="h-3.5 w-3.5" aria-hidden />
              )}
              {seed.isPending ? "Loading…" : "Load demo records"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleClear()}
              disabled={clear.isPending}
              className="gap-2 border-risk-critical/30 bg-surface-1 text-[12px] font-medium text-risk-critical hover:bg-risk-critical/10 hover:text-risk-critical"
            >
              {clear.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <WifiOff className="h-3.5 w-3.5" aria-hidden />
              )}
              {clear.isPending ? "Clearing…" : "Clear demo data"}
            </Button>
          </div>
        </div>
      </motion.section>

      {/* Environment */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.35, ease: "easeOut" }}
        className="panel mt-5 overflow-hidden"
        aria-label="Environment"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="micro-11 font-semibold text-slate-200">Environment</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAiConfigOpen(true)}
            className="h-7 gap-1.5 border-line bg-surface-1 px-2.5 text-[11px] text-slate-300 hover:bg-surface-2"
          >
            <Sparkles className="h-3 w-3" aria-hidden />
            AI settings
          </Button>
        </div>
        <dl className="grid gap-x-8 px-4 py-2 sm:grid-cols-2">
          {envRows.map((row) => (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-4 border-b border-line/60 py-2.5"
            >
              <dt className="micro shrink-0 text-slate-500">{row.label}</dt>
              <dd
                className={cn(
                  "num text-right text-[12.5px]",
                  row.tone === "good" && "text-risk-low",
                  row.tone === "bad" && "text-risk-critical",
                  !row.tone && "text-slate-300"
                )}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </motion.section>

      {/* Connection controls + recent events */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24, duration: 0.35, ease: "easeOut" }}
          className="panel overflow-hidden"
          aria-label="Connection controls"
        >
          <div className="border-b border-line px-4 py-3">
            <h2 className="micro-11 font-semibold text-slate-200">Connection controls</h2>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConnection(offline ? "online" : "offline")}
                className="border-line bg-surface-2 text-slate-200 hover:bg-surface-3 hover:text-slate-100"
              >
                {offline ? (
                  <Wifi className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <WifiOff className="h-3.5 w-3.5" aria-hidden />
                )}
                {offline ? "Restore connection" : "Simulate API outage"}
              </Button>
              <p className="max-w-[280px] text-[11px] leading-relaxed text-slate-500">
                Offline shows the recovery state used when the risk engine is unreachable.
              </p>
            </div>
            <div className="flex items-center gap-2" aria-label="Keyboard shortcut: command palette">
              <kbd className="rounded border border-line bg-surface-2 px-1.5 py-px font-mono text-[10px] text-slate-500">
                ⌘ K
              </kbd>
              <span className="text-[11px] text-slate-500">— command palette</span>
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.35, ease: "easeOut" }}
          className="panel overflow-hidden"
          aria-label="Recent events"
        >
          <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
            <h2 className="micro-11 font-semibold text-slate-200">Recent events</h2>
            <span className="micro text-slate-500">persisted audit trail · newest first</span>
          </div>
          <div className="max-h-72 divide-y divide-line/60 overflow-y-auto">
            {auditLoading ? (
              [0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-3" role="status" aria-label="Loading event">
                  <div className="mt-1 h-2 w-2 rounded-full bg-slate-500/20 animate-pulse" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-3 w-40 rounded bg-slate-500/12 animate-pulse" />
                    <div className="h-2.5 w-56 rounded bg-slate-500/8 animate-pulse" style={{ animationDelay: "90ms" }} />
                  </div>
                </div>
              ))
            ) : !auditEvents || auditEvents.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[12px] text-slate-500">
                  No audit events yet — every scoring run and analyst decision is appended here.
                </p>
              </div>
            ) : (
              auditEvents.map((event, i) => (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.04, 0.3), duration: 0.3 }}
                  className="flex items-start gap-3 px-4 py-3"
                >
                  <StatusDot
                    tone={auditDotTone(event.action, event.actor)}
                    className="mt-[5px]"
                    label={event.actor}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium text-slate-200">{prettifyAction(event.action)}</p>
                    <p className="num mt-0.5 truncate text-[11.5px] text-slate-500">
                      {event.actor} · {event.entityId}
                    </p>
                  </div>
                  <time className="num shrink-0 pt-0.5 text-[11px] text-slate-600">
                    {relativeTime(event.time)}
                  </time>
                </motion.div>
              ))
            )}
          </div>
        </motion.section>
      </div>
    </div>
  );
}
