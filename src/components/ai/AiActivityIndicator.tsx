"use client";

/**
 * AI ACTIVITY INDICATOR — makes the agent feel like an active investigator.
 * Two states:
 *   analyzing → live checklist with spinner on the current step
 *   complete  → all steps ticked, calm summary
 */

import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AiStep {
  label: string;
}

interface AiActivityIndicatorProps {
  steps: AiStep[];
  /** Index of the step currently running; steps.length === done. */
  currentStep: number;
  done: boolean;
  className?: string;
}

export function AiActivityIndicator({ steps, currentStep, done, className }: AiActivityIndicatorProps) {
  return (
    <div className={cn("space-y-2.5", className)} aria-live="polite">
      <AnimatePresence initial={false}>
        {steps.map((step, i) => {
          const isDone = done || i < currentStep;
          const isActive = !done && i === currentStep;
          const visible = done || i <= currentStep;
          if (!visible) return null;
          return (
            <motion.div
              key={step.label}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="flex items-center gap-2.5"
            >
              <span
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full border",
                  isDone
                    ? "border-risk-low/40 bg-risk-low/10 text-risk-low"
                    : isActive
                      ? "border-intel/50 bg-intel/10 text-intel"
                      : "border-line bg-surface-2 text-slate-600"
                )}
              >
                {isDone ? (
                  <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
                ) : isActive ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden />
                ) : (
                  <span className="h-1 w-1 rounded-full bg-slate-600" />
                )}
              </span>
              <span
                className={cn(
                  "text-[12.5px] tracking-tight",
                  isDone ? "text-slate-400" : isActive ? "text-slate-200" : "text-slate-500"
                )}
              >
                {isActive ? step.label.replace(/^✓ /, "◌ ") : step.label}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/** Predefined investigation checklist (analyst-facing, no chain-of-thought). */
export const AI_INVESTIGATION_STEPS: AiStep[] = [
  { label: "Customer history analyzed" },
  { label: "Device history analyzed" },
  { label: "Location anomaly checked" },
  { label: "Risk signals correlated" },
  { label: "Recommendation generated" },
];
