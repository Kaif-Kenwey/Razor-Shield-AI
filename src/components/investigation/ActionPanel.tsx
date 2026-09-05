"use client";

/**
 * INVESTIGATION ACTIONS — bounded actions with real weight.
 * BLOCK opens a confirmation modal that restates the case before locking it in.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Ban,
  CheckCircle2,
  Eye,
  Lock,
  PauseCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/appStore";
import { ANALYSTS } from "@/data/mockData";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Investigation, RiskAction, Transaction } from "@/types";

const ACTIONS: { key: RiskAction; icon: LucideIcon; tone: string; ring: string }[] = [
  { key: "ALLOW", icon: CheckCircle2, tone: "text-risk-low border-risk-low/35 hover:bg-risk-low/12", ring: "focus-visible:ring-risk-low/50" },
  { key: "REVIEW", icon: Eye, tone: "text-risk-medium border-risk-medium/35 hover:bg-risk-medium/12", ring: "focus-visible:ring-risk-medium/50" },
  { key: "HOLD", icon: PauseCircle, tone: "text-orange-300 border-orange-400/35 hover:bg-orange-400/12", ring: "focus-visible:ring-orange-400/50" },
  { key: "BLOCK", icon: Ban, tone: "text-risk-critical border-risk-critical/45 hover:bg-risk-critical/14", ring: "focus-visible:ring-risk-critical/50" },
];

export function ActionPanel({
  txn,
  investigation,
  analyzing,
}: {
  txn: Transaction;
  investigation: Investigation | null;
  analyzing: boolean;
}) {
  const resolveAction = useAppStore((s) => s.resolveAction);
  const signedInId = useAppStore((s) => s.signedInAnalystId);
  const signedIn = ANALYSTS.find((a) => a.id === signedInId) ?? ANALYSTS[0];
  const [pending, setPending] = useState<RiskAction | null>(null);
  const [note, setNote] = useState("");
  const resolved = investigation?.analystAction;
  const resolvedBy = useAppStore((s) => {
    const d = s.decisions[txn.id];
    return d?.analystId ? ANALYSTS.find((a) => a.id === d.analystId)?.name : undefined;
  });

  const requiresConfirm = (a: RiskAction) => a === "BLOCK" || a === "HOLD";

  const act = (a: RiskAction) => {
    if (requiresConfirm(a)) {
      setPending(a);
      setNote("");
      return;
    }
    commit(a);
  };

  const commit = (a: RiskAction) => {
    resolveAction(txn.id, a, note.trim() || undefined);
    setPending(null);
    setNote("");
  };

  return (
    <section className="panel overflow-hidden" aria-label="Investigation actions">
      <div className="border-b border-line px-4 py-3">
        <p className="micro-11 font-semibold text-slate-200">Investigation actions</p>
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          Bounded actions only. Every choice is logged with your analyst identity.
        </p>
      </div>

      <div className="px-4 py-4">
        {resolved ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-sm border border-risk-low/30 bg-risk-low/8 p-4 text-center"
            role="status"
          >
            <Lock className="mx-auto h-5 w-5 text-risk-low" aria-hidden />
            <p className="num mt-2 text-[15px] font-bold tracking-[0.1em] text-risk-low">{resolved}</p>
            <p className="mt-1 text-[11.5px] text-slate-500">
              Decision recorded{resolvedBy ? ` by ${resolvedBy}` : ""} · case locked in audit trail
            </p>
            {investigation?.analystNote && (
              <p className="mt-2.5 border-t border-risk-low/15 pt-2.5 text-left text-[11.5px] leading-relaxed text-slate-400">
                <span className="text-slate-500">Analyst note:</span> “{investigation.analystNote}”
              </p>
            )}
          </motion.div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              {ACTIONS.map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.key}
                    disabled={analyzing}
                    onClick={() => act(a.key)}
                    className={cn(
                      "flex h-12 items-center justify-center gap-2 rounded-sm border bg-surface-1 text-[12.5px] font-semibold tracking-wide transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
                      a.tone,
                      a.ring
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {a.key}
                  </button>
                );
              })}
            </div>
            {analyzing && (
              <p className="mt-3 text-center text-[11px] text-slate-600" aria-live="polite">
                Actions unlock when the AI investigation completes
              </p>
            )}
          </>
        )}
      </div>

      {/* Confirm modal */}
      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto border-line bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-slate-50">
              <span className="flex h-7 w-7 items-center justify-center rounded-sm border border-risk-critical/40 bg-risk-critical/10">
                <Ban className="h-3.5 w-3.5 text-risk-critical" aria-hidden />
              </span>
              Confirm risk action?
            </DialogTitle>
            <DialogDescription className="text-[12.5px] leading-relaxed text-slate-400">
              You are about to {pending === "BLOCK" ? "block this transaction permanently" : "place this transaction on hold"}.
              The customer will {pending === "BLOCK" ? "see the payment fail" : "be unable to complete it"} and the decision
              will be attributed to your analyst identity.
            </DialogDescription>
          </DialogHeader>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-sm border border-line bg-surface-1 p-4">
            <div>
              <dt className="micro text-slate-500">Transaction</dt>
              <dd className="num mt-0.5 text-[13px] font-semibold text-slate-100">
                {txn.id} <span className="text-slate-400">· {formatINR(txn.amount)}</span>
              </dd>
            </div>
            <div>
              <dt className="micro text-slate-500">Risk score</dt>
              <dd className="num mt-0.5 text-[13px] font-semibold text-risk-critical">{txn.riskScore}/100 · {txn.riskLevel}</dd>
            </div>
            <div className="col-span-2">
              <dt className="micro text-slate-500">Reason</dt>
              <dd className="mt-0.5 text-[12px] leading-relaxed text-slate-300">
                {txn.aiSummary ?? "Multiple independent risk signals converge on abnormal behavior."}
              </dd>
            </div>
            <div>
              <dt className="micro text-slate-500">Model confidence</dt>
              <dd className="num mt-0.5 text-[13px] font-semibold text-slate-100">{txn.confidence ?? "—"}%</dd>
            </div>
            <div>
              <dt className="micro text-slate-500">Action</dt>
              <dd className="mt-0.5 text-[13px] font-bold tracking-wider text-risk-critical">{pending}</dd>
            </div>
            <div className="col-span-2 -mt-0.5 flex items-center gap-2 border-t border-line pt-2.5">
              <dt className="micro shrink-0 text-slate-500">Recorded against</dt>
              <dd className="flex items-center gap-1.5">
                <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-gradient-to-br from-intel/70 to-intel-soft/60 num text-[7.5px] font-bold text-white" aria-hidden>
                  {signedIn.initials}
                </span>
                <span className="num text-[12px] font-semibold text-slate-200">{signedIn.name}</span>
                <span className="num rounded-sm border border-line bg-surface-2 px-1 text-[9px] uppercase tracking-wider text-slate-500">{signedIn.level}</span>
              </dd>
            </div>
          </dl>

          <div className="mt-1">
            <label htmlFor="case-note" className="micro text-slate-500">
              Case note <span className="text-slate-600">· optional, appended to the audit trail</span>
            </label>
            <textarea
              id="case-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 200))}
              rows={2}
              placeholder="e.g. Called customer — confirmed travel to Mumbai, card in possession…"
              className="mt-2 w-full resize-none rounded-sm border border-line bg-surface-1 px-3 py-2 text-[12.5px] leading-relaxed text-slate-200 placeholder:text-slate-600 focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-ring/50"
            />
            <p className="num mt-1 text-right text-[10px] text-slate-600">{note.length}/200</p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setPending(null)} className="text-slate-400 hover:bg-surface-2 hover:text-slate-200">
              Cancel
            </Button>
            <Button
              onClick={() => pending && commit(pending)}
              className="gap-2 bg-risk-critical text-white hover:bg-risk-critical/85 focus-visible:ring-risk-critical/50"
            >
              <Ban className="h-3.5 w-3.5" aria-hidden />
              Confirm {pending}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
