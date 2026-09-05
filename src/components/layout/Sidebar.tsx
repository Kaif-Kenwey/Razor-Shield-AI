"use client";

import { motion } from "framer-motion";
import {
  ArrowLeftRight,
  BarChart3,
  Cpu,
  FileUp,
  FolderSearch,
  LayoutGrid,
  Server,
  Shield,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { StatusDot } from "@/components/shared/StatusDot";
import { useAppStore } from "@/store/appStore";
import type { ViewKey } from "@/types";
import { cn } from "@/lib/utils";

const NAV: { key: ViewKey; label: string; icon: LucideIcon; hint: string }[] = [
  { key: "overview", label: "Overview", icon: LayoutGrid, hint: "Live risk command center" },
  { key: "investigations", label: "Investigations", icon: FolderSearch, hint: "Active case queue" },
  { key: "transactions", label: "Transactions", icon: ArrowLeftRight, hint: "Full payment ledger" },
  { key: "datastudio", label: "Dataset Studio", icon: FileUp, hint: "Import & score real data" },
  { key: "intelligence", label: "Risk Intelligence", icon: BarChart3, hint: "Patterns & distributions" },
  { key: "model", label: "Detection Benchmark", icon: Cpu, hint: "Demo engine metrics" },
  { key: "system", label: "System", icon: Server, hint: "Engine & service health" },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const view = useAppStore((s) => s.view);
  const navigate = useAppStore((s) => s.navigate);
  const connection = useAppStore((s) => s.connection);
  const decisions = useAppStore((s) => s.decisions);
  const transactions = useAppStore((s) => s.transactions);

  const activeCases = transactions.filter(
    (t) => (t.status === "INVESTIGATING" || t.status === "UNDER_REVIEW") && !decisions[t.id]
  ).length;

  const isInvestigating = view === "investigation" || view === "transaction-detail";

  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 pt-6 pb-7">
        <div className="relative flex h-9 w-9 items-center justify-center rounded-md border border-intel/30 bg-intel/10">
          <Shield className="h-4.5 w-4.5 text-intel" aria-hidden />
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-intel shadow-[0_0_8px_rgba(167,139,250,0.9)]" />
        </div>
        <div>
          <p className="text-[13.5px] font-semibold tracking-[0.08em] text-slate-100">RAZORSHIELD</p>
          <p className="micro text-slate-500 mt-0.5">AI Risk Engine</p>
        </div>
      </div>

      {/* Primary navigation */}
      <nav className="flex-1 px-3 space-y-0.5" aria-label="Primary">
        {NAV.map((item) => {
          const active = view === item.key || (isInvestigating && item.key === "investigations");
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              onClick={() => {
                navigate(item.key);
                onNavigate?.();
              }}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left transition-colors",
                active ? "bg-surface-2 text-slate-100" : "text-slate-400 hover:bg-surface-1 hover:text-slate-200"
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-intel"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  active ? "text-intel" : "text-slate-500 group-hover:text-slate-400"
                )}
                aria-hidden
              />
              <span className="flex-1 text-[13px] font-medium tracking-tight">{item.label}</span>
              {item.key === "investigations" && activeCases > 0 && (
                <span className="num rounded-full border border-risk-critical/30 bg-risk-critical/10 px-1.5 py-px text-[10px] font-semibold text-risk-critical">
                  {activeCases}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Engine status */}
      <div className="border-t border-line px-5 py-4">
        <div className="space-y-2 text-[11px] tracking-tight">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Model</span>
            <span className="num text-slate-300">rse-1.2</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Engine</span>
            <span className="flex items-center gap-1.5 text-slate-300">
              <StatusDot tone="green" pulse label="engine online" />
              Online
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">API</span>
            <span className={cn("flex items-center gap-1.5", connection === "online" ? "text-slate-300" : "text-risk-medium")}>
              <StatusDot tone={connection === "online" ? "green" : "amber"} pulse={connection === "online"} label="api status" />
              {connection === "online" ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const view = useAppStore((s) => s.view);
  // Investigation spotlight: chrome recedes while the case file takes over.
  const dimmed = view === "investigation" || view === "transaction-detail";

  return (
    <aside
      className={cn(
        "hidden lg:flex lg:w-60 xl:w-64 shrink-0 flex-col border-r border-line bg-surface-0 transition-opacity duration-500",
        dimmed && "opacity-45 hover:opacity-100 focus-within:opacity-100"
      )}
      aria-label="Sidebar"
    >
      <SidebarContent />
    </aside>
  );
}

export { SidebarContent };
