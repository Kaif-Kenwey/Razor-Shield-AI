"use client";

/**
 * RazorShield AI — signed-out experience: sign in, registration,
 * password reset, email verification and the TOTP step.
 *
 * Single-route SPA: the token states (verify-email / reset-password /
 * accept-invitation) arrive as ?token=…&mode=… on "/" itself and are
 * parsed from window.location.search. Email delivery is NOT configured
 * in this sandbox — when the backend returns a dev-only action link it
 * is surfaced honestly in an amber callout.
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Eye, EyeOff, KeyRound, Loader2, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";
import * as authApi from "@/services/authApi";
import { cn } from "@/lib/utils";

type Mode = "signin" | "register" | "forgot" | "reset" | "verify";

function readBootParams(): { mode: Mode; token: string } {
  if (typeof window === "undefined") return { mode: "signin", token: "" };
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";
  const requested = params.get("mode");
  if (token && requested === "reset") return { mode: "reset", token };
  if (token && requested === "verify") return { mode: "verify", token };
  if (token) return { mode: "verify", token };
  return { mode: "signin", token: "" };
}

export function AuthPanel() {
  const boot = useMemo(() => readBootParams(), []);
  const [mode, setMode] = useState<Mode>(boot.mode);
  const token = boot.token;

  return (
    <div className="flex min-h-screen flex-col bg-surface-0 lg:flex-row">
      {/* Brand rail */}
      <aside className="relative hidden flex-1 flex-col justify-between overflow-hidden border-r border-line p-10 lg:flex">
        <div className="pointer-events-none absolute -left-24 top-1/3 h-96 w-96 rounded-full bg-intel/8 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -right-16 bottom-0 h-72 w-72 rounded-full bg-risk-medium/6 blur-3xl" aria-hidden />
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="h-6 w-6 text-intel" aria-hidden />
          <p className="text-[15px] font-semibold tracking-tight text-slate-200">RazorShield AI</p>
        </div>
        <div className="max-w-md">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-100">
            Payment fraud detection your auditors can read.
          </h1>
          <p className="mt-4 text-[13.5px] leading-relaxed text-slate-500">
            Explainable risk scoring, tenant-isolated ledgers, persistent investigations and an
            append-only audit trail — built for fintechs, PSPs and payment teams. Every decision
            stays attributable to a signed-in human.
          </p>
          <ul className="mt-8 space-y-3 text-[12.5px] text-slate-400">
            {[
              "Deterministic rules engine — every score traces to its signals",
              "Organisation-scoped data isolation, enforced server-side",
              "AI investigator with honest fallback labelling",
              "Session security: lockout, MFA, revocable devices",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-intel" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[10.5px] text-slate-600">
          Bounded risk actions — every analyst decision is logged &amp; auditable.
        </p>
      </aside>

      {/* Form column */}
      <main className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="w-full max-w-[400px]"
        >
          {/* Compact brand for mobile */}
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <ShieldCheck className="h-5.5 w-5.5 text-intel" aria-hidden />
            <p className="text-[14px] font-semibold tracking-tight text-slate-200">RazorShield AI</p>
          </div>

          {mode === "signin" && <SignInCard onModeChange={setMode} />}
          {mode === "register" && <RegisterCard onModeChange={setMode} inviteToken={mode === "register" ? new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("invite") ?? "" : ""} />}
          {mode === "forgot" && <ForgotCard onModeChange={setMode} />}
          {mode === "reset" && <ResetCard token={token} onModeChange={setMode} />}
          {mode === "verify" && <VerifyCard token={token} />}
        </motion.div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function DevLinkCallout({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-sm border border-risk-medium/35 bg-risk-medium/8 p-3" role="note">
      <p className="text-[11px] font-medium leading-snug text-risk-medium">{label}</p>
      <p className="mt-1 break-all font-mono text-[10.5px] leading-relaxed text-slate-400">{url}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2 h-7 border-line px-2 text-[11px] text-slate-300"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(`${window.location.origin}${url}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard unavailable */
          }
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-sm border border-risk-critical/35 bg-risk-critical/8 px-3 py-2 text-[12px] leading-snug text-risk-critical" role="alert">
      {message}
    </p>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id} className="text-[12px] text-slate-400">{label}</Label>
        {hint && <span className="text-[10.5px] text-slate-600">{hint}</span>}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
          minLength={10}
          className="h-10 border-line bg-surface-1 pr-9 text-[13px] text-slate-200 placeholder:text-slate-600"
          placeholder="••••••••••"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sign in                                                             */
/* ------------------------------------------------------------------ */

function SignInCard({ onModeChange }: { onModeChange: (m: Mode) => void }) {
  const login = useAuthStore((s) => s.login);
  const verifyMfa = useAuthStore((s) => s.verifyMfa);
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);
  const demoAvailable = useAuthStore((s) => s.demoAvailable);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaTicket, setMfaTicket] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [pendingDigest, setPendingDigest] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    setDevUrl(null);
    try {
      const res = await login(email.trim(), password);
      if (res.mfa && res.ticket) {
        setMfaTicket(res.ticket);
        return;
      }
      if (res.devVerificationUrl) setDevUrl(res.devVerificationUrl);
    } catch {
      /* error state is in the store */
    }
  }

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    try {
      await verifyMfa(mfaTicket ?? "", code.replace(/\s+/g, ""));
    } catch {
      /* error state is in the store */
    }
  }

  async function demoSignIn() {
    clearError();
    setDevUrl(null);
    try {
      const res = await login("demo@razorshield.ai", "RazorShield!Demo2025");
      if (res.devVerificationUrl) setDevUrl(res.devVerificationUrl);
    } catch {
      /* error state is in the store */
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[19px] font-semibold tracking-tight text-slate-100">Sign in</h2>
        <p className="mt-1 text-[12.5px] text-slate-500">Access your organisation&apos;s fraud console.</p>
      </div>

      {error && <ErrorNote message={error} />}
      {devUrl && (
        <DevLinkCallout
          url={devUrl}
          label="Email delivery is not configured in this environment — your verification link (development only):"
        />
      )}

      {mfaTicket ? (
        <form onSubmit={submitMfa} className="space-y-4" aria-label="Two-factor verification">
          <div className="space-y-1.5">
            <Label htmlFor="mfa-code" className="text-[12px] text-slate-400">Authenticator code</Label>
            <Input
              id="mfa-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              className="h-10 border-line bg-surface-1 text-center font-mono text-[16px] tracking-[0.4em] text-slate-200"
              placeholder="000000"
            />
            <p className="text-[10.5px] text-slate-600">Enter the 6-digit code from your authenticator app.</p>
          </div>
          <Button type="submit" disabled={busy || code.replace(/\s/g, "").length !== 6} className="h-10 w-full bg-intel text-[13px] font-medium text-white hover:bg-intel/90">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Verify and sign in
          </Button>
          <button type="button" onClick={() => setMfaTicket(null)} className="text-[11.5px] text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline">
            Use a different account
          </button>
        </form>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-[12px] text-slate-400">Work email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              className="h-10 border-line bg-surface-1 text-[13px] text-slate-200 placeholder:text-slate-600"
              placeholder="you@company.com"
            />
          </div>
          <PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
          <Button type="submit" disabled={busy || !email || !password} className="h-10 w-full bg-intel text-[13px] font-medium text-white hover:bg-intel/90">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <LogIn className="mr-2 h-4 w-4" aria-hidden />}
            Sign in
          </Button>
        </form>
      )}

      {demoAvailable && !mfaTicket && (
        <div className="rounded-sm border border-intel/30 bg-intel/8 p-3">
          <p className="text-[11px] font-medium text-intel">Demo environment</p>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
            This deployment seeds a synthetic demo organisation (no real payment data).
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void demoSignIn()}
            disabled={busy}
            className="mt-2 h-7.5 border-intel/35 px-2.5 text-[11px] text-intel hover:bg-intel/12"
          >
            Sign in as demo analyst
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between text-[12px]">
        <button type="button" onClick={() => { clearError(); onModeChange("forgot"); }} className="text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline">
          Forgot password?
        </button>
        <button type="button" onClick={() => { clearError(); onModeChange("register"); }} className="flex items-center gap-1.5 text-intel underline-offset-2 hover:underline">
          <UserPlus className="h-3.5 w-3.5" aria-hidden />
          Create an organisation
        </button>
      </div>
      {/* keep pendingDigest referenced to avoid unused warnings in strict builds */}
      <span className="hidden">{pendingDigest ?? ""}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

function RegisterCard({ onModeChange, inviteToken }: { onModeChange: (m: Mode) => void; inviteToken: string }) {
  const register = useAuthStore((s) => s.register);
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organisationName, setOrganisationName] = useState("");
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const withInvite = inviteToken.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    try {
      const res = await register({
        name: name.trim(),
        email: email.trim(),
        password,
        ...(withInvite ? { invitationToken: inviteToken.trim() } : { organisationName: organisationName.trim() }),
      });
      if (res.devVerificationUrl) setDevUrl(res.devVerificationUrl);
    } catch {
      /* error state is in the store */
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[19px] font-semibold tracking-tight text-slate-100">
          {withInvite ? "Join your organisation" : "Create your organisation"}
        </h2>
        <p className="mt-1 text-[12.5px] text-slate-500">
          {withInvite
            ? "You were invited to an existing workspace — register to accept the invite."
            : "You become the Owner of a new, isolated tenant."}
        </p>
      </div>

      {error && <ErrorNote message={error} />}
      {devUrl && (
        <DevLinkCallout url={devUrl} label="Account created. Email delivery is not configured here — verification link (development only):" />
      )}

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="reg-name" className="text-[12px] text-slate-400">Full name</Label>
          <Input id="reg-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name"
            className="h-10 border-line bg-surface-1 text-[13px] text-slate-200 placeholder:text-slate-600" placeholder="Aarav Khan" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reg-email" className="text-[12px] text-slate-400">Work email</Label>
          <Input id="reg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email"
            className="h-10 border-line bg-surface-1 text-[13px] text-slate-200 placeholder:text-slate-600" placeholder="you@company.com" />
        </div>
        {!withInvite && (
          <div className="space-y-1.5">
            <Label htmlFor="reg-org" className="text-[12px] text-slate-400">Organisation name</Label>
            <Input id="reg-org" value={organisationName} onChange={(e) => setOrganisationName(e.target.value)} required minLength={2} maxLength={60}
              className="h-10 border-line bg-surface-1 text-[13px] text-slate-200 placeholder:text-slate-600" placeholder="Acme Payments Ltd" />
          </div>
        )}
        <PasswordField id="reg-password" label="Password" value={password} onChange={setPassword} autoComplete="new-password" hint="min 10 characters" />
        <Button type="submit" disabled={busy || !name || !email || !password || (!withInvite && !organisationName)}
          className="h-10 w-full bg-intel text-[13px] font-medium text-white hover:bg-intel/90">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          {withInvite ? "Accept invitation" : "Create organisation"}
        </Button>
      </form>

      <p className="text-center text-[12px]">
        <button type="button" onClick={() => { clearError(); onModeChange("signin"); }} className="text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline">
          Already have an account? Sign in
        </button>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Forgot password                                                     */
/* ------------------------------------------------------------------ */

function ForgotCard({ onModeChange }: { onModeChange: (m: Mode) => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await authApi.requestPasswordReset(email.trim());
      setDone(true);
      setDevUrl(res.devResetUrl ?? null);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[19px] font-semibold tracking-tight text-slate-100">Reset your password</h2>
        <p className="mt-1 text-[12.5px] text-slate-500">
          Enter your work email — if an account exists, a single-use reset link is generated (valid 30 minutes).
        </p>
      </div>

      {err && <ErrorNote message={err} />}
      {done && (
        <div className="rounded-sm border border-risk-low/30 bg-risk-low/8 p-3 text-[12px] leading-snug text-slate-300">
          Reset link generated. In this sandbox no email is actually delivered
          {devUrl ? " — your development-only link is below." : "."}
        </div>
      )}
      {devUrl && <DevLinkCallout url={devUrl} label="Development-only reset link:" />}

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="forgot-email" className="text-[12px] text-slate-400">Work email</Label>
          <Input id="forgot-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email"
            className="h-10 border-line bg-surface-1 text-[13px] text-slate-200 placeholder:text-slate-600" placeholder="you@company.com" />
        </div>
        <Button type="submit" disabled={busy || !email} className="h-10 w-full bg-intel text-[13px] font-medium text-white hover:bg-intel/90">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          Generate reset link
        </Button>
      </form>

      <p className="text-center text-[12px]">
        <button type="button" onClick={() => onModeChange("signin")} className="text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline">
          Back to sign in
        </button>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reset password                                                      */
/* ------------------------------------------------------------------ */

function ResetCard({ token, onModeChange }: { token: string; onModeChange: (m: Mode) => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[19px] font-semibold tracking-tight text-slate-100">Choose a new password</h2>
        <p className="mt-1 text-[12.5px] text-slate-500">Completing the reset signs out every device for security.</p>
      </div>

      {err && <ErrorNote message={err} />}
      {done ? (
        <div className="space-y-4">
          <div className="rounded-sm border border-risk-low/30 bg-risk-low/8 p-3 text-[12px] text-slate-300">
            Password updated. All existing sessions were revoked.
          </div>
          <Button onClick={() => onModeChange("signin")} className="h-10 w-full bg-intel text-[13px] font-medium text-white hover:bg-intel/90">
            Go to sign in
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <PasswordField id="reset-password" label="New password" value={password} onChange={setPassword} autoComplete="new-password" hint="min 10 characters" />
          <Button type="submit" disabled={busy || password.length < 10 || !token} className="h-10 w-full bg-intel text-[13px] font-medium text-white hover:bg-intel/90">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            <KeyRound className="mr-2 h-4 w-4" aria-hidden />
            Update password
          </Button>
          {!token && <ErrorNote message="This page needs a reset token — open the link from your reset email." />}
        </form>
      )}

      <p className="text-center text-[12px]">
        <button type="button" onClick={() => onModeChange("signin")} className="text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline">
          Back to sign in
        </button>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Email verification                                                  */
/* ------------------------------------------------------------------ */

function VerifyCard({ token }: { token: string }) {
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await authApi.verifyEmail(token);
        if (!cancelled) setState("done");
      } catch (ex) {
        if (!cancelled) {
          setErr(ex instanceof Error ? ex.message : "Verification failed.");
          setState("failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface-1">
        <ShieldCheck className={cn("h-6 w-6", state === "done" ? "text-risk-low" : state === "failed" ? "text-risk-critical" : "text-intel")} aria-hidden />
      </div>
      <div>
        <h2 className="text-[19px] font-semibold tracking-tight text-slate-100">Email verification</h2>
        <p className="mt-1 text-[12.5px] text-slate-500">
          {state === "working" && "Confirming your verification link…"}
          {state === "done" && "Your email address is confirmed. Sign in to continue."}
          {state === "failed" && (err ?? "This link is invalid or expired.")}
        </p>
      </div>
      {state !== "working" && (
        <Button onClick={() => { window.location.href = "/"; }} variant="outline" className="h-10 w-full border-line text-[13px] text-slate-200">
          Go to sign in
        </Button>
      )}
    </div>
  );
}
