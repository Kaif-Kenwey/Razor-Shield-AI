"use client";

/**
 * RazorShield AI — security & devices dialog: active session management
 * and TOTP MFA enrolment/disable, on the real authenticated account.
 */

import { useCallback, useEffect, useState } from "react";
import { Laptop, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import * as authApi from "@/services/authApi";
import type { SessionDevice } from "@/services/authApi";
import { useAuthStore } from "@/store/authStore";
import { relativeTime } from "@/lib/format";

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  if (/iphone|ipad/i.test(userAgent)) return "iOS device";
  if (/android/i.test(userAgent)) return "Android device";
  if (/macintosh/i.test(userAgent)) return "Mac";
  if (/windows/i.test(userAgent)) return "Windows PC";
  if (/linux/i.test(userAgent)) return "Linux device";
  return "Browser session";
}

export function SecurityDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const user = useAuthStore((s) => s.user);
  const refreshSession = useAuthStore((s) => s.refreshSession);

  const [sessions, setSessions] = useState<SessionDevice[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const [mfaBusy, setMfaBusy] = useState(false);
  const [enrolment, setEnrolment] = useState<{ otpauthUrl: string; secretOnce: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");

  const loadSessions = useCallback(async () => {
    try {
      const res = await authApi.listSessions();
      setSessions(res.sessions);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load sessions.");
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setEnrolment(null);
      setMfaCode("");
      setDisablePassword("");
      setDisableCode("");
      void loadSessions();
    }
  }, [open, loadSessions]);

  async function revoke(id: string) {
    setRevoking(id);
    try {
      await authApi.revokeSession(id);
      await loadSessions();
      toast.success("Session revoked.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Revoke failed.");
    } finally {
      setRevoking(null);
    }
  }

  async function revokeOthers() {
    setRevoking("__all__");
    try {
      const res = await authApi.revokeAllOtherSessions();
      await loadSessions();
      toast.success(`Revoked ${res.revoked} other session${res.revoked === 1 ? "" : "s"}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Revoke failed.");
    } finally {
      setRevoking(null);
    }
  }

  async function startMfa() {
    setMfaBusy(true);
    try {
      const res = await authApi.mfaSetup();
      setEnrolment({ otpauthUrl: res.otpauthUrl, secretOnce: res.secretOnce });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start MFA enrolment.");
    } finally {
      setMfaBusy(false);
    }
  }

  async function confirmMfa() {
    if (!enrolment) return;
    setMfaBusy(true);
    try {
      await authApi.mfaEnable(enrolment.secretOnce, mfaCode.replace(/\s/g, ""));
      await refreshSession();
      setEnrolment(null);
      setMfaCode("");
      toast.success("Authenticator app enabled — you will be asked for a code at next sign-in.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed — enrolment not completed.");
    } finally {
      setMfaBusy(false);
    }
  }

  async function disableMfa() {
    setMfaBusy(true);
    try {
      await authApi.mfaDisable(disablePassword, disableCode.replace(/\s/g, ""));
      await refreshSession();
      setDisablePassword("");
      setDisableCode("");
      toast.success("MFA disabled.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not disable MFA.");
    } finally {
      setMfaBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto scroll-thin border-line bg-surface-0 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold tracking-tight text-slate-100">Security &amp; devices</DialogTitle>
          <DialogDescription className="text-[12px] text-slate-500">
            Sessions carry a server-verified identity — revoke any device instantly.
          </DialogDescription>
        </DialogHeader>

        {/* Sessions */}
        <section aria-label="Active sessions" className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="micro text-slate-500">Active sessions</p>
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-line px-2 text-[11px] text-slate-300"
              disabled={revoking !== null || !sessions?.some((s) => !s.current)}
              onClick={() => void revokeOthers()}
            >
              {revoking === "__all__" ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden /> : null}
              Revoke all others
            </Button>
          </div>
          <div className="max-h-64 space-y-1.5 overflow-y-auto scroll-thin pr-1">
            {sessions === null && (
              <p className="flex items-center gap-2 py-6 text-[12px] text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading sessions…
              </p>
            )}
            {sessions?.length === 0 && (
              <p className="py-6 text-center text-[12px] text-slate-600">No active sessions.</p>
            )}
            {sessions?.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-sm border border-line bg-surface-1 px-3 py-2.5">
                <Laptop className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[12px] font-medium text-slate-200">
                    {deviceLabel(s.userAgent)}
                    {s.current && (
                      <span className="num rounded-sm border border-risk-low/40 bg-risk-low/10 px-1 text-[9px] uppercase tracking-wider text-risk-low">
                        This device
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[10.5px] text-slate-600">
                    {s.ip ? `${s.ip} · ` : ""}active {relativeTime(s.lastSeenAt)}
                  </p>
                </div>
                {!s.current && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 border-line px-2 text-[11px] text-risk-critical hover:bg-risk-critical/10"
                    disabled={revoking !== null}
                    onClick={() => void revoke(s.id)}
                  >
                    {revoking === s.id ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : "Revoke"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>

        <Separator className="bg-line" />

        {/* MFA */}
        <section aria-label="Two-factor authentication" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="micro text-slate-500">Authenticator app (TOTP)</p>
            {user?.totpEnabled ? (
              <span className="num flex items-center gap-1 rounded-sm border border-risk-low/40 bg-risk-low/10 px-1.5 py-px text-[9.5px] uppercase tracking-wider text-risk-low">
                <ShieldCheck className="h-3 w-3" aria-hidden /> Enabled
              </span>
            ) : (
              <span className="num flex items-center gap-1 rounded-sm border border-risk-medium/40 bg-risk-medium/10 px-1.5 py-px text-[9.5px] uppercase tracking-wider text-risk-medium">
                <ShieldOff className="h-3 w-3" aria-hidden /> Off
              </span>
            )}
          </div>

          {!user?.totpEnabled && !enrolment && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-intel/35 px-3 text-[12px] text-intel hover:bg-intel/10"
              disabled={mfaBusy}
              onClick={() => void startMfa()}
            >
              {mfaBusy ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden /> : null}
              Enable authenticator app
            </Button>
          )}

          {enrolment && (
            <div className="space-y-3 rounded-sm border border-line bg-surface-1 p-3">
              <p className="text-[11.5px] leading-snug text-slate-400">
                Add this secret to your authenticator app (Google Authenticator, 1Password, Aegis…),
                then confirm with a 6-digit code. Shown once.
              </p>
              <code className="block break-all rounded-sm border border-line bg-surface-2 px-2.5 py-2 font-mono text-[11px] text-slate-300">
                {enrolment.secretOnce}
              </code>
              <p className="break-all font-mono text-[9.5px] leading-relaxed text-slate-600">{enrolment.otpauthUrl}</p>
              <div className="flex gap-2">
                <Input
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  aria-label="Authenticator code"
                  className="h-9 border-line bg-surface-2 text-center font-mono tracking-[0.35em] text-slate-200"
                />
                <Button
                  size="sm"
                  className="h-9 bg-intel px-3 text-[12px] text-white hover:bg-intel/90"
                  disabled={mfaBusy || mfaCode.replace(/\s/g, "").length !== 6}
                  onClick={() => void confirmMfa()}
                >
                  {mfaBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : "Confirm"}
                </Button>
              </div>
            </div>
          )}

          {user?.totpEnabled && (
            <div className="space-y-2 rounded-sm border border-line bg-surface-1 p-3">
              <p className="text-[11.5px] leading-snug text-slate-400">
                Disabling MFA requires your password and a current code.
              </p>
              <Input
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                placeholder="Current password"
                aria-label="Current password"
                autoComplete="current-password"
                className="h-9 border-line bg-surface-2 text-[12px] text-slate-200"
              />
              <div className="flex gap-2">
                <Input
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  aria-label="Authenticator code"
                  className="h-9 border-line bg-surface-2 text-center font-mono tracking-[0.35em] text-slate-200"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 border-risk-critical/40 px-3 text-[12px] text-risk-critical hover:bg-risk-critical/10"
                  disabled={mfaBusy || !disablePassword || disableCode.replace(/\s/g, "").length !== 6}
                  onClick={() => void disableMfa()}
                >
                  {mfaBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : "Disable MFA"}
                </Button>
              </div>
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
