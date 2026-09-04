"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Database, RefreshCw, SearchX, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function SectionHeader({
  eyebrow,
  title,
  right,
  className,
}: {
  eyebrow?: string;
  title: string;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-end justify-between gap-4", className)}>
      <div>
        {eyebrow && <p className="micro text-slate-500 mb-1">{eyebrow}</p>}
        <h2 className="text-[15px] font-semibold tracking-tight text-slate-100">{title}</h2>
      </div>
      {right}
    </div>
  );
}

export function FeedSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border" aria-label="Loading transactions" role="status">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className="h-3.5 w-24 rounded bg-slate-500/12 animate-pulse" style={{ animationDelay: `${i * 90}ms` }} />
          <div className="h-3.5 w-16 rounded bg-slate-500/10 animate-pulse" style={{ animationDelay: `${i * 90 + 60}ms` }} />
          <div className="hidden md:block h-3.5 w-20 rounded bg-slate-500/8 animate-pulse" style={{ animationDelay: `${i * 90 + 120}ms` }} />
          <div className="ml-auto h-3.5 w-28 rounded bg-slate-500/8 animate-pulse" style={{ animationDelay: `${i * 90 + 180}ms` }} />
        </div>
      ))}
    </div>
  );
}

export function PanelSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("panel p-5", className)} role="status" aria-label="Loading">
      <div className="h-2.5 w-24 rounded bg-slate-500/12 animate-pulse" />
      <div className="mt-4 h-8 w-36 rounded bg-slate-500/10 animate-pulse" />
      <div className="mt-6 space-y-2">
        <div className="h-3 w-full rounded bg-slate-500/8 animate-pulse" />
        <div className="h-3 w-4/5 rounded bg-slate-500/8 animate-pulse" />
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface-2 text-slate-400">
        {icon ?? <SearchX className="h-5 w-5" aria-hidden />}
      </div>
      <p className="text-sm font-medium text-slate-200">{title}</p>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-slate-500">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * Connection-lost state. Calm, recoverable — never catastrophic.
 */
export function ConnectionLostState({ onRetry, retrying = false }: { onRetry: () => void; retrying?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="relative mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-amber-400/25 bg-amber-400/8 text-risk-medium">
        <WifiOff className="h-6 w-6" aria-hidden />
      </div>
      <p className="micro text-risk-medium mb-2">Connection status</p>
      <h3 className="text-lg font-semibold text-slate-100">Risk engine connection lost</h3>
      <p className="mt-2 max-w-md text-[13px] leading-relaxed text-slate-500">
        Live scoring and investigations are paused. Your last known data is still visible below.
        No actions are being taken on your behalf while offline.
      </p>
      <Button
        onClick={onRetry}
        disabled={retrying}
        className="mt-6 gap-2 border border-line bg-surface-2 text-slate-200 hover:bg-surface-3"
      >
        {retrying ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
        {retrying ? "Reconnecting…" : "Retry connection"}
      </Button>
    </div>
  );
}

export function ModelUnavailableState({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      icon={<AlertTriangle className="h-5 w-5 text-risk-medium" aria-hidden />}
      title="Model unavailable"
      body="The scoring model could not be reached. Transactions are still being captured and will be scored retroactively."
      action={
        <Button variant="outline" onClick={onRetry} className="gap-2 border-line bg-surface-2 hover:bg-surface-3">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry
        </Button>
      }
    />
  );
}

export function DatabaseUnavailableState() {
  return (
    <EmptyState
      icon={<Database className="h-5 w-5 text-slate-400" aria-hidden />}
      title="Case store unreachable"
      body="Investigation history is temporarily unavailable. Live monitoring continues; resolved cases will sync once the store reconnects."
    />
  );
}
