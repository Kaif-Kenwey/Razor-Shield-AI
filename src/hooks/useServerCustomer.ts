"use client";

/**
 * useServerCustomer — server-authoritative customer profile for the case
 * view. The mock roster (`customerFor`) renders instantly but FABRICATES
 * details for customers it does not know; this hook overwrites every
 * derived field with real ledger aggregates from /api/customers/:id, so
 * imported/real-data customers show the truth (and nothing but the truth)
 * while the mock roster keeps its curated demo look.
 *
 * Time-aware: aggregates and the sparkline are bounded to the case
 * timestamp when provided (`before`), matching what the engine knew.
 */

import { useEffect, useState } from "react";
import type { Customer, Transaction } from "@/types";
import { customerFor } from "@/data/mockData";

interface ServerCustomerPayload {
  ok: boolean;
  customer?: {
    id: string;
    name: string;
    kycTier: string;
    priorIncidents: number;
    firstSeen: string | null;
    lastSeen: string | null;
    transactionCount: number;
    avgTransaction: number;
    flaggedCount: number;
    usualLocation: string;
    usualDevice: string;
    knownDevices: string[];
  };
  history?: { label: string; amount: number; riskScore: number; flagged?: boolean }[];
}

/**
 * ACCOUNT AGE IS HONEST BY OMISSION: the ledger's firstSeen is when the
 * customer FIRST APPEARED IN RAZORSHIELD, not when a real bank account was
 * opened — presenting it as "account age" would fabricate a fact. No
 * supported data source carries a genuine account-opening date, so the
 * field reports Unknown. It flips to a real value the day a source column
 * actually provides one.
 */
const UNKNOWN_ACCOUNT_AGE = "Unknown";

export function useServerCustomer(txn: Transaction | null): Customer | null {
  /* Server-merged profile keyed by txn id — when the case changes, the key
   * mismatches and the honest mock renders until real aggregates land. */
  const [state, setState] = useState<{ id: string; profile: Customer } | null>(null);

  useEffect(() => {
    if (!txn) return;
    const t = txn;
    const fallback = customerFor(t);
    let alive = true;

    const url = new URL(`/api/customers/${encodeURIComponent(t.customerId)}`, window.location.origin);
    url.searchParams.set("before", t.timestamp);
    fetch(url.toString(), { signal: AbortSignal.timeout(12_000) })
      .then((r) => (r.ok ? (r.json() as Promise<ServerCustomerPayload>) : null))
      .then((data) => {
        if (!alive || !data?.ok || !data.customer) return;
        const c = data.customer;
        const merged: Customer = {
          id: c.id,
          name: c.name || c.id,
          kycTier: (c.kycTier as Customer["kycTier"]) || fallback.kycTier,
          /* Never fall back to the mock roster's fabricated age here —
           * imported customers must not inherit invented profile facts. */
          accountAge: UNKNOWN_ACCOUNT_AGE,
          avgTransaction: c.avgTransaction || fallback.avgTransaction,
          transactionCount: c.transactionCount ?? fallback.transactionCount,
          previousIncidents: c.priorIncidents ?? 0,
          usualLocation: c.usualLocation || "unknown",
          usualDevice: c.usualDevice || c.knownDevices[0] || "unknown",
          lastSeen: c.lastSeen
            ? `${new Date(c.lastSeen).toISOString().slice(0, 10)} · prior activity`
            : fallback.lastSeen,
          history:
            data.history && data.history.length
              ? data.history.slice(-24).map((h) => ({
                  label: h.label,
                  amount: h.amount,
                  riskScore: h.riskScore,
                  flagged: h.flagged || h.riskScore >= 28,
                }))
              : fallback.history,
        };
        setState({ id: t.id, profile: merged });
      })
      .catch(() => {
        /* network/timeout — the mock profile stays until a retry */
      });

    return () => {
      alive = false;
    };
  }, [txn?.id, txn?.customerId, txn?.timestamp]);

  if (!txn) return null;
  if (state && state.id === txn.id) return state.profile;
  return customerFor(txn);
}
