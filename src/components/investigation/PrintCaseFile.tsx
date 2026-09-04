"use client";

/**
 * PRINT CASE FILE — a clean paper report of the investigation.
 * Hidden on screen; when the analyst hits Print, the global print
 * stylesheet makes this the only visible content (see globals.css
 * `@media print` rules) with a light, ink-friendly treatment.
 */

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { formatINR } from "@/lib/format";
import { ANALYSTS } from "@/data/mockData";
import type { CaseNote } from "@/store/appStore";
import type { Customer, Investigation, Transaction } from "@/types";

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "#dc2626",
  HIGH: "#ea580c",
  MEDIUM: "#ca8a04",
  LOW: "#16a34a",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 14 }}>
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
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt
        style={{
          fontSize: 8.5,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#94a3b8",
        }}
      >
        {label}
      </dt>
      <dd style={{ fontSize: 11.5, fontWeight: 600, color: "#0f172a", marginTop: 2 }}>{value}</dd>
    </div>
  );
}

export function PrintCaseFile({
  txn,
  customer,
  investigation,
  assignedTo,
  notes,
  resolvedBy,
}: {
  txn: Transaction;
  customer: Customer;
  investigation: Investigation | null;
  assignedTo?: string;
  notes?: CaseNote[];
  resolvedBy?: string;
}) {
  /** hydration-safe mount flag (no setState-in-effect) */
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  if (!mounted) return null;

  const generated = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const evidence = investigation?.evidenceUsed ?? [];

  return createPortal(
    <div
      id="print-case-file"
      className="hidden print:block"
      style={{ background: "#ffffff", color: "#0f172a", fontFamily: "ui-sans-serif, system-ui", padding: "4px 2px" }}
      aria-hidden
    >
      {/* Report header */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "2px solid #0f172a", paddingBottom: 8 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.08em" }}>RAZORSHIELD AI</p>
          <p style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "#64748b", marginTop: 2 }}>
            Payment risk case file
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ fontSize: 12, fontWeight: 700 }}>{txn.id}</p>
          <p style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>Generated {generated}</p>
        </div>
      </header>

      {/* Meta */}
      <Section title="Transaction">
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px 16px" }}>
          <Meta label="Amount" value={formatINR(txn.amount)} />
          <Meta label="Customer" value={`${txn.customerId}${customer?.name ? ` · ${customer.name}` : ""}`} />
          <Meta label="Merchant" value={txn.merchant} />
          <Meta label="Method" value={txn.paymentMethod} />
          <Meta label="Origin" value={txn.location} />
          <Meta label="Device" value={txn.device} />
          <Meta label="Received" value={new Date(txn.timestamp).toLocaleString("en-IN", { timeStyle: "short", dateStyle: "short" })} />
          <Meta label="Status" value={txn.status.replace("_", " ")} />
        </dl>
      </Section>

      {/* Risk */}
      <Section title="Risk assessment">
        <div style={{ display: "flex", gap: 24, alignItems: "baseline" }}>
          <p style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>
            {txn.riskScore}
            <span style={{ fontSize: 12, fontWeight: 500, color: "#64748b" }}> / 100</span>
          </p>
          <p style={{ fontSize: 11, fontWeight: 700, color: SEV_COLOR[txn.riskLevel] ?? "#0f172a" }}>{txn.riskLevel} RISK</p>
          {txn.recommendation && (
            <p style={{ fontSize: 11 }}>
              Recommended action: <strong>{txn.recommendation}</strong>
              {txn.confidence != null && <span style={{ color: "#64748b" }}> · model confidence {txn.confidence}%</span>}
            </p>
          )}
        </div>
        {txn.aiSummary && (
          <p style={{ fontSize: 10.5, lineHeight: 1.55, color: "#334155", marginTop: 8 }}>{txn.aiSummary}</p>
        )}
      </Section>

      {/* Signals */}
      {txn.signals.length > 0 && (
        <Section title={`Risk signals (${txn.signals.length})`}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#94a3b8", fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                <th style={{ padding: "3px 6px 3px 0" }}>Signal</th>
                <th style={{ padding: "3px 6px" }}>Severity</th>
                <th style={{ padding: "3px 6px" }}>Evidence</th>
                <th style={{ padding: "3px 0 3px 6px", textAlign: "right" }}>Impact</th>
              </tr>
            </thead>
            <tbody>
              {txn.signals.map((s) => (
                <tr key={s.type} style={{ borderTop: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "4px 6px 4px 0", fontWeight: 600, whiteSpace: "nowrap" }}>{s.title}</td>
                  <td style={{ padding: "4px 6px", color: SEV_COLOR[s.severity] ?? "#0f172a", fontWeight: 700, whiteSpace: "nowrap" }}>{s.severity}</td>
                  <td style={{ padding: "4px 6px", color: "#475569" }}>{s.evidence}</td>
                  <td style={{ padding: "4px 0 4px 6px", textAlign: "right", fontWeight: 700 }}>+{s.impact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Customer intel */}
      {customer && (
        <Section title="Customer intelligence">
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px 16px" }}>
            <Meta label="Account age" value={customer.accountAge} />
            <Meta label="Avg transaction" value={formatINR(customer.avgTransaction)} />
            <Meta label="Transactions (90d)" value={String(customer.transactionCount)} />
            <Meta label="Prior incidents" value={String(customer.previousIncidents)} />
            <Meta label="Usual location" value={customer.usualLocation} />
            <Meta label="Usual device" value={customer.usualDevice} />
          </dl>
        </Section>
      )}

      {/* Evidence used */}
      {evidence.length > 0 && (
        <Section title="Evidence examined by the AI investigator">
          <ul style={{ columns: 2, fontSize: 10.5, color: "#334155", paddingLeft: 16 }}>
            {evidence.map((e) => (
              <li key={e} style={{ marginBottom: 3 }}>
                ✓ {e}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Timeline */}
      {investigation?.timeline && investigation.timeline.length > 0 && (
        <Section title="Investigation timeline">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
            <tbody>
              {investigation.timeline.map((t) => (
                <tr key={`${t.time}-${t.label}`}>
                  <td style={{ padding: "2.5px 10px 2.5px 0", color: "#64748b", whiteSpace: "nowrap", width: 64 }}>{t.time}</td>
                  <td style={{ padding: "2.5px 6px 2.5px 0", fontWeight: 600, whiteSpace: "nowrap" }}>{t.label}</td>
                  <td style={{ padding: "2.5px 0", color: "#64748b" }}>{t.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Analyst notebook */}
      {notes && notes.length > 0 && (
        <Section title={`Analyst notebook (${notes.length})`}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
            <tbody>
              {notes.map((n) => {
                const who = ANALYSTS.find((a) => a.id === n.analystId);
                return (
                  <tr key={n.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td style={{ padding: "3px 10px 3px 0", color: "#64748b", whiteSpace: "nowrap", width: 64 }}>
                      {new Date(n.at).toLocaleTimeString("en-GB", { hour12: false })}
                    </td>
                    <td style={{ padding: "3px 6px 3px 0", fontWeight: 600, whiteSpace: "nowrap", width: 90 }}>
                      {who?.name ?? n.analystId}
                    </td>
                    <td style={{ padding: "3px 0", color: "#334155" }}>{n.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      )}

      {/* Decision */}
      <Section title="Analyst decision">
        {investigation?.analystAction ? (
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px 16px" }}>
            <Meta label="Action" value={investigation.analystAction} />
            <Meta label="Resolved at" value={new Date(investigation.resolvedAt ?? "").toLocaleTimeString("en-GB") || "—"} />
            <Meta label="Recorded by" value={resolvedBy ?? "—"} />
            <Meta label="Assigned to" value={assignedTo ?? "—"} />
            {investigation.analystNote && (
              <div style={{ gridColumn: "1 / -1" }}>
                <dt style={{ fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "#94a3b8" }}>Analyst note</dt>
                <dd style={{ fontSize: 10.5, marginTop: 2, color: "#334155" }}>“{investigation.analystNote}”</dd>
              </div>
            )}
          </dl>
        ) : (
          <p style={{ fontSize: 10.5, color: "#64748b" }}>
            No bounded action recorded yet{assignedTo ? ` — case assigned to ${assignedTo}` : ""}. This report reflects the open case at print time.
          </p>
        )}
      </Section>

      <footer style={{ marginTop: 16, borderTop: "1px solid #e2e8f0", paddingTop: 6, fontSize: 8.5, color: "#94a3b8", lineHeight: 1.5 }}>
        RazorShield AI · Razorpay AI Buildathon 2026 demo environment. Data shown is synthetic and generated by the
        deterministic demo engine — it contains no real customer information. Actions remain bounded: the final decision
        always belongs to the analyst and is recorded in the audit trail.
      </footer>
    </div>,
    document.body
  );
}
