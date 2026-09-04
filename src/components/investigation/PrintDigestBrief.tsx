"use client";

/**
 * PRINT DIGEST BRIEF — a paper memo of the pattern digest.
 * Mounted only while a digest print is pending (store flag), then it
 * takes over the printer via the #print-digest-brief id in the global
 * print stylesheet. Email-memo styling, ink-friendly.
 */

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "@/store/appStore";
import { ANALYSTS } from "@/data/mockData";
import { formatINR, formatNumber } from "@/lib/format";

function Head({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: 9.5,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        fontWeight: 600,
        color: "#64748b",
        borderBottom: "1px solid #e2e8f0",
        paddingBottom: 4,
        marginBottom: 8,
        marginTop: 14,
      }}
    >
      {children}
    </h2>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={{ fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "#94a3b8" }}>{label}</dt>
      <dd style={{ fontSize: 11.5, fontWeight: 600, color: "#0f172a", marginTop: 2 }}>{value}</dd>
    </div>
  );
}

export function PrintDigestBrief({ digest }: { digest: DigestSnapshot }) {
  const setDigestPrintOpen = useAppStore((s) => s.setDigestPrintOpen);

  /** hydration-safe mount flag (no setState-in-effect) */
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  useEffect(() => {
    if (!mounted) return;
    const done = () => setDigestPrintOpen(false);
    window.addEventListener("afterprint", done);
    const t = setTimeout(done, 4000); // safety net if afterprint is swallowed
    return () => {
      window.removeEventListener("afterprint", done);
      clearTimeout(t);
    };
  }, [mounted, setDigestPrintOpen]);

  useEffect(() => {
    if (mounted) window.print();
  }, [mounted]);

  if (!mounted) return null;

  const generated = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const trend = (series: number[] | undefined) => {
    if (!series || series.length < 2) return "—";
    const d = series[series.length - 1] - series[0];
    return d > 0 ? `rising (+${d})` : d < 0 ? `easing (${d})` : "flat";
  };

  return createPortal(
    <div
      id="print-digest-brief"
      className="hidden print:block"
      style={{ background: "#ffffff", color: "#0f172a", fontFamily: "ui-sans-serif, system-ui", padding: "4px 2px" }}
      aria-hidden
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "2px solid #0f172a", paddingBottom: 8 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.08em" }}>RAZORSHIELD AI</p>
          <p style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "#64748b", marginTop: 2 }}>
            Pattern digest — analyst briefing
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ fontSize: 12, fontWeight: 700 }}>{digest.todayLabel}</p>
          <p style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>Compiled {generated}</p>
        </div>
      </header>

      <p style={{ fontSize: 10.5, lineHeight: 1.6, color: "#334155", marginTop: 12 }}>
        Live brief compiled from the {formatNumber(digest.analyzed)}-transaction window. {digest.open.length} cases remain
        open with {formatINR(digest.exposure)} under scrutiny; average open score {digest.avgOpenScore}/100.
        {digest.hottest
          ? ` Highest exposure: ${digest.hottest.id} at ${digest.hottest.riskScore}/100 (${formatINR(digest.hottest.amount)}, ${digest.hottest.location}).`
          : ""}
      </p>

      <Head>Window summary</Head>
      <dl style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px 16px" }}>
        <Cell label="Open cases" value={String(digest.open.length)} />
        <Cell label="Exposure" value={formatINR(digest.exposure)} />
        <Cell label="Avg open score" value={`${digest.avgOpenScore}/100`} />
        <Cell label="Resolved" value={String(digest.resolved)} />
        <Cell label="Blocked" value={String(digest.blocked)} />
        <Cell label="SLA breached" value={String(digest.slaBreached)} />
        <Cell label="Notebook entries" value={String(digest.notebookEntries)} />
        <Cell label="Cases annotated" value={String(digest.notebookCases)} />
        <Cell label="Transactions in window" value={formatNumber(digest.analyzed)} />
      </dl>

      {digest.topSignals.length > 0 && (
        <>
          <Head>Dominant signals in open cases</Head>
          <ul style={{ columns: 2, fontSize: 10.5, color: "#334155", paddingLeft: 16 }}>
            {digest.topSignals.map(([title, count]) => (
              <li key={title} style={{ marginBottom: 3 }}>
                {title} — {count} open case{count === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        </>
      )}

      {digest.topLocations.length > 0 && (
        <>
          <Head>Top origin geographies</Head>
          <p style={{ fontSize: 10.5, color: "#334155" }}>
            {digest.topLocations.map(([loc, count]) => `${loc} (${count})`).join(" · ")}
          </p>
        </>
      )}

      <Head>Analyst workload</Head>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#94a3b8", fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            <th style={{ padding: "3px 6px 3px 0" }}>Analyst</th>
            <th style={{ padding: "3px 6px" }}>Level</th>
            <th style={{ padding: "3px 6px", textAlign: "right" }}>Open</th>
            <th style={{ padding: "3px 6px", textAlign: "right" }}>Exposure</th>
            <th style={{ padding: "3px 6px", textAlign: "right" }}>Peak score</th>
            <th style={{ padding: "3px 0 3px 6px", textAlign: "right" }}>12-window trend</th>
          </tr>
        </thead>
        <tbody>
          {digest.workload.map((w) => (
            <tr key={w.analyst.id} style={{ borderTop: "1px solid #e2e8f0" }}>
              <td style={{ padding: "4px 6px 4px 0", fontWeight: 600, whiteSpace: "nowrap" }}>
                {w.analyst.name}
                {w.analyst.id === digest.signedInId ? " (you)" : ""}
              </td>
              <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>{w.analyst.level}</td>
              <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: 700 }}>{w.count}</td>
              <td style={{ padding: "4px 6px", textAlign: "right" }}>{formatINR(w.exposure)}</td>
              <td style={{ padding: "4px 6px", textAlign: "right" }}>{w.hottest || "—"}</td>
              <td style={{ padding: "4px 0 4px 6px", textAlign: "right", whiteSpace: "nowrap" }}>
                {trend(digest.loadHistory[w.analyst.id])}
              </td>
            </tr>
          ))}
          {digest.unassigned.count > 0 && (
            <tr style={{ borderTop: "1px solid #e2e8f0" }}>
              <td style={{ padding: "4px 6px 4px 0", color: "#64748b" }}>Unassigned pool</td>
              <td style={{ padding: "4px 6px" }}>—</td>
              <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: 700 }}>{digest.unassigned.count}</td>
              <td style={{ padding: "4px 6px", textAlign: "right" }}>{formatINR(digest.unassigned.exposure)}</td>
              <td style={{ padding: "4px 6px", textAlign: "right" }}>{digest.unassigned.hottest || "—"}</td>
              <td style={{ padding: "4px 0 4px 6px", textAlign: "right" }}>—</td>
            </tr>
          )}
        </tbody>
      </table>

      <footer style={{ marginTop: 16, borderTop: "1px solid #e2e8f0", paddingTop: 6, fontSize: 8.5, color: "#94a3b8", lineHeight: 1.5 }}>
        RazorShield AI · Razorpay AI Buildathon 2026 demo environment. Every figure in this brief is derived live from the
        on-screen case window; workload trend is a synthetic demo series. Handoff is advisory — bounded actions stay with the
        signed-in analyst ({ANALYSTS.find((a) => a.id === digest.signedInId)?.name ?? "—"}) and are recorded in the audit trail.
      </footer>
    </div>,
    document.body
  );
}

/** Shape handed from DigestModal so screen + paper stay identical. */
export interface DigestSnapshot {
  open: { id: string; riskScore: number; amount: number; location: string }[];
  resolved: number;
  blocked: number;
  avgOpenScore: number;
  exposure: number;
  analyzed: number;
  topSignals: [string, number][];
  topLocations: [string, number][];
  hottest: { id: string; riskScore: number; amount: number; location: string } | null;
  workload: { analyst: { id: string; name: string; level: string }; count: number; exposure: number; hottest: number }[];
  unassigned: { count: number; exposure: number; hottest: number };
  /** Analyst evidence logged in the window notebook. */
  notebookEntries: number;
  notebookCases: number;
  /** Open cases past the 30m review-SLA escalation threshold. */
  slaBreached: number;
  loadHistory: Record<string, number[]>;
  signedInId: string;
  todayLabel: string;
}
