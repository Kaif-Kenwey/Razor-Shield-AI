/**
 * RazorShield AI — TOTP multi-factor authentication (RFC 6238).
 *
 * Uses the maintained `otplib` implementation — never hand-rolled
 * cryptography. Secrets are stored AES-256-GCM sealed (secretBox); the
 * plaintext secret exists only long enough to enrol an authenticator or
 * verify a code.
 */

import { generateSecret, generateURI, verifySync } from "otplib/functional";
import { openSecret, sealSecret } from "@/lib/server/secretBox";

export interface TotpEnrolment {
  /** Sealed secret for storage (never returned to the client). */
  secretEnc: string;
  /** otpauth:// URI for authenticator apps (safe to show during enrolment). */
  otpauthUrl: string;
  /** The raw secret, shown once as a manual-entry fallback. */
  secretOnce: string;
}

export function enrolTotp(userEmail: string): TotpEnrolment {
  const secret = generateSecret();
  const otpauthUrl = generateURI({
    issuer: "RazorShield AI",
    label: userEmail,
    secret,
  });
  return { secretEnc: sealSecret(secret), otpauthUrl, secretOnce: secret };
}

/**
 * Verifies a code against a sealed secret. Returns true when valid
 * (otplib tolerates the common ±1 time-step clock drift).
 */
export function verifyTotp(secretEnc: string, code: string): boolean {
  const secret = openSecret(secretEnc);
  if (!secret) return false;
  const normalized = (code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  try {
    return verifySync({ token: normalized, secret }).valid === true;
  } catch {
    return false;
  }
}
