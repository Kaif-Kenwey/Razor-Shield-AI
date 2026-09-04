"use client";

import { ShieldCheck, Sparkles } from "lucide-react";
import { StatusDot } from "@/components/shared/StatusDot";
import { cn } from "@/lib/utils";

/**
 * RAZORSHIELD AI status pill. Idle: ONLINE. Busy: Analyzing…
 */
export function AiStatusPill({
  analyzing = false,
  className,
}: {
  analyzing?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2.5 rounded-sm border px-2.5 py-1.5",
        analyzing ? "border-intel/35 bg-intel/8 glow-intel" : "border-line bg-surface-1",
        className
      )}
      aria-live="polite"
    >
      <Sparkles
        className={cn("h-3.5 w-3.5 text-intel", analyzing && "animate-pulse")}
        aria-hidden
      />
      <div className="flex flex-col leading-tight">
        <span className="micro text-slate-300">RazorShield AI</span>
        <span className="flex items-center gap-1.5 mt-0.5">
          {analyzing ? (
            <>
              <StatusDot tone="violet" pulse label="AI analyzing" />
              <span className="text-[11px] text-intel tracking-tight">Analyzing…</span>
            </>
          ) : (
            <>
              <StatusDot tone="green" pulse label="AI online" />
              <span className="text-[11px] text-risk-low tracking-tight">Online</span>
            </>
          )}
        </span>
      </div>
      {analyzing && <Sparkles className="h-3 w-3 text-intel/40 animate-pulse ml-1" aria-hidden />}
      {!analyzing && <ShieldCheck className="h-3 w-3 text-slate-600 ml-1" aria-hidden />}
    </div>
  );
}
