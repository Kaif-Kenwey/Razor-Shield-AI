"use client";

/**
 * TRANSACTION DETAIL — the full case file with expandable sections:
 * overview, customer, payment, device, location, signals, model decision,
 * AI investigation, audit trail.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Sparkles } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { RiskLevelBadge, StatusBadge } from "@/components/risk/RiskBadge";
import { InlineScore } from "@/components/risk/RiskScoreDial";
import { AuditTrail } from "@/components/investigation/AuditTrail";
import { SignalCard } from "@/components/investigation/RiskSignals";
import { EmptyState } from "@/components/shared/States";
import { useAppStore } from "@/store/appStore";
import { customerFor } from "@/data/mockData";
import { dateTimeShort, formatINR } from "@/lib/format";
import type { Transaction } from "@/types";

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/50 py-2 last:border-0">
      <dt className="text-[11.5px] text-slate-500">{label}</dt>
      <dd className={`num text-[12.5px] font-medium ${tone ?? "text-slate-200"}`}>{value}</dd>
    </div>
  );
}

function DetailSections({ txn }: { txn: Transaction }) {
  const customer = useMemo(() => customerFor(txn), [txn]);
  const investigating = txn.riskLevel === "HIGH" || txn.riskLevel === "CRITICAL";

  return (
    <Accordion type="multiple" defaultValue={["overview", "signals"]} className="space-y-3">
      <AccordionItem value="overview" className="panel border-line px-4 data-[state=open]:border-line-strong">
        <AccordionTrigger className="micro-11 py-3.5 text-slate-300 hover:no-underline">Transaction overview</AccordionTrigger>
        <AccordionContent className="pb-4">
          <dl>
            <Row label="Transaction ID" value={txn.id} />
            <Row label="Amount" value={formatINR(txn.amount)} />
            <Row label="Timestamp" value={dateTimeShort(txn.timestamp)} />
            <Row label="Status" value={txn.status.replace("_", " ")} />
            <Row label="Risk score" value={`${txn.riskScore}/100 · ${txn.riskLevel}`} />
          </dl>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="customer" className="panel border-line px-4">
        <AccordionTrigger className="micro-11 py-3.5 text-slate-300 hover:no-underline">Customer</AccordionTrigger>
        <AccordionContent className="pb-4">
          <dl>
            <Row label="Customer" value={`${customer.id} · ${customer.name}`} />
            <Row label="KYC tier" value={customer.kycTier} />
            <Row label="Account age" value={customer.accountAge} />
            <Row label="Lifetime transactions" value={String(customer.transactionCount)} />
            <Row label="Average transaction" value={formatINR(customer.avgTransaction)} />
            <Row label="Previous incidents" value={String(customer.previousIncidents)} tone={customer.previousIncidents > 0 ? "text-risk-medium" : undefined} />
            <Row label="Usual location" value={customer.usualLocation} />
          </dl>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="payment" className="panel border-line px-4">
        <AccordionTrigger className="micro-11 py-3.5 text-slate-300 hover:no-underline">Payment</AccordionTrigger>
        <AccordionContent className="pb-4">
          <dl>
            <Row label="Method" value={txn.paymentMethod} />
            <Row label="Merchant" value={txn.merchant} />
            <Row label="Currency" value="INR" />
            <Row label="Capture" value="Electronic · card-not-present" />
          </dl>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="device" className="panel border-line px-4">
        <AccordionTrigger className="micro-11 py-3.5 text-slate-300 hover:no-underline">Device</AccordionTrigger>
        <AccordionContent className="pb-4">
          <dl>
            <Row label="Device" value={txn.device} />
            <Row label="Recognition" value={txn.isNewDevice ? "Never seen for this customer" : "Known device"} tone={txn.isNewDevice ? "text-risk-medium" : "text-risk-low"} />
            <Row label="Fingerprint" value={`fp_${txn.id.slice(4, 10).toLowerCase()}92`} />
            <Row label="Customer's usual device" value={customer.usualDevice} />
          </dl>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="location" className="panel border-line px-4">
        <AccordionTrigger className="micro-11 py-3.5 text-slate-300 hover:no-underline">Location</AccordionTrigger>
        <AccordionContent className="pb-4">
          <dl>
            <Row label="Transaction origin" value={`${txn.location}, IN`} />
            <Row label="Usual location" value={`${customer.usualLocation}, IN`} tone={txn.location !== customer.usualLocation ? "text-risk-medium" : undefined} />
            <Row label="Last confirmed activity" value={customer.lastSeen} />
            <Row label="IP geolocation match" value={txn.location !== customer.usualLocation ? "Consistent with origin" : "Consistent"} />
          </dl>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="signals" className="panel border-line px-4">
        <AccordionTrigger className="micro-11 py-3.5 text-slate-300 hover:no-underline">
          Risk signals <span className="num ml-2 text-slate-500">({txn.signals.length})</span>
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          {txn.signals.length === 0 ? (
            <p className="text-[12.5px] text-slate-500">No independent risk signals fired for this transaction.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {txn.signals.map((s, i) => (
                <SignalCard key={s.id} signal={s} index={i} maxImpact={Math.max(...txn.signals.map((x) => x.impact), 1)} />
              ))}
            </div>
          )}
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="model" className="panel border-line px-4">
        <AccordionTrigger className="micro-11 py-3.5 text-slate-300 hover:no-underline">Model decision</AccordionTrigger>
        <AccordionContent className="pb-4">
          <dl>
            <Row label="Model" value="RazorShield Risk Model v1.0" />
            <Row label="Composite score" value={`${txn.riskScore}/100`} />
            <Row label="Risk level" value={txn.riskLevel} />
            <Row label="Action threshold" value="≥ 85 → investigation" />
            <Row
              label="Recommendation"
              value={txn.recommendation ?? "—"}
              tone={txn.recommendation === "BLOCK" ? "text-risk-critical" : txn.recommendation === "ALLOW" ? "text-risk-low" : "text-risk-medium"}
            />
            <Row label="Confidence" value={txn.confidence ? `${txn.confidence}%` : "—"} />
          </dl>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="ai" className="panel border-line px-4">
        <AccordionTrigger className="micro-11 py-3.5 text-slate-300 hover:no-underline">
          <span className="flex items-center gap-2">
            <Sparkles className="h-3 w-3 text-intel" aria-hidden />
            AI investigation
          </span>
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          {txn.aiSummary ? (
            <div className="space-y-3">
              <p className="border-l-2 border-intel/40 pl-3 text-[12.5px] leading-relaxed text-slate-300">{txn.aiSummary}</p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {(txn.investigation?.evidenceUsed ?? ["Customer transaction history", "Device history", "Location history", "Transaction velocity", "ML risk score"]).map((e) => (
                  <li key={e} className="text-[11px] text-slate-500">✓ {e}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[12.5px] text-slate-500">
              {investigating
                ? "The AI investigation has not been opened for this transaction yet."
                : "Below the investigation threshold — the engine requires no AI correlation for this payment."}
            </p>
          )}
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="audit" className="panel border-line px-4">
        <AccordionTrigger className="micro-11 py-3.5 text-slate-300 hover:no-underline">Audit trail</AccordionTrigger>
        <AccordionContent className="pb-4">
          <AuditTrail
            entries={txn.investigation?.auditTrail ?? [
              { time: dateTimeShort(txn.timestamp).split(", ")[1] ?? "00:00:00", actor: "SYSTEM", action: "Transaction received", detail: `${txn.paymentMethod} · ${txn.merchant}` },
              { time: "—", actor: "RISK MODEL", action: `Risk score generated (${txn.riskScore}/100)`, detail: `Level: ${txn.riskLevel}` },
            ]}
            analystAction={txn.investigation?.analystAction}
            analystNote={txn.investigation?.analystNote}
            resolvedAt={txn.investigation?.resolvedAt}
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export function TransactionDetailView() {
  const detailTxnId = useAppStore((s) => s.detailTxnId);
  const transactions = useAppStore((s) => s.transactions);
  const navigate = useAppStore((s) => s.navigate);
  const openInvestigation = useAppStore((s) => s.openInvestigation);

  const txn = transactions.find((t) => t.id === detailTxnId) ?? null;

  if (!txn) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <EmptyState title="Transaction not found" body="This transaction is no longer in the live window." />
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => navigate("transactions")} className="border-line bg-surface-1">
            Open ledger
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 lg:px-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("transactions")}
              className="h-7 w-7 text-slate-500 hover:bg-surface-3 hover:text-slate-200"
              aria-label="Back to ledger"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <div>
              <p className="micro text-slate-500">Transaction detail</p>
              <h1 className="num text-lg font-semibold tracking-tight text-slate-50">{txn.id}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <RiskLevelBadge level={txn.riskLevel} />
              <StatusBadge status={txn.status} />
              <div className="w-24">
                <InlineScore score={txn.riskScore} level={txn.riskLevel} />
              </div>
            </div>
            {(txn.riskLevel === "HIGH" || txn.riskLevel === "CRITICAL") && (
              <Button
                size="sm"
                onClick={() => openInvestigation(txn.id)}
                className="gap-1.5 border border-risk-critical/40 bg-risk-critical/12 text-[12px] font-semibold text-risk-critical hover:bg-risk-critical/20"
              >
                <Sparkles className="h-3 w-3" aria-hidden />
                Open investigation
              </Button>
            )}
          </div>
        </div>

        <DetailSections txn={txn} />
      </motion.div>
    </div>
  );
}
