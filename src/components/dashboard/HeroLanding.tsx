"use client";

/**
 * HERO — first-load command center landing state.
 * Sets the tone: PAYMENT RISK UNDER INVESTIGATION.
 */

import { motion } from "framer-motion";
import { ArrowRight, BarChart3, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/shared/StatusDot";
import { AiStatusPill } from "@/components/ai/AiStatusPill";
import { useAppStore } from "@/store/appStore";
import { RISK_METRICS } from "@/data/mockData";
import { formatNumber } from "@/lib/format";

const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
};

export function HeroLanding() {
  const navigate = useAppStore((s) => s.navigate);
  const openInvestigation = useAppStore((s) => s.openInvestigation);
  const transactions = useAppStore((s) => s.transactions);
  const loading = useAppStore((s) => s.loading);
  const connection = useAppStore((s) => s.connection);

  const topCase = transactions.find((t) => t.riskLevel === "CRITICAL" && t.status === "INVESTIGATING");
  /* graceful target: flagship first, else the hottest open case — never a dead CTA,
     even after every critical case has been resolved in this browser */
  const hottestOpen = transactions
    .filter((t) => (t.riskLevel === "CRITICAL" || t.riskLevel === "HIGH") && t.status !== "BLOCKED")
    .sort((a, b) => b.riskScore - a.riskScore)[0];
  const ctaTarget = topCase ?? hottestOpen ?? null;
  /* the CTA needs the live window — a dead click on first paint is worse than a brief wait */
  const ctaReady = !loading && transactions.length > 0;

  return (
    <section className="relative overflow-hidden" aria-label="RazorShield AI overview">
      <div className="absolute inset-0 grid-bg grid-fade" aria-hidden />
      {/* violet horizon glow — intelligence, not decoration */}
      <div className="absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgba(139,92,246,0.10),transparent_70%)]" aria-hidden />

      <div className="relative mx-auto flex max-w-4xl flex-col items-center px-6 pb-16 pt-20 text-center sm:pt-24">
        <motion.div {...fadeUp} transition={{ duration: 0.45, ease: "easeOut" }} className="flex items-center gap-2.5">
          <ShieldCheck className="h-4 w-4 text-intel" aria-hidden />
          <span className="micro-11 text-slate-400">RazorShield AI</span>
          <span className="h-3 w-px bg-line-strong" aria-hidden />
          <span className="micro-11 text-slate-600">Razorpay AI Buildathon 2026</span>
        </motion.div>

        <motion.h1
          {...fadeUp}
          transition={{ duration: 0.5, delay: 0.08, ease: "easeOut" }}
          className="mt-7 text-[34px] font-semibold leading-[1.06] tracking-[-0.02em] text-slate-50 sm:text-5xl md:text-[56px]"
        >
          Payment risk
          <br />
          <span className="text-slate-500">under</span>{" "}
          <span className="relative text-slate-100">
            investigation
            <motion.span
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.7, delay: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="absolute -bottom-1 left-0 h-[3px] w-full origin-left rounded-full bg-gradient-to-r from-risk-critical/70 via-risk-high/50 to-transparent"
            />
          </span>
          .
        </motion.h1>

        <motion.p
          {...fadeUp}
          transition={{ duration: 0.5, delay: 0.16, ease: "easeOut" }}
          className="mt-6 max-w-xl text-balance text-[15px] leading-relaxed text-slate-400"
        >
          Detect anomalies. Investigate evidence. Act with confidence.
          RazorShield correlates device, location, amount and velocity signals into
          explainable investigations — with bounded, auditable actions.
        </motion.p>

        <motion.div
          {...fadeUp}
          transition={{ duration: 0.5, delay: 0.24, ease: "easeOut" }}
          className="mt-9 flex flex-col items-center gap-3 sm:flex-row"
        >
          <Button
            size="lg"
            disabled={!ctaReady}
            aria-label={ctaReady ? "Investigate high-risk transactions" : "Connecting to the risk engine…"}
            onClick={() => (ctaTarget ? openInvestigation(ctaTarget.id) : navigate("investigations"))}
            className="glow-critical group h-11 gap-2.5 border border-risk-critical/40 bg-risk-critical/12 px-6 text-[13px] font-semibold tracking-wide text-risk-critical hover:bg-risk-critical/20 disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none"
          >
            {ctaReady ? "Investigate high-risk transactions" : "Connecting to the risk engine…"}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => navigate("intelligence")}
            className="h-11 gap-2.5 border-line bg-surface-1 px-6 text-[13px] font-medium text-slate-300 hover:bg-surface-2 hover:text-slate-100"
          >
            <BarChart3 className="h-4 w-4 text-slate-500" aria-hidden />
            View risk intelligence
          </Button>
        </motion.div>

        <motion.div
          {...fadeUp}
          transition={{ duration: 0.5, delay: 0.34, ease: "easeOut" }}
          className="mt-14 grid w-full grid-cols-2 gap-px overflow-hidden rounded-sm border border-line bg-line sm:grid-cols-4"
          aria-label="Live risk environment"
        >
          {RISK_METRICS.map((m) => (
            <div key={m.key} className="bg-surface-1/80 px-4 py-3.5 text-left backdrop-blur-sm">
              <p className="micro text-slate-500">{m.label}</p>
              <p className="num mt-1.5 text-lg font-semibold text-slate-100">{formatNumber(m.value)}</p>
            </div>
          ))}
        </motion.div>

        <motion.div
          {...fadeUp}
          transition={{ duration: 0.5, delay: 0.44, ease: "easeOut" }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <AiStatusPill />
          <div className="flex h-8 items-center gap-2 rounded-sm border border-line bg-surface-1 px-2.5">
            <StatusDot tone={connection === "online" ? "green" : "amber"} pulse />
            <span className="micro text-slate-400">Risk engine operational</span>
          </div>
          <div className="flex h-8 items-center gap-2 rounded-sm border border-line bg-surface-1 px-2.5">
            <StatusDot tone="green" pulse />
            <span className="micro text-slate-400">Event stream live</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
