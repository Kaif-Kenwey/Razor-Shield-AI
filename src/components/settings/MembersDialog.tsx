"use client";

/**
 * RazorShield AI — organisation members & invitations dialog.
 * Permission-aware: role editing/removal requires org:members:manage,
 * invitations require org:invitations:manage (server-enforced too).
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Mail, UserMinus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import * as authApi from "@/services/authApi";
import type { OrgInvitation, OrgMember, Role } from "@/services/authApi";
import { useAuthStore } from "@/store/authStore";
import { ROLE_LABELS } from "@/lib/rbac";
import { relativeTime } from "@/lib/format";

const ALL_ROLES: Role[] = ["OWNER", "ADMIN", "FRAUD_MANAGER", "ANALYST", "INVESTIGATOR", "AUDITOR", "VIEWER", "BILLING_ADMIN"];

export function MembersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const canManage = useAuthStore((s) => s.can("org:members:manage"));
  const canInvite = useAuthStore((s) => s.can("org:invitations:manage"));
  const organisation = useAuthStore((s) => s.organisation);

  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [invitations, setInvitations] = useState<OrgInvitation[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<OrgMember | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("ANALYST");
  const [inviteBusy, setInviteBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, i] = await Promise.all([
        authApi.listMembers(),
        canInvite ? authApi.listInvitations() : Promise.resolve({ ok: true as const, invitations: [] }),
      ]);
      setMembers(m.members);
      setInvitations(i.invitations);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load members.");
      setMembers([]);
      setInvitations([]);
    }
  }, [canInvite]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function changeRole(member: OrgMember, role: Role) {
    setBusyId(member.membershipId);
    try {
      await authApi.changeMemberRole(member.membershipId, role);
      await load();
      toast.success(`${member.name} is now ${ROLE_LABELS[role]}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Role change failed.");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(member: OrgMember) {
    setBusyId(member.membershipId);
    try {
      await authApi.removeMember(member.membershipId);
      await load();
      toast.success(`${member.name} removed from the organisation.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Removal failed.");
    } finally {
      setBusyId(null);
      setRemoveTarget(null);
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setInviteBusy(true);
    try {
      const res = await authApi.createInvitation(inviteEmail.trim(), inviteRole);
      setInviteEmail("");
      await load();
      if (res.devUrl) {
        toast.info("Email delivery is not configured in this sandbox", {
          description: `Development-only invite link: ${window.location.origin}${res.devUrl}`,
          duration: 12000,
        });
      } else {
        toast.success(`Invitation sent to ${res.invitation.email}.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invite failed.");
    } finally {
      setInviteBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusyId(id);
    try {
      await authApi.revokeInvitation(id);
      await load();
      toast.success("Invitation revoked.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Revoke failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto scroll-thin border-line bg-surface-0 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold tracking-tight text-slate-100">
            {organisation ? `${organisation.name} — members` : "Organisation members"}
          </DialogTitle>
          <DialogDescription className="text-[12px] text-slate-500">
            {organisation?.counts.members ?? "—"} {organisation?.counts.members === 1 ? "member" : "members"}. Roles decide what each person can do; the server enforces every permission.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="members">
          <TabsList className="bg-surface-1">
            <TabsTrigger value="members" className="text-[12px]">Members</TabsTrigger>
            {canInvite && <TabsTrigger value="invitations" className="text-[12px]">Invitations</TabsTrigger>}
          </TabsList>

          <TabsContent value="members" className="mt-3 space-y-2">
            {members === null && (
              <p className="flex items-center gap-2 py-6 text-[12px] text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading members…
              </p>
            )}
            {members?.map((m) => (
              <div key={m.membershipId} className="flex items-center gap-3 rounded-sm border border-line bg-surface-1 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-slate-200">{m.name}</p>
                  <p className="truncate text-[10.5px] text-slate-600">
                    {m.email} · joined {relativeTime(m.joinedAt)}
                  </p>
                </div>
                {canManage ? (
                  <Select
                    value={m.role}
                    disabled={busyId === m.membershipId}
                    onValueChange={(v) => void changeRole(m, v as Role)}
                  >
                    <SelectTrigger className="h-8 w-[168px] shrink-0 border-line bg-surface-2 text-[11.5px] text-slate-300" aria-label={`Role for ${m.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-line bg-popover">
                      {ALL_ROLES.map((r) => (
                        <SelectItem key={r} value={r} className="text-[12px]">
                          {ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="num shrink-0 rounded-sm border border-line bg-surface-2 px-1.5 py-px text-[9.5px] uppercase tracking-wider text-slate-400">
                    {ROLE_LABELS[m.role]}
                  </span>
                )}
                {canManage && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 shrink-0 border-line p-0 text-slate-500 hover:border-risk-critical/40 hover:text-risk-critical"
                    disabled={busyId === m.membershipId}
                    aria-label={`Remove ${m.name}`}
                    onClick={() => setRemoveTarget(m)}
                  >
                    {busyId === m.membershipId ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <UserMinus className="h-3.5 w-3.5" />}
                  </Button>
                )}
              </div>
            ))}
          </TabsContent>

          {canInvite && (
            <TabsContent value="invitations" className="mt-3 space-y-3">
              <form onSubmit={invite} className="flex flex-col gap-2 rounded-sm border border-line bg-surface-1 p-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor="invite-email" className="text-[11.5px] text-slate-400">Invite by email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                    placeholder="colleague@company.com"
                    className="h-9 border-line bg-surface-2 text-[12.5px] text-slate-200 placeholder:text-slate-600"
                  />
                </div>
                <div className="space-y-1.5 sm:w-44">
                  <Label className="text-[11.5px] text-slate-400">Role</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
                    <SelectTrigger className="h-9 border-line bg-surface-2 text-[12px] text-slate-300" aria-label="Invitation role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-line bg-popover">
                      {ALL_ROLES.map((r) => (
                        <SelectItem key={r} value={r} className="text-[12px]">
                          {ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" disabled={inviteBusy || !inviteEmail} className="h-9 shrink-0 bg-intel px-3.5 text-[12px] text-white hover:bg-intel/90">
                  {inviteBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Mail className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                  Invite
                </Button>
              </form>

              {invitations === null && (
                <p className="flex items-center gap-2 py-4 text-[12px] text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading invitations…
                </p>
              )}
              {invitations?.length === 0 && (
                <p className="py-4 text-center text-[12px] text-slate-600">No pending invitations.</p>
              )}
              {invitations?.map((i) => (
                <div key={i.id} className="flex items-center gap-3 rounded-sm border border-line bg-surface-1 px-3 py-2.5">
                  <Mail className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] text-slate-200">{i.email}</p>
                    <p className="text-[10.5px] text-slate-600">
                      {ROLE_LABELS[i.role]} · invited by {i.invitedBy ?? "—"} · expires {relativeTime(i.expiresAt)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 border-line px-2 text-[11px] text-slate-300"
                    disabled={busyId === i.id}
                    onClick={() => void revoke(i.id)}
                  >
                    {busyId === i.id ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : "Revoke"}
                  </Button>
                </div>
              ))}
            </TabsContent>
          )}
        </Tabs>

        {/* Remove confirmation */}
        <AlertDialog open={removeTarget !== null} onOpenChange={(o) => !o && setRemoveTarget(null)}>
          <AlertDialogContent className="border-line bg-surface-0">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-[15px] text-slate-100">
                Remove {removeTarget?.name}?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-[12.5px] text-slate-500">
                They lose access to this organisation immediately. Cases they were assigned stay in the queue;
                the audit trail keeps their historical attribution.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-line bg-surface-1 text-[12.5px] text-slate-300">Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-risk-critical text-[12.5px] text-white hover:bg-risk-critical/90"
                onClick={() => removeTarget && void remove(removeTarget)}
              >
                Remove member
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
