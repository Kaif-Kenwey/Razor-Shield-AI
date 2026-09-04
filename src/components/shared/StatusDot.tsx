"use client";

import { cn } from "@/lib/utils";

const toneMap = {
  green: "bg-risk-low",
  amber: "bg-risk-medium",
  red: "bg-risk-critical",
  violet: "bg-intel",
  slate: "bg-slate-400",
} as const;

interface StatusDotProps {
  tone?: keyof typeof toneMap;
  pulse?: boolean;
  className?: string;
  label?: string;
}

/** Small live-status dot used across the command center. */
export function StatusDot({ tone = "green", pulse = false, className, label }: StatusDotProps) {
  return (
    <span className={cn("relative inline-flex h-2 w-2 shrink-0", className)} role="img" aria-label={label ?? "status"}>
      {pulse && (
        <span
          className={cn(
            "absolute inline-flex h-full w-full rounded-full live-ping",
            toneMap[tone],
            "opacity-60"
          )}
        />
      )}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", toneMap[tone], pulse && "pulse-dot")} />
    </span>
  );
}
