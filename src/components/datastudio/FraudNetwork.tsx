"use client";

/**
 * FRAUD NETWORK — entity-graph view of coordinated activity in a run.
 *
 * Left: ranked rings with score, exposure and evidence. Right: a
 * bipartite SVG of the selected ring — shared devices (the linking
 * infrastructure) on the left, member accounts on the right, edges
 * weighted by how many transactions run across them.
 */

import { useMemo, useState } from "react";
import { Network, ShieldAlert } from "lucide-react";
import { detectFraudRings, type FraudRing } from "@/lib/fraudGraph";
import { formatINR } from "@/lib/format";
import type { ScoredRow } from "@/types/dataset";
import { cn } from "@/lib/utils";

const FRAUD = "#f87171";
const MIXED = "#fbbf24";
const CLEAN = "#34d399";
const DEVICE = "#a78bfa";
const EDGE = "#52525b";

function memberTone(m: FraudRing["members"][number]): string {
  if (m.fraudCount > 0 && m.fraudCount >= m.txCount) return FRAUD;
  if (m.fraudCount > 0) return MIXED;
  return CLEAN;
}

function RingGraph({ ring }: { ring: FraudRing }) {
  const devices = ring.devices;
  const members = ring.members;

  const H = Math.max(devices.length, members.length) * 52 + 48;
  const devY = (i: number) => H / 2 + (i - (devices.length - 1) / 2) * 52;
  const memY = (i: number) => H / 2 + (i - (members.length - 1) / 2) * 52;

  const edges: { d: string; m: string; w: number }[] = [];
  // Edge weight ≈ how heavily the member uses the shared infra: each
  // member's transaction count split evenly across the ring's devices.
  for (const m of members) {
    const w = Math.max(1, Math.round(m.txCount / Math.max(1, devices.length)));
    for (const d of devices) edges.push({ d, m: m.customerId, w });
  }

  return (
    <svg
      viewBox={`0 0 460 ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Fraud ring graph: ${ring.members.length} accounts connected through ${ring.devices.length} shared devices`}
    >
      {/* edges */}
      {edges.map((e) => {
        const di = devices.findIndex((d) => d === e.d);
        const mi = members.findIndex((m) => m.customerId === e.m);
        if (di < 0 || mi < 0) return null;
        return (
          <line
            key={`${e.d}-${e.m}`}
            x1={148}
            y1={devY(di)}
            x2={318}
            y2={memY(mi)}
            stroke={EDGE}
            strokeWidth={Math.min(4, 0.8 + e.w * 0.5)}
            strokeOpacity={0.55}
          />
        );
      })}

      {/* device nodes */}
      {devices.map((d, i) => (
        <g key={d}>
          <rect
            x={64}
            y={devY(i) - 13}
            width={84}
            height={26}
            rx={5}
            fill="#1c1a2e"
            stroke={DEVICE}
            strokeOpacity={0.7}
          />
          <text x={106} y={devY(i) + 4} textAnchor="middle" fill={DEVICE} fontSize={10} fontFamily="ui-monospace, monospace">
            {d.length > 12 ? d.slice(0, 11) + "…" : d}
          </text>
          <text x={106} y={devY(i) - 18} textAnchor="middle" fill="#71717a" fontSize={8.5}>
            shared device
          </text>
        </g>
      ))}

      {/* member nodes */}
      {members.map((m, i) => (
        <g key={m.customerId}>
          <circle cx={318} cy={memY(i)} r={9} fill={memberTone(m)} fillOpacity={0.85} />
          <text x={334} y={memY(i) + 3.5} fill="#d4d4d8" fontSize={10.5}>
            {m.customerName.length > 16 ? m.customerName.slice(0, 15) + "…" : m.customerName}
          </text>
          <text x={334} y={memY(i) + 14.5} fill="#71717a" fontSize={8.5} fontFamily="ui-monospace, monospace">
            {m.customerId} · {m.txCount} txns
          </text>
        </g>
      ))}

      {/* header */}
      <text x={106} y={16} textAnchor="middle" fill="#71717a" fontSize={9}>
        INFRASTRUCTURE
      </text>
      <text x={318} y={16} textAnchor="middle" fill="#71717a" fontSize={9}>
        ACCOUNTS
      </text>
    </svg>
  );
}

