"use client";

/**
 * DATA QUALITY — can this run support the engine at all?
 *
 * A scored run is only as honest as the file behind it. This panel grades
 * the run's inputs (not the engine): completeness of the critical fields the
 * rules depend on, availability of identity/graph identifiers, and label
 * coverage. Deficits are named concretely so the analyst knows which
 * signals degrade on which rows.
 */

import { useMemo } from "react";
import { Database } from "lucide-react";

import type { ScoredRow } from "@/types/dataset";
import { cn } from "@/lib/utils";

interface QualityDimension {
  key: string;
  label: string;
  /** Points this dimension contributes to the 100-point score. */
  weight: number;
  /** Share of rows where the field is usable, 0-100. */
  coverage: number;
  /** Why it matters when missing. */
  impact: string;
}

function missingDevice(device: string): boolean {
  const k = device.trim().toLowerCase();
  return !k || k.startsWith("unknown");
}

export function computeDataQuality(rows: ScoredRow[]) {
  const total = rows.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  const missingTimestamp = rows.filter((r) => !r.timestamp).length;
  const missingDevice = rows.filter((r) => missingDevice(r.device)).length;
  const missingCustomer = rows.filter((r) => !r.customerId).length;
  const missingAmount = rows.filter((r) => !(r.amount > 0)).length;
  const missingLabel = rows.filter((r) => r.label === null).length;

  const dimensions: QualityDimension[] = [
    {
      key: "amount",
      label: "Amount",
      weight: 20,
      coverage: pct(total - missingAmount),
      impact: "amount rules and every rupee figure degrade",
    },
    {
      key: "timestamp",
      label: "Timestamp",
      weight: 20,
      coverage: pct(total - missingTimestamp),
      impact: "velocity, impossible-travel and odd-hour rules go blind on those rows",
    },
    {
      key: "customer",
      label: "Customer ID",
      weight: 20,
      coverage: pct(total - missingCustomer),
      impact: "no baselines can form — the customer-relative rules stay silent",
    },
    {
      key: "device",
      label: "Device fingerprint",
      weight: 20,
      coverage: pct(total - missingDevice),
      impact: "device signals degrade for those rows, and the graph loses its linking edges",
    },
    {
      key: "labels",
      label: "Fraud labels",
      weight: 20,
      coverage: pct(total - missingLabel),
      impact: "precision, recall and calibration cannot be measured for unlabeled rows",
    },
  ];

  const score = Math.round(dimensions.reduce((s, d) => s + (d.coverage / 100) * d.weight, 0));
  const deficits = dimensions
    .filter((d) => d.coverage < 100)
    .map((d) => ({
      ...d,
      missingPct: 100 - d.coverage,
    }))
    .sort((a, b) => b.missingPct * b.weight - a.missingPct * a.weight)
    .slice(0, 3);

  return { total, score, dimensions, deficits };
}

export function DataQuality({ rows, skippedCount }: { rows: ScoredRow[]; skippedCount: number }) {
  const quality = useMemo(() => computeDataQuality(rows), [rows]);
  const tone = quality.score >= 85 ? "text-risk-low" : quality.score >= 65 ? "text-risk-medium" : "text-risk-critical";
  const barTone =
    quality.score >= 85 ? "bg-risk-low" : quality.score >= 65 ? "bg-risk-medium" : "bg-risk-critical";

  return (
    <section className="panel p-4" aria-label="Data quality">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="micro-11 flex items-center gap-1.5 font-semibold text-slate-200">
          <Database className="h-3.5 w-3.5 text-intel" aria-hidden />
          Data quality — can this run support the engine?
        </p>
        {skippedCount > 0 && (
          <span className="num micro-11 text-slate-600">
            {skippedCount} rows skipped at import (unusable amount)
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
        {/* score figure */}
        <div>
          <p className="micro text-slate-500">Data quality</p>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className={cn("num text-[38px] font-semibold leading-none tracking-tight", tone)}>
              {quality.score}%
            </span>
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn("h-full rounded-full transition-all", barTone)}
              style={{ width: `${quality.score}%` }}
            />
          </div>
          <p className="micro-11 mt-2 leading-snug text-slate-600">
            Weighted across {quality.total} scored rows — field completeness, graph identifiers and label coverage.
          </p>
        </div>

        {/* coverage + deficits */}
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {quality.dimensions.map((d) => (
              <span
                key={d.key}
                title={`${d.label}: ${d.coverage}% of rows usable`}
                className={cn(
                  "num rounded-sm border px-2 py-1 micro-11",
                  d.coverage >= 95
                    ? "border-risk-low/25 bg-risk-low/8 text-risk-low"
                    : d.coverage >= 70
                      ? "border-risk-medium/30 bg-risk-medium/8 text-risk-medium"
                      : "border-risk-critical/30 bg-risk-critical/8 text-risk-critical",
                )}
              >
                {d.label} {d.coverage}%
              </span>
            ))}
          </div>
          {quality.deficits.length > 0 ? (
            <ul className="space-y-1.5">
              {quality.deficits.map((d) => (
                <li key={d.key} className="flex items-start gap-1.5">
                  <span className="mt-[7px] h-0.5 w-0.5 shrink-0 rounded-full bg-risk-medium" aria-hidden />
                  <span className="text-[11px] leading-snug text-slate-400">
                    <span className="num font-medium text-risk-medium">{d.missingPct}%</span> of rows missing{" "}
                    {d.label.toLowerCase()} — {d.impact}.
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] leading-snug text-slate-400">
              No material gaps — every critical field, device fingerprint and label is present. The metrics
              on this page rest on the full file.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
