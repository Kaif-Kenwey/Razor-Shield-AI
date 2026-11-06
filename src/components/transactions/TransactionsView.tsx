"use client";

/**
 * TRANSACTIONS — full payment ledger. Every row opens the detail view.
 * Rows come from the SQLite ledger via the live feed store; the header
 * carries the manual-entry dialog for live classroom demos.
 */

import { NewTransactionDialog } from "@/components/transactions/NewTransactionDialog";
import { LiveFeed } from "@/components/dashboard/LiveFeed";
import { useAppStore } from "@/store/appStore";

export function TransactionsView() {
  const navigate = useAppStore((s) => s.navigate);

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6 lg:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="micro mb-1.5 text-slate-500">Payment ledger</p>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">Transactions</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Every payment scored by the engine. Select a row to open the full detail file.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <NewTransactionDialog />
          <button
            onClick={() => navigate("overview")}
            className="text-[12px] font-medium text-intel hover:text-intel/80"
          >
            ← Back to command center
          </button>
        </div>
      </header>
      <LiveFeed clickMode="detail" />
    </div>
  );
}
