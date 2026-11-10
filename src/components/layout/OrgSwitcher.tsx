"use client";

/**
 * RazorShield AI — organisation switcher.
 *
 * Lists the signed-in user's verified memberships. Switching re-boots
 * the session (server re-verifies membership) and reloads the ledger so
 * no stale cross-tenant row can linger in client state.
 */

import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Building2, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/store/authStore";
import { ROLE_LABELS } from "@/lib/rbac";
import { cn } from "@/lib/utils";

export function OrgSwitcher() {
  const memberships = useAuthStore((s) => s.memberships);
  const organisation = useAuthStore((s) => s.organisation);
  const role = useAuthStore((s) => s.role);
  const switchOrganisation = useAuthStore((s) => s.switchOrganisation);
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();

  if (!organisation) return null;
  const others = memberships.filter((m) => m.organisationId !== organisation.id);

  async function onSwitch(organisationId: string) {
    setBusy(organisationId);
    try {
      await switchOrganisation(organisationId);
      // Full reload: every client cache (ledger, metrics, datasets) is
      // tenant-scoped and must re-fetch against the new organisation.
      router.refresh();
      window.location.reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex h-8 shrink-0 items-center gap-2 rounded-sm border border-line bg-surface-1 px-2.5 transition-colors hover:border-line-strong"
          aria-label={`Active organisation: ${organisation.name} — switch organisation`}
        >
          <Building2 className="h-3.5 w-3.5 text-intel" aria-hidden />
          <span className="hidden max-w-[140px] truncate text-[12px] font-medium text-slate-300 md:inline">
            {organisation.name}
          </span>
          {role && (
            <span className="num hidden rounded-sm border border-line bg-surface-2 px-1 text-[9px] uppercase tracking-wider text-slate-500 lg:inline">
              {ROLE_LABELS[role]}
            </span>
          )}
          {others.length > 0 && <ChevronsUpDown className="h-3 w-3 text-slate-600" aria-hidden />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-64 border-line bg-popover">
        <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider text-slate-500">
          Organisations
        </DropdownMenuLabel>
        {memberships.map((m) => {
          const active = m.organisationId === organisation.id;
          return (
            <DropdownMenuItem
              key={m.organisationId}
              disabled={active || busy !== null}
              onSelect={() => {
                if (!active) void onSwitch(m.organisationId);
              }}
              className={cn("gap-2.5 px-2.5 py-2", active && "bg-intel/8")}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-line bg-surface-2">
                <Building2 className={cn("h-3 w-3", active ? "text-intel" : "text-slate-500")} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-slate-200">{m.organisationName}</span>
                <span className="block text-[10px] uppercase tracking-wider text-slate-600">{ROLE_LABELS[m.role]}</span>
              </span>
              {busy === m.organisationId ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-intel" aria-hidden />
              ) : (
                active && <Check className="h-3.5 w-3.5 shrink-0 text-intel" aria-hidden />
              )}
            </DropdownMenuItem>
          );
        })}
        {others.length > 0 && (
          <>
            <DropdownMenuSeparator className="bg-line" />
            <p className="px-2.5 py-1.5 text-[10px] leading-snug text-slate-600">
              Switching reloads the workspace — all data shown is scoped to the selected organisation.
            </p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