export function FraudNetwork({ rows }: { rows: ScoredRow[] }) {
  const rings = useMemo(() => detectFraudRings(rows), [rows]);
  const [selected, setSelected] = useState(0);
  const ring = rings[selected] ?? null;

  if (!rings.length) {
    return (
      <section className="panel p-4" aria-label="Fraud network">
        <p className="micro-11 flex items-center gap-1.5 font-semibold text-slate-200">
          <Network className="h-3.5 w-3.5 text-intel" aria-hidden />
          Fraud network — entity-graph ring detection
        </p>
        <p className="micro-11 mt-3 leading-relaxed text-slate-500">
          No coordinated clusters in this run — no device was shared across accounts. Fraud rings rotate
          mule accounts through shared devices and instruments; when that pattern appears, this panel links
          the accounts into one case.
        </p>
      </section>
    );
  }

  const hot = ring && ring.ringScore >= 60;

  return (
    <section className="panel p-4" aria-label="Fraud network">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="micro-11 flex items-center gap-1.5 font-semibold text-slate-200">
          <Network className="h-3.5 w-3.5 text-intel" aria-hidden />
          Fraud network — entity-graph ring detection
        </p>
        <span className="micro-11 text-slate-600">
          {rings.length} {rings.length === 1 ? "cluster" : "clusters"} found
        </span>
      </div>

      {ring && hot && (
        <div className="mt-3 flex items-start gap-2 rounded-sm border border-risk-critical/35 bg-risk-critical/8 px-3 py-2.5">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-risk-critical" aria-hidden />
          <p className="micro-11 leading-relaxed text-risk-critical">
            Possible coordinated fraud ring — {ring.members.length} accounts, {ring.devices.length}{" "}
            {ring.devices.length === 1 ? "device" : "devices"}, {ring.methods.length}{" "}
            {ring.methods.length === 1 ? "instrument" : "instruments"}, {formatINR(ring.totalAmount)} exposure.
            Review the cluster as one case, not {ring.txCount} separate alerts.
            {ring.fraudMissedByRules > 0 && (
              <>
                {" "}Per-row rules missed <span className="num font-semibold">{ring.fraudMissedByRules}</span> confirmed-fraud{" "}
                {ring.fraudMissedByRules === 1 ? "row" : "rows"} here — visible only at the graph level.
              </>
            )}
          </p>
        </div>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* ring list */}
        <div className="space-y-2">
          {rings.map((r, i) => (
            <button
              key={r.id}
              onClick={() => setSelected(i)}
              aria-pressed={i === selected}
              className={cn(
                "w-full rounded-sm border p-3 text-left transition-colors",
                i === selected
                  ? "border-intel/50 bg-intel/8"
                  : "border-line bg-surface-2/40 hover:border-line-strong",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="micro-11 font-semibold text-slate-200">
                  RING {String(i + 1).padStart(2, "0")} · {r.members.length} accounts
                </span>
                <span
                  className={cn(
                    "num rounded-sm border px-1.5 py-0.5 text-[10.5px] font-bold",
                    r.ringScore >= 60
                      ? "border-risk-critical/40 bg-risk-critical/10 text-risk-critical"
                      : r.ringScore >= 35
                        ? "border-risk-medium/40 bg-risk-medium/10 text-risk-medium"
                        : "border-line bg-surface-1 text-slate-400",
                  )}
                >
                  ring score {r.ringScore}
                </span>
              </div>
              <div className="num micro-11 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-slate-500">
                <span>{r.txCount} txns</span>
                <span>{formatINR(r.totalAmount)}</span>
                {r.fraudCount > 0 && (
                  <span className="text-risk-critical">
                    {r.fraudCount} fraud · {formatINR(r.fraudAmount)}
                  </span>
                )}
              </div>
              <ul className="mt-2 space-y-1">
                {r.evidence.slice(0, 3).map((e) => (
                  <li key={e} className="flex items-start gap-1.5 text-[11px] leading-snug text-slate-400">
                    <span className="mt-1 h-0.5 w-0.5 shrink-0 rounded-full bg-slate-500" aria-hidden />
                    {e}
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>

        {/* graph */}
        {ring && (
          <div className="rounded-sm border border-line bg-surface-1/50 p-3">
            <RingGraph ring={ring} />
            <p className="micro-11 mt-2 leading-relaxed text-slate-600">
              Devices shared across accounts are the linking infrastructure; edge thickness is transaction
              volume. Node color: red = labeled fraud, amber = mixed, green = clean so far. The cluster is
              one investigation — accounts on the left column are mule candidates.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
