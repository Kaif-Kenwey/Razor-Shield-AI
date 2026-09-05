"use client";

/**
 * ATTACK SIMULATOR — red team against the live rule engine.
 *
 * Picks one of three adversarial profiles, replays a deterministic
 * multi-wave campaign seeded from the current run's baselines, and shows
 * the honest outcome: per-row detection decays as the attacker adapts,
 * while the entity-graph recovers coordinated fraud the rules never saw.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { Crosshair, Play, ShieldAlert, Swords, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ATTACK_PROFILES,
  simulateAttack,
  type AttackProfileId,
  type AttackSimResult,
} from "@/lib/attackSim";
import { formatINR } from "@/lib/format";
import type { DatasetAnalysis } from "@/types/dataset";
import { cn } from "@/lib/utils";

function WaveStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "bad" | "good";
}) {
  return (
    <div className="rounded-sm border border-line/70 bg-surface-1/60 px-2 py-1.5">
      <p className="micro-11 text-slate-600">{label}</p>
      <p
        className={cn(
          "num mt-0.5 text-[13px] font-semibold leading-none",
          tone === "bad" ? "text-risk-critical" : tone === "good" ? "text-risk-low" : "text-slate-200",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function AttackSimulator({ analysis }: { analysis: DatasetAnalysis | null }) {
  const [profile, setProfile] = useState<AttackProfileId>("ring");
  const [result, setResult] = useState<AttackSimResult | null>(null);
  const [runToken, setRunToken] = useState(0);

  const hasRun = Boolean(analysis && analysis.rows.length > 0);
  // The headline always speaks for the profile that was actually run.
  const meta = ATTACK_PROFILES.find((p) => p.id === (result?.profile ?? profile)) ?? ATTACK_PROFILES[0];

  const run = () => {
    if (!analysis) return;
    setResult(simulateAttack(analysis.rows, profile));
    setRunToken((t) => t + 1);
  };

  /* ---- empty state: no scored run yet ---- */
  if (!hasRun) {
    return (
      <section className="panel p-4" aria-label="Attack simulator">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="micro-11 flex items-center gap-1.5 font-semibold text-slate-200">
            <Swords className="h-3.5 w-3.5 text-risk-medium" aria-hidden />
            Attack sim — adversarial red team
          </p>
        </div>
        <div className="mt-4 flex flex-col items-center justify-center rounded-sm border border-dashed border-line bg-surface-2/30 px-4 py-8 text-center">
          <ShieldAlert className="h-5 w-5 text-slate-600" aria-hidden />
          <p className="mt-2 text-[12.5px] font-medium text-slate-300">Score a dataset to simulate attacks</p>
          <p className="micro-11 mt-1.5 max-w-sm leading-relaxed text-slate-500">
            The simulator seeds fraud attempts from your run&apos;s customer baselines and replays them
            through the real rule engine — no run, no baselines, no attack.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel p-4" aria-label="Attack simulator">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="micro-11 flex items-center gap-1.5 font-semibold text-slate-200">
          <Swords className="h-3.5 w-3.5 text-risk-medium" aria-hidden />
          Attack sim — adversarial red team vs the rule engine
        </p>
        {result && (
          <span className="num micro-11 text-slate-600">seed 0x{result.seedHex} · deterministic replay</span>
        )}
      </div>
      <p className="micro-11 mt-2 max-w-3xl leading-relaxed text-slate-500">
        An arms race, stated honestly: each profile runs three waves against the real engine, and the
        attacker adapts to whatever got caught. Adaptation evades static rules — coordination is what
        betrays organized fraud.
      </p>

      {/* profile picker */}
      <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Attack profile">
        {ATTACK_PROFILES.map((p) => {
          const active = p.id === profile;
          return (
            <button
              key={p.id}
              role="radio"
              aria-checked={active}
              onClick={() => setProfile(p.id)}
              className={cn(
                "rounded-sm border p-2.5 text-left transition-colors active:scale-[0.99]",
                active
                  ? "border-risk-medium/45 bg-risk-medium/8"
                  : "border-line bg-surface-2/40 hover:border-line-strong",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={cn("micro-11 font-semibold", active ? "text-risk-medium" : "text-slate-300")}>
                  {p.label}
                </span>
                <span className="num rounded-sm border border-line bg-surface-1 px-1 py-0.5 text-[9.5px] text-slate-500">
                  {p.tag}
                </span>
              </span>
              <span className="mt-1 block text-[11px] leading-snug text-slate-500">{p.blurb}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" className="gap-1.5" onClick={run}>
          <Play className="h-3.5 w-3.5" aria-hidden />
          {result && result.profile === profile ? "Replay attack" : "Run attack"}
        </Button>
        <span className="micro-11 text-slate-600">
          15-20 synthetic txns per run · scored by engine {analysis?.engineVersion} · mixed with legit-looking traffic
        </span>
      </div>

      {result && (
        <div key={runToken} className="mt-4 space-y-3">
          {/* headline — the money shot */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className={cn(
              "rounded-sm border p-4",
              result.totals.caughtByGraphPct > result.totals.caughtByRulesPct
                ? "border-risk-low/30 bg-risk-low/5"
                : "border-line bg-surface-2/40",
            )}
          >
            <p className="micro text-slate-500">
              {meta.label} campaign · {result.totals.attempted} attacks · {formatINR(result.totals.attemptedExposure)} attempted
            </p>
            <div className="mt-2.5 flex flex-wrap items-end gap-x-4 gap-y-2">
              <div>
                <p className="micro-11 text-slate-600">Rules alone</p>
                <p className="num text-[34px] font-semibold leading-none text-risk-critical">
                  {result.totals.caughtByRulesPct}%
                </p>
              </div>
              <TrendingUp className="mb-1.5 h-4 w-4 text-slate-600" aria-hidden />
              <div>
                <p className="micro-11 text-slate-600">Rules + graph</p>
                <p
                  className={cn(
                    "num text-[34px] font-semibold leading-none",
                    result.totals.caughtByGraphPct > result.totals.caughtByRulesPct
                      ? "text-risk-low"
                      : "text-slate-300",
                  )}
                >
                  {result.totals.caughtByGraphPct}%
                </p>
              </div>
              {result.totals.caughtByGraphPct > result.totals.caughtByRulesPct && (
                <span className="num mb-1 rounded-sm border border-risk-low/35 bg-risk-low/10 px-2 py-1 text-[11.5px] font-semibold text-risk-low">
                  +{result.totals.caughtByGraphPct - result.totals.caughtByRulesPct} pts from ring clustering
                </span>
              )}
              <span className="mb-1 ml-auto text-right">
                <span className="micro-11 block text-slate-600">Missed by rules</span>
                <span className="num text-[15px] font-semibold text-risk-critical">
                  {formatINR(result.totals.missedExposure)}
                </span>
              </span>
            </div>
            <p className="micro-11 mt-3 flex items-start gap-1.5 leading-relaxed text-slate-400">
              <Crosshair className="mt-0.5 h-3 w-3 shrink-0 text-slate-500" aria-hidden />
              {meta.verdict}
            </p>
            {result.graphFoundRings > 0 && (
              <p className="micro-11 mt-1.5 text-slate-500">
                Entity graph clustered {result.graphRingMembers} synthetic accounts into{" "}
                {result.graphFoundRings} ring{result.graphFoundRings === 1 ? "" : "s"} across the waves.
              </p>
            )}
          </motion.div>

          {/* waves */}
          <div className="max-h-96 space-y-2.5 overflow-y-auto scroll-thin pr-1">
            {result.waves.map((w, i) => (
              <motion.div
                key={w.wave}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: 0.08 * i, ease: "easeOut" }}
                className="rounded-sm border border-line bg-surface-2/40 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="micro-11 font-semibold text-slate-200">
                    WAVE {w.wave} — {w.stance}
                  </p>
                  <span className="num micro-11 text-slate-600">median score {w.medianScore}/100</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <WaveStat label="Attempted" value={`${w.attempted} · ${formatINR(w.attemptedExposure)}`} />
                  <WaveStat
                    label="Caught by rules"
                    value={`${w.caughtByRulesPct}%`}
                    tone={w.caughtByRulesPct >= 50 ? "good" : w.caughtByRulesPct > 0 ? "neutral" : "bad"}
                  />
                  <WaveStat
                    label="Missed by rules"
                    value={formatINR(w.missedExposure)}
                    tone={w.missedExposure > 0 ? "bad" : "good"}
                  />
                  <WaveStat
                    label="Caught w/ graph"
                    value={`${w.caughtByGraphPct}%`}
                    tone={w.caughtByGraphPct > w.caughtByRulesPct ? "good" : "neutral"}
                  />
                </div>
                <ul className="mt-2.5 space-y-1.5">
                  {w.narratives.map((line) => (
                    <li key={line} className="flex items-start gap-1.5">
                      <span className="mt-[7px] h-0.5 w-0.5 shrink-0 rounded-full bg-risk-medium" aria-hidden />
                      <span className="text-[11px] leading-snug text-slate-400">{line}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {w.topSignals.length === 0 ? (
                    <span className="num rounded-sm border border-risk-low/25 bg-risk-low/8 px-1.5 py-0.5 text-[10px] text-risk-low">
                      zero signals fired on attack rows
                    </span>
                  ) : (
                    w.topSignals.slice(0, 5).map((s) => (
                      <span
                        key={s.type}
                        className="num rounded-sm border border-risk-medium/25 bg-risk-medium/8 px-1.5 py-0.5 text-[10px] text-risk-medium"
                      >
                        {s.type.replace(/_/g, " ")} ×{s.count}
                      </span>
                    ))
                  )}
                  {w.legitFlagged > 0 && (
                    <span className="num rounded-sm border border-line bg-surface-1 px-1.5 py-0.5 text-[10px] text-slate-400">
                      collateral: {w.legitFlagged}/{w.legitMixed} legit flagged
                    </span>
                  )}
                </div>
              </motion.div>
            ))}
          </div>

          {/* per-txn evidence */}
          <details className="rounded-sm border border-line bg-surface-2/30 px-3 py-2.5">
            <summary className="micro-11 cursor-pointer text-slate-400 select-none">
              Inspect all {result.attackRows.length} synthetic attacks — engine-scored
            </summary>
            <div className="mt-2 max-h-56 overflow-y-auto scroll-thin">
              <table className="w-full min-w-[430px] text-left">
                <thead>
                  <tr className="border-b border-line">
                    {["Txn", "Account", "Amount", "Score", "Action"].map((h) => (
                      <th key={h} className="micro px-2 py-1.5 font-medium text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.attackRows.map((r) => (
                    <tr key={r.txnId} className="border-b border-line/50">
                      <td className="num px-2 py-1.5 text-[11px] text-slate-300">{r.txnId}</td>
                      <td className="px-2 py-1.5 text-[11px] text-slate-400">
                        <span className="num">{r.customerId}</span>
                        <span className="block text-[10px] text-slate-600">{r.device}</span>
                      </td>
                      <td className="num px-2 py-1.5 text-[11px] text-slate-300">{formatINR(r.amount)}</td>
                      <td className="num px-2 py-1.5 text-[11px] text-slate-300">{r.riskScore}</td>
                      <td className="px-2 py-1.5">
                        <span
                          className={cn(
                            "num rounded-sm border px-1.5 py-0.5 text-[10px]",
                            r.recommendation === "ALLOW"
                              ? "border-risk-critical/30 bg-risk-critical/10 text-risk-critical"
                              : "border-risk-low/25 bg-risk-low/8 text-risk-low",
                          )}
                        >
                          {r.recommendation}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <p className="micro-11 leading-relaxed text-slate-600">
            Ground truth here is simulated by construction — every attack row is labeled fraud and every
            filler row legit, so these percentages measure the engine, not the data. The simulator assumes
            the attacker knows the rule thresholds: the honest worst case for static, per-row defenses.
          </p>
        </div>
      )}
    </section>
  );
}
