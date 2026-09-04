"use client";

/**
 * RazorShield AI — single-route application shell.
 * All navigation is state-driven (the product is an investigation console,
 * not a set of marketing pages). Backend is untouched; the UI renders from
 * the mock-backed service layer in src/services/api.ts.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { AppShell } from "@/components/layout/AppShell";
import { HeroLanding } from "@/components/dashboard/HeroLanding";
import { OverviewView } from "@/components/dashboard/OverviewView";
import { InvestigationsView } from "@/components/investigation/InvestigationsView";
import { InvestigationView } from "@/components/investigation/InvestigationView";
import { TransactionsView } from "@/components/transactions/TransactionsView";
import { TransactionDetailView } from "@/components/transactions/TransactionDetailView";
import { RiskIntelligenceView } from "@/components/risk/RiskIntelligenceView";
import { ModelPerformanceView } from "@/components/model/ModelPerformanceView";
import { SystemView } from "@/components/system/SystemView";
import { ConnectionLostState } from "@/components/shared/States";
import { useAppStore } from "@/store/appStore";
import { useLiveTransactions } from "@/hooks/useLiveTransactions";

const DATA_VIEWS = new Set(["overview", "investigations", "transactions"]);

function ConnectionGuard({ children }: { children: React.ReactNode }) {
  const connection = useAppStore((s) => s.connection);
  const view = useAppStore((s) => s.view);
  const setConnection = useAppStore((s) => s.setConnection);
  const [retrying, setRetrying] = useState(false);

  if (connection === "offline" && DATA_VIEWS.has(view) && view !== "system") {
    return (
      <ConnectionLostState
        retrying={retrying}
        onRetry={() => {
          setRetrying(true);
          setTimeout(() => {
            setConnection("online");
            setRetrying(false);
          }, 1100);
        }}
      />
    );
  }
  return <>{children}</>;
}

function CurrentView() {
  const view = useAppStore((s) => s.view);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={view}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        <ConnectionGuard>
          {view === "landing" && <HeroLanding />}
          {view === "overview" && <OverviewView />}
          {view === "investigations" && <InvestigationsView />}
          {view === "investigation" && <InvestigationView />}
          {view === "transactions" && <TransactionsView />}
          {view === "transaction-detail" && <TransactionDetailView />}
          {view === "intelligence" && <RiskIntelligenceView />}
          {view === "model" && <ModelPerformanceView />}
          {view === "system" && <SystemView />}
        </ConnectionGuard>
      </motion.div>
    </AnimatePresence>
  );
}

export default function Home() {
  useLiveTransactions();

  return (
    <AppShell>
      <CurrentView />
    </AppShell>
  );
}
