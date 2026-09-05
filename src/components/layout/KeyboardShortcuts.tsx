"use client";

/**
 * KEYBOARD LAYER — analyst-grade keyboard control.
 *
 *   ⌘K /  command palette        ?   shortcut cheat-sheet
 *   1–7    switch sections        n   open newest high-risk case
 *   p      pause / resume stream  Esc close overlays (Radix)
 *   j / k  feed cursor (LiveFeed) Enter open highlighted row
 *
 * All shortcuts are suppressed while typing in inputs or when any dialog
 * is open, so they never fight the command palette or confirm modals.
 */

import { useEffect, useState } from "react";
import { Command, CornerDownLeft, Gauge, Hash, Keyboard, Newspaper, Pause, Search, ShieldAlert, Volume2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppStore } from "@/store/appStore";
import type { ViewKey } from "@/types";

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

export function isDialogOpen(): boolean {
  return typeof document !== "undefined" && Boolean(document.querySelector('[role="dialog"]'));
}

const SECTION_KEYS: Record<string, ViewKey> = {
  "1": "overview",
  "2": "investigations",
  "3": "transactions",
  "4": "datastudio",
  "5": "intelligence",
  "6": "model",
  "7": "system",
};

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || isDialogOpen()) return;

      // "?" — shortcut cheat-sheet
      if (e.key === "?") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }

      const s = useAppStore.getState();

      // 1–7 — switch sections
      const section = SECTION_KEYS[e.key];
      if (section) {
        e.preventDefault();
        s.navigate(section);
        return;
      }

      // n — newest high-risk case
      if (e.key === "n") {
        e.preventDefault();
        const hottest = [...s.transactions]
          .filter(
            (t) =>
              t.status === "INVESTIGATING" &&
              (t.riskLevel === "CRITICAL" || t.riskLevel === "HIGH"),
          )
          .sort(
            (a, b) =>
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
          )[0];
        if (hottest) s.openInvestigation(hottest.id);
        return;
      }

      // p — pause / resume the demo stream
      if (e.key === "p") {
        e.preventDefault();
        s.setStreamPaused(!s.streamPaused);
        return;
      }

      // d — pattern digest brief
      if (e.key === "d") {
        e.preventDefault();
        s.setDigestOpen(!s.digestOpen);
        return;
      }

      // m — mute / unmute the critical-arrival chime
      if (e.key === "m") {
        e.preventDefault();
        s.setSoundEnabled(!s.soundEnabled);
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return <ShortcutsDialog open={open} onOpenChange={setOpen} />;
}

/* ------------------------------------------------------------------ */
/* Cheat-sheet dialog                                                  */
/* ------------------------------------------------------------------ */

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface-2 px-1.5 num text-[10px] font-medium text-slate-300 shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)]">
      {children}
    </kbd>
  );
}

const SHORTCUT_GROUPS: {
  label: string;
  items: { keys: string[]; label: string; icon: typeof Command }[];
}[] = [
  {
    label: "Global",
    items: [
      { keys: ["⌘", "K"], label: "Open command palette / search", icon: Search },
      { keys: ["/"], label: "Quick search", icon: Search },
      { keys: ["?"], label: "This cheat-sheet", icon: Keyboard },
      { keys: ["N"], label: "Open newest high-risk case", icon: ShieldAlert },
      { keys: ["P"], label: "Pause / resume live stream", icon: Pause },
      { keys: ["D"], label: "Open pattern digest", icon: Newspaper },
      { keys: ["M"], label: "Toggle critical-alert chime", icon: Volume2 },
    ],
  },
  {
    label: "Navigation",
    items: [
      { keys: ["1"], label: "Command center", icon: Hash },
      { keys: ["2"], label: "Investigations queue", icon: Hash },
      { keys: ["3"], label: "Transaction ledger", icon: Hash },
      { keys: ["4"], label: "Dataset Studio", icon: Hash },
      { keys: ["5"], label: "Risk intelligence", icon: Hash },
      { keys: ["6"], label: "Model performance", icon: Hash },
      { keys: ["7"], label: "System health", icon: Hash },
    ],
  },
  {
    label: "Live feed",
    items: [
      { keys: ["J"], label: "Cursor down", icon: Gauge },
      { keys: ["K"], label: "Cursor up", icon: Gauge },
      { keys: ["↵"], label: "Open highlighted transaction", icon: CornerDownLeft },
      { keys: ["Esc"], label: "Clear cursor / close overlay", icon: CornerDownLeft },
    ],
  },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-line bg-surface-1 p-0 sm:rounded-md">
        <DialogHeader className="border-b border-line px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-[14px] font-semibold text-slate-100">
            <Keyboard className="h-4 w-4 text-intel" aria-hidden />
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription className="text-[12px] text-slate-500">
            Analyst-grade control — every action stays one keystroke away.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-5 overflow-y-auto px-5 py-4 scroll-thin">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <p className="micro mb-2.5 text-slate-500">{group.label}</p>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li
                    key={item.label}
                    className="flex items-center justify-between gap-4 rounded-sm px-2 py-1.5 transition-colors hover:bg-surface-2"
                  >
                    <span className="flex items-center gap-2.5 text-[12.5px] text-slate-300">
                      <item.icon className="h-3.5 w-3.5 text-slate-600" aria-hidden />
                      {item.label}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {item.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="border-t border-line px-5 py-3">
          <p className="text-[11px] text-slate-600">
            Shortcuts are ignored while typing or when a dialog is open.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
