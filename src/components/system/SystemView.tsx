"use client";

/**
 * SYSTEM — platform health page.
 *
 * Service status for the RazorShield risk pipeline (rendered from
 * SYSTEM_SERVICES), live environment metadata driven by the app store
 * (demoMode / connection), demo controls for the offline recovery state,
 * and the recent event log from NOTIFICATIONS.
 */

import { Fragment } from "react";
import { motion } from "framer-motion";
import {
  Archive,
  ArrowRight,
  Database,
  Gauge,
  Radio,
  Sparkles,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/shared/StatusDot";
import { NOTIFICATIONS, SYSTEM_SERVICES } from "@/data/mockData";
import type { AppNotification } from "@/types";
import { useAppStore } from "@/store/appStore";
import { formatNumber, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Presentation order of the pipeline — service metadata comes from data. */
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

const NOTIFICATION_DOT: Record<AppNotification["tone"], "red" | "amber" | "violet"> = {
  critical: "red",
  high: "red",
  medium: "amber",
  intel: "violet",
};

export function SystemView() {
  const connection = useAppStore((s) => s.connection);
  const setConnection = useAppStore((s) => s.setConnection);
  const demoMode = useAppStore((s) => s.demoMode);
  const streamPaused = useAppStore((s) => s.streamPaused);
  const soundEnabled = useAppStore((s) => s.soundEnabled);

  const offline = connection === "offline";
  const servicesById = new Map(SYSTEM_SERVICES.map((svc) => [svc.id, svc]));
  const operationalCount = SYSTEM_SERVICES.filter((s) => s.status === "operational").length;

  const envRows: { label: string; value: string; tone?: "good" | "bad" }[] = [
    { label: "Deployment", value: "Buildathon demo sandbox" },
    { label: "Region", value: "ap-south-1 (Mumbai)" },
    { label: "Data source", value: "Mock dataset v1.2 — deterministic" },
    { label: "Live streaming", value: demoMode ? (streamPaused ? "Enabled · arrivals paused" : "Enabled (scripted arrivals)") : "Disabled" },
    { label: "Critical alerts", value: soundEnabled ? "Chime on critical arrivals" : "Muted (toast only)" },
    {
      label: "API connection",
      value: offline ? "Disconnected" : "Connected",
      tone: offline ? "bad" : "good",
    },
    { label: "Audit log", value: "Enabled · append-only" },
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
          Service status for the RazorShield risk pipeline.
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
              if (!svc) return null;
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
                      <p className="truncate text-[12px] font-medium text-slate-200">{svc.name}</p>
                      <p className="num text-[10.5px] text-slate-500">
                        {formatNumber(svc.latencyMs)} ms
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
            {operationalCount}/{SYSTEM_SERVICES.length} operational
          </span>
        </div>
        <div className="divide-y divide-line/60">
          {SYSTEM_SERVICES.map((svc, i) => {
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
                  <p className="text-[11px] text-slate-500">{svc.detail}</p>
                </div>
                <div className="hidden text-right sm:block">
                  <p className="micro text-slate-600">Latency</p>
                  <p className="num text-[12px] text-slate-300">
                    {formatNumber(svc.latencyMs)} ms
                  </p>
                </div>
                <div className="hidden text-right md:block">
                  <p className="micro text-slate-600">30d uptime</p>
                  <p className="num text-[12px] text-slate-300">{svc.uptimeP30d}</p>
                </div>
                <span
                  className={cn("micro shrink-0 rounded-sm border px-1.5 py-0.5", tone.chip)}
                >
                  {svc.status}
                </span>
              </motion.div>
            );
          })}
        </div>
      </motion.section>

      {/* Environment */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18, duration: 0.35, ease: "easeOut" }}
        className="panel mt-5 overflow-hidden"
        aria-label="Environment"
      >
        <div className="border-b border-line px-4 py-3">
          <h2 className="micro-11 font-semibold text-slate-200">Environment</h2>
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
            <span className="micro text-slate-500">
              {NOTIFICATIONS.filter((n) => !n.read).length} unread
            </span>
          </div>
          <div className="divide-y divide-line/60">
            {NOTIFICATIONS.map((n, i) => (
              <motion.div
                key={n.id}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.06, duration: 0.3 }}
                className="flex items-start gap-3 px-4 py-3"
              >
                <StatusDot
                  tone={NOTIFICATION_DOT[n.tone]}
                  className="mt-[5px]"
                  label={n.tone}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-slate-200">{n.title}</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">{n.body}</p>
                </div>
                <time className="num shrink-0 pt-0.5 text-[11px] text-slate-600">
                  {relativeTime(n.time)}
                </time>
              </motion.div>
            ))}
          </div>
        </motion.section>
      </div>
    </div>
  );
}
