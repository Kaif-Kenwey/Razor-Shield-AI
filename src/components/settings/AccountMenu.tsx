"use client";

/**
 * RazorShield AI — signed-in account menu (real identity, no personas).
 * Security & devices (sessions + MFA) and organisation member admin.
 */

import { useState } from "react";
import { LogOut, ShieldCheck, Users, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SecurityDialog } from "@/components/settings/SecurityDialog";
import { MembersDialog } from "@/components/settings/MembersDialog";
import { useAuthStore, initialsOf } from "@/store/authStore";
import { ROLE_LABELS } from "@/lib/rbac";

export function AccountMenu() {
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);
  const organisation = useAuthStore((s) => s.organisation);
  const logout = useAuthStore((s) => s.logout);
  const can = useAuthStore((s) => s.can);
  const [busy, setBusy] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);

  if (!user) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex h-8 shrink-0 items-center gap-2.5 rounded-sm border border-line bg-surface-1 pl-1.5 pr-2.5 transition-colors hover:border-line-strong"
            aria-label={`Signed in as ${user.name} — account menu`}
          >
            <span className="flex h-5.5 w-5.5 items-center justify-center rounded-full bg-gradient-to-br from-intel/70 to-intel-soft/60 num text-[10px] font-bold text-white">
              {initialsOf(user.name)}
            </span>
            <span className="hidden max-w-[120px] truncate text-[12px] font-medium text-slate-300 md:inline">
              {user.name}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} className="w-64 border-line bg-popover">
          <DropdownMenuLabel className="px-2.5 py-2">
            <span className="block truncate text-[12.5px] font-medium text-slate-200">{user.name}</span>
            <span className="block truncate text-[10.5px] text-slate-500">{user.email}</span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              {role && (
                <span className="num rounded-sm border border-line bg-surface-2 px-1 py-px text-[9px] uppercase tracking-wider text-slate-400">
                  {ROLE_LABELS[role]}
                </span>
              )}
              {user.totpEnabled && (
                <span className="num rounded-sm border border-risk-low/40 bg-risk-low/10 px-1 py-px text-[9px] uppercase tracking-wider text-risk-low">
                  MFA on
                </span>
              )}
              {!user.emailVerified && (
                <span className="num rounded-sm border border-risk-medium/40 bg-risk-medium/10 px-1 py-px text-[9px] uppercase tracking-wider text-risk-medium">
                  Email unverified
                </span>
              )}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-line" />
          <DropdownMenuItem onSelect={() => setSecurityOpen(true)} className="gap-2.5 px-2.5 py-2 text-[12.5px]">
            <ShieldCheck className="h-3.5 w-3.5 text-slate-500" aria-hidden />
            Security &amp; devices
          </DropdownMenuItem>
          {organisation && can("org:members:read") && (
            <DropdownMenuItem onSelect={() => setMembersOpen(true)} className="gap-2.5 px-2.5 py-2 text-[12.5px]">
              <Users className="h-3.5 w-3.5 text-slate-500" aria-hidden />
              Organisation members
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator className="bg-line" />
          <DropdownMenuItem
            disabled={busy}
            onSelect={async () => {
              setBusy(true);
              try {
                await logout();
                window.location.href = "/";
              } finally {
                setBusy(false);
              }
            }}
            className="gap-2.5 px-2.5 py-2 text-[12.5px] text-risk-critical focus:text-risk-critical"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <LogOut className="h-3.5 w-3.5" aria-hidden />}
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SecurityDialog open={securityOpen} onOpenChange={setSecurityOpen} />
      {organisation && can("org:members:read") && (
        <MembersDialog open={membersOpen} onOpenChange={setMembersOpen} />
      )}
    </>
  );
}
