"use client";

/**
 * RazorShield AI — authentication gate.
 *
 * Mounts once at the app root. Loading → branded splash; unauthenticated
 * → the sign-in experience; authenticated → the product. Also listens
 * for the business-API layer's 401 events (expired/revoked session) and
 * re-boots the session state.
 */

import { useEffect } from "react";
import { motion } from "framer-motion";
import { ShieldCheck } from "lucide-react";
import { AuthPanel } from "@/components/auth/AuthPanel";
import { useAuthStore, initialsOf } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";
import { UNAUTHORIZED_EVENT } from "@/services/authApi";
import type { ReactNode } from "react";

export function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  /* Boot the session once. */
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  /* A revoked/expired session anywhere in the app returns to sign-in. */
  useEffect(() => {
    const onUnauthorized = () => void bootstrap();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [bootstrap]);

  /* Hydrate the legacy display persona from the real identity so every
   * existing attribution surface shows the authenticated user's initials
   * instead of a roster persona. */
  const user = useAuthStore((s) => s.user);
  useEffect(() => {
    if (user) {
      const store = useAppStore.getState();
      const wanted = initialsOf(user.name);
      if (store.signedInAnalystId !== wanted) store.setSignedInAnalyst(wanted);
    }
  }, [user]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface-0" role="status" aria-live="polite">
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="relative"
        >
          <ShieldCheck className="h-10 w-10 text-intel" aria-hidden />
          <span className="absolute inset-0 -z-10 rounded-full bg-intel/20 blur-xl" aria-hidden />
        </motion.div>
        <p className="micro text-slate-500">Establishing secure session…</p>
        <span className="sr-only">Loading RazorShield AI</span>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <AuthPanel />;
  }

  return <>{children}</>;
}
