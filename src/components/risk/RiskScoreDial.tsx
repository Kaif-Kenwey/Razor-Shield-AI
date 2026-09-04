"use client";

/**
 * RiskScoreDial — the hero number of the investigation workspace.
 * The score counts up and the arc sweeps to its value on mount.
 */

import { useEffect, useState } from "react";
import { animate, motion } from "framer-motion";
import type { RiskLevel } from "@/types";
import { cn } from "@/lib/utils";

const LEVEL_COLOR: Record<RiskLevel, string> = {
  LOW: "#34d399",
  MEDIUM: "#fbbf24",
  HIGH: "#fb7185",
  CRITICAL: "#f87171",
};

const LEVEL_CAPTION: Record<RiskLevel, string> = {
  LOW: "LOW RISK",
  MEDIUM: "MEDIUM RISK",
  HIGH: "HIGH RISK",
  CRITICAL: "CRITICAL RISK",
};

interface RiskScoreDialProps {
  score: number;
  level: RiskLevel;
  size?: number;
  className?: string;
  animateFrom?: number;
}

export function RiskScoreDial({ score, level, size = 208, className }: RiskScoreDialProps) {
  const [display, setDisplay] = useState(0);
  const stroke = 10;
  const r = (size - stroke) / 2 - 6;
  const c = 2 * Math.PI * r;
  const color = LEVEL_COLOR[level];

  useEffect(() => {
    const controls = animate(0, score, {
      duration: 1.5,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [score]);

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} role="meter" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100} aria-label={`Risk score ${score} of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (c * score) / 100 }}
          transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: level === "CRITICAL" || level === "HIGH" ? `drop-shadow(0 0 10px ${color}66)` : `drop-shadow(0 0 8px ${color}44)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="flex items-baseline gap-1">
          <span
            className="num font-semibold tabular-nums leading-none"
            style={{ fontSize: size * 0.31, color, textShadow: `0 0 34px ${color}55` }}
          >
            {display}
          </span>
          <span className="num text-lg text-slate-500 font-medium">/100</span>
        </div>
        <span className="micro mt-2" style={{ color }}>
          {LEVEL_CAPTION[level]}
        </span>
      </div>
    </div>
  );
}

/** Compact inline score with bar — used in tables and cards. */
export function InlineScore({ score, level }: { score: number; level: RiskLevel }) {
  const color = LEVEL_COLOR[level];
  return (
    <div className="flex items-center gap-2 min-w-[92px]">
      <span className="num text-sm font-semibold w-6 text-right" style={{ color }}>
        {score === 0 ? "—" : score}
      </span>
      <div className="h-1 flex-1 rounded-full bg-slate-500/15 overflow-hidden min-w-[40px]">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}
