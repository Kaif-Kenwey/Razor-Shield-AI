"use client";

/**
 * INVESTIGATION TIMELINE — engine + AI events reveal sequentially while the
 * investigation runs, then remain as the case record.
 */

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { TimelineEvent } from "@/types";

const KIND_STYLE = {
  info: { dot: "border-slate-500/50 bg-surface-3", pulse: "" },
  warn: { dot: "border-risk-medium/60 bg-risk-medium/15", pulse: "shadow-[0_0_10px_rgba(251,191,36,0.35)]" },
  model: { dot: "border-slate-400/60 bg-slate-400/15", pulse: "" },
  ai: { dot: "border-intel/60 bg-intel/20", pulse: "shadow-[0_0_10px_rgba(167,139,250,0.45)]" },
  action: { dot: "border-risk-critical/60 bg-risk-critical/20", pulse: "shadow-[0_0_10px_rgba(248,113,113,0.4)]" },
} as const;

export function InvestigationTimeline({
  events,
  visibleCount,
  className,
}: {
  events: TimelineEvent[];
  visibleCount: number;
  className?: string;
}) {
  const shown = events.slice(0, visibleCount);

  return (
    <div className={cn("relative", className)} aria-label="Investigation timeline">
      {shown.length === 0 && (
        <p className="text-[12px] text-slate-500">Timeline will appear as the engine processes the transaction…</p>
      )}
      <ol className="relative space-y-0">
        {shown.map((e, i) => {
          const s = KIND_STYLE[e.kind];
          const last = i === shown.length - 1;
          return (
            <motion.li
              key={e.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.32, ease: "easeOut" }}
              className="relative flex gap-3 pb-4 last:pb-0"
            >
              {/* connector */}
              {!last && (
                <span
                  className="absolute left-[5px] top-4 h-[calc(100%-16px)] w-px bg-line"
                  aria-hidden
                />
              )}
              <span className={cn("relative z-10 mt-1 h-[11px] w-[11px] shrink-0 rounded-full border-2", s.dot, s.pulse)} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className={cn("text-[12.5px] leading-snug", e.kind === "ai" ? "text-slate-200" : "text-slate-300")}>{e.label}</p>
                  <span className="num shrink-0 text-[10.5px] text-slate-600">{e.time}</span>
                </div>
                {e.detail && <p className="mt-0.5 text-[11px] text-slate-500">{e.detail}</p>}
              </div>
            </motion.li>
          );
        })}
      </ol>
      {visibleCount < events.length && (
        <p className="num mt-1 text-[10.5px] text-slate-600" aria-live="polite">
          processing…
          <span className="caret-blink">▍</span>
        </p>
      )}
    </div>
  );
}
