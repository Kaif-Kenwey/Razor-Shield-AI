"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Sidebar, SidebarContent } from "@/components/layout/Sidebar";
import { TopCommandBar } from "@/components/layout/TopCommandBar";
import { KeyboardShortcuts } from "@/components/layout/KeyboardShortcuts";
import { DigestModal } from "@/components/investigation/DigestModal";
import { useDigestBriefing } from "@/hooks/useDigestBriefing";
import { StatusDot } from "@/components/shared/StatusDot";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

function Footer() {
  return (
    <footer className="mt-auto border-t border-line bg-surface-0">
      <div className="flex flex-col items-center justify-between gap-2 px-6 py-3.5 text-[11px] text-slate-600 sm:flex-row">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 tracking-tight">
          <span className="font-medium text-slate-500">RazorShield AI</span>
          <span className="text-slate-700">·</span>
          <span>Bounded risk actions — every analyst decision is logged &amp; auditable</span>
        </p>
        <p className="flex items-center gap-2 tracking-tight">
          <kbd className="inline-flex h-4.5 items-center rounded border border-line bg-surface-2 px-1.5 num text-[9.5px] text-slate-400" title="Press Command K to open the command palette">⌘K</kbd>
          <kbd className="inline-flex h-4.5 items-center rounded border border-line bg-surface-2 px-1.5 num text-[9.5px] text-slate-400" title="Press ? to view all keyboard shortcuts">?</kbd>
          <span className="text-slate-700">·</span>
          <StatusDot tone="violet" pulse />
          <span>Demo environment · synthetic data only · v1.4.1</span>
        </p>
      </div>
    </footer>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const view = useAppStore((s) => s.view);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const spotlight = view === "investigation" || view === "transaction-detail";
  useDigestBriefing();

  return (
    <div className="flex min-h-screen flex-col bg-surface-0">
      <KeyboardShortcuts />
      <DigestModal />
      <div className="flex flex-1">
        <Sidebar />

        {/* Mobile navigation drawer */}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger asChild>
            <span className="hidden" aria-hidden />
          </SheetTrigger>
          <SheetContent side="left" className="w-72 border-line bg-surface-0 p-0 [&>button]:text-slate-400">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Primary navigation for the RazorShield command center</SheetDescription>
            <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopCommandBarWrapper onOpenMobileNav={() => setMobileNavOpen(true)} />
          {/* Spotlight: during investigations the periphery recedes */}
          <motion.main
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className={cn("relative flex-1", spotlight && "spotlight-backdrop")}
          >
            {children}
          </motion.main>
          <Footer />
        </div>
      </div>
    </div>
  );
}

/**
 * TopCommandBar is rendered inside the main column; the mobile nav button
 * needs a trigger that opens the Sheet — pass through directly.
 */
function TopCommandBarWrapper({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  return <TopCommandBar onOpenMobileNav={onOpenMobileNav} />;
}
