"use client";

import { useMemo, useState } from "react";
import { Bell, Check, Menu, Radio, Search, ShieldCheck, UserCog, Volume2, VolumeX } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusDot } from "@/components/shared/StatusDot";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { useAppStore } from "@/store/appStore";
import { useToast } from "@/hooks/use-toast";
import { primeAlertSound } from "@/lib/alertSound";
import { ANALYSTS, NOTIFICATIONS } from "@/data/mockData";
import { relativeTime } from "@/lib/format";
import type { ViewKey } from "@/types";
import { cn } from "@/lib/utils";

const SECTION_LABEL: Record<ViewKey, string> = {
  landing: "Command Center",
  overview: "Risk Command Center",
  investigations: "Investigation Queue",
  transactions: "Transaction Ledger",
  intelligence: "Risk Intelligence",
  model: "Model Performance",
  system: "System Health",
  investigation: "Investigation Workspace",
  "transaction-detail": "Transaction Detail",
};

const TONE_DOT = {
  critical: "red",
  high: "red",
  medium: "amber",
  intel: "violet",
} as const;

export function TopCommandBar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const view = useAppStore((s) => s.view);
  const demoMode = useAppStore((s) => s.demoMode);
  const setDemoMode = useAppStore((s) => s.setDemoMode);
  const streamPaused = useAppStore((s) => s.streamPaused);
  const soundEnabled = useAppStore((s) => s.soundEnabled);
  const setSoundEnabled = useAppStore((s) => s.setSoundEnabled);
  const connection = useAppStore((s) => s.connection);
  const unread = useAppStore((s) => s.unreadNotifications);
  const markRead = useAppStore((s) => s.markNotificationsRead);
  const openInvestigation = useAppStore((s) => s.openInvestigation);
  const signedInId = useAppStore((s) => s.signedInAnalystId);
  const setSignedInAnalyst = useAppStore((s) => s.setSignedInAnalyst);
  const signedIn = ANALYSTS.find((a) => a.id === signedInId) ?? ANALYSTS[0];
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { toast } = useToast();

  const dimmed = view === "investigation" || view === "transaction-detail";
  const notifications = useMemo(() => NOTIFICATIONS, []);

  return (
    <TooltipProvider delayDuration={200}>
      <header
        className={cn(
          "sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface-0/85 px-4 backdrop-blur-md transition-opacity duration-500 lg:px-6",
          dimmed && "opacity-60 hover:opacity-100 focus-within:opacity-100"
        )}
      >
        {/* Mobile nav */}
        <button
          onClick={onOpenMobileNav}
          className="rounded-sm p-2 text-slate-400 hover:bg-surface-2 hover:text-slate-200 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-4.5 w-4.5" />
        </button>

        <p className="micro hidden min-w-0 truncate text-slate-500 md:block lg:max-w-[180px] xl:max-w-none" aria-hidden>
          {SECTION_LABEL[view]}
        </p>

        {/* Search / command palette trigger */}
        <button
          onClick={() => setPaletteOpen(true)}
          className="group ml-auto flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-sm border border-line bg-surface-1 text-slate-500 transition-colors hover:border-line-strong hover:text-slate-300 sm:ml-6 sm:h-8 sm:w-52 sm:shrink sm:justify-start sm:gap-2 sm:px-2.5 lg:w-60"
          aria-label="Search transactions (Command K)"
        >
          <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="hidden truncate text-[12.5px] sm:inline">Search transactions…</span>
          <kbd className="ml-auto hidden shrink-0 rounded border border-line bg-surface-2 px-1.5 py-px font-mono text-[10px] text-slate-500 sm:inline">
            ⌘K
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {/* Live monitoring */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="hidden h-8 shrink-0 items-center gap-2 rounded-sm border border-line bg-surface-1 px-2.5 md:flex">
                <span className="relative flex h-1.5 w-1.5">
                  {connection === "online" && !streamPaused && (
                    <span className="absolute inline-flex h-full w-full rounded-full bg-risk-low opacity-60 live-ping" />
                  )}
                  <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", connection === "online" && !streamPaused ? "bg-risk-low" : "bg-risk-medium")} />
                </span>
                <span className="micro whitespace-nowrap text-slate-400">
                  {connection === "offline" ? "Offline" : streamPaused ? "Stream paused" : "Live monitoring"}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">Streaming payments are scored in real time</TooltipContent>
          </Tooltip>

          {/* Engine status */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="hidden h-8 shrink-0 items-center gap-2 rounded-sm border border-line bg-surface-1 px-2.5 xl:flex">
                <ShieldCheck className={cn("h-3.5 w-3.5", connection === "online" ? "text-risk-low" : "text-risk-medium")} aria-hidden />
                <span className="micro whitespace-nowrap text-slate-400">
                  {connection === "online" ? "Risk Engine Operational" : "Engine Reconnecting"}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">Risk engine v1.0 · p99 latency 18ms</TooltipContent>
          </Tooltip>

          {/* Demo mode */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex h-8 shrink-0 items-center gap-2.5 rounded-sm border border-line bg-surface-1 px-2.5">
                <Radio className={cn("h-3.5 w-3.5", demoMode ? "text-intel" : "text-slate-500")} aria-hidden />
                <span className="micro hidden whitespace-nowrap text-slate-400 sm:inline">Demo</span>
                <Switch
                  checked={demoMode}
                  onCheckedChange={setDemoMode}
                  aria-label="Toggle demo mode"
                  className="scale-75 data-[state=checked]:bg-intel"
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Demo mode streams scripted transactions so the risk engine can be shown live
            </TooltipContent>
          </Tooltip>

          {/* Critical-alert chime toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  primeAlertSound();
                  setSoundEnabled(!soundEnabled);
                }}
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border transition-colors",
                  soundEnabled
                    ? "border-risk-medium/40 bg-risk-medium/10 text-risk-medium"
                    : "border-line bg-surface-1 text-slate-500 hover:text-slate-300"
                )}
                aria-label={soundEnabled ? "Mute critical alerts" : "Play a chime on critical alerts"}
                aria-pressed={soundEnabled}
              >
                {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {soundEnabled
                ? "Critical chime on — a two-tone alert plays when a CRITICAL transaction lands (M to mute)"
                : "Muted — enable a chime for critical arrivals (M)"}
            </TooltipContent>
          </Tooltip>

          {/* Notifications */}
          <Popover open={notifOpen} onOpenChange={(o) => { setNotifOpen(o); if (o) markRead(); }}>
            <PopoverTrigger asChild>
              <button
                className="relative flex h-8 w-8 items-center justify-center rounded-sm border border-line bg-surface-1 text-slate-400 transition-colors hover:text-slate-200"
                aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
              >
                <Bell className="h-3.5 w-3.5" />
                {unread > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-risk-critical num text-[8.5px] font-bold text-white shadow-[0_0_8px_rgba(248,113,113,0.6)]">
                    {unread}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={10} className="w-84 max-w-[92vw] border-line bg-popover p-0">
              <div className="border-b border-line px-4 py-3">
                <p className="micro text-slate-400">Notifications</p>
              </div>
              <div className="max-h-80 overflow-y-auto scroll-thin">
                {notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      if (n.transactionId) openInvestigation(n.transactionId);
                      setNotifOpen(false);
                    }}
                    className="flex w-full gap-3 border-b border-line/60 px-4 py-3 text-left transition-colors last:border-0 hover:bg-surface-2"
                  >
                    <span className="mt-1.5">
                      <StatusDot tone={TONE_DOT[n.tone]} pulse={n.tone === "critical"} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12px] font-medium text-slate-200">{n.title}</span>
                      <span className="mt-0.5 block text-[11.5px] leading-snug text-slate-500">{n.body}</span>
                      <span className="mt-1 block text-[10.5px] text-slate-600">{relativeTime(n.time)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Analyst profile — persona switcher */}
          <Popover open={profileOpen} onOpenChange={setProfileOpen}>
            <PopoverTrigger asChild>
              <button
                className="flex h-8 shrink-0 items-center gap-2.5 rounded-sm border border-line bg-surface-1 pl-1.5 pr-2.5 transition-colors hover:border-line-strong"
                aria-label={`Signed in as ${signedIn.name} — switch analyst`}
                aria-expanded={profileOpen}
              >
                <span className="flex h-5.5 w-5.5 items-center justify-center rounded-full bg-gradient-to-br from-intel/70 to-intel-soft/60 num text-[10px] font-bold text-white">
                  {signedIn.initials}
                </span>
                <span className="hidden text-[12px] font-medium text-slate-300 md:inline">{signedIn.name}</span>
                <span className="hidden text-[10px] uppercase tracking-wider text-slate-600 md:inline">{signedIn.level}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={10} className="w-72 border-line bg-popover p-0">
              <div className="border-b border-line px-3.5 py-3">
                <p className="micro text-slate-400">Signed-in analyst</p>
                <p className="mt-1 text-[11px] leading-snug text-slate-600">
                  Every decision, note and handoff is recorded against this identity.
                </p>
              </div>
              <ul className="py-1" role="listbox" aria-label="Analyst personas">
                {ANALYSTS.map((a) => {
                  const active = a.id === signedInId;
                  return (
                    <li key={a.id}>
                      <button
                        role="option"
                        aria-selected={active}
                        disabled={active}
                        onClick={() => {
                          setSignedInAnalyst(a.id);
                          setProfileOpen(false);
                          toast({
                            title: `Now acting as ${a.name} (${a.level})`,
                            description: "Decisions and notebook entries will carry this identity — switching is itself audit-logged.",
                          });
                        }}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors",
                          active ? "bg-intel/8" : "hover:bg-surface-2"
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border num text-[9.5px] font-semibold",
                            active ? "border-intel/45 bg-intel/12 text-intel" : "border-line-strong bg-surface-2 text-slate-400"
                          )}
                          aria-hidden
                        >
                          {a.initials}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="text-[12.5px] font-medium text-slate-200">{a.name}</span>
                            <span className="num rounded-sm border border-line bg-surface-2 px-1 text-[9px] uppercase tracking-wider text-slate-500">
                              {a.level}
                            </span>
                            {active && <span className="text-[10px] font-medium text-intel">· signed in</span>}
                          </span>
                          <span className="mt-0.5 block truncate text-[10.5px] text-slate-600">
                            {active ? a.role.replace(" · you", "") : `Switch to act as ${a.name.split(" ")[0]}`}
                          </span>
                        </span>
                        {active ? (
                          <Check className="h-3.5 w-3.5 shrink-0 text-intel" aria-hidden />
                        ) : (
                          <UserCog className="h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-line px-3.5 py-2">
                <p className="text-[10px] leading-relaxed text-slate-600">
                  Persona switch is presentation-only — bounded actions always stay attributable and audited.
                </p>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </header>
      <CommandPalette />
    </TooltipProvider>
  );
}
