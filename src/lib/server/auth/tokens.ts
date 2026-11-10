/**
 * RazorShield AI — opaque token generation + hashing.
 *
 * Session/verification tokens are 256-bit random values delivered in
 * cookies or links; the database stores ONLY their SHA-256 hash, so a
 * database leak does not yield usable credentials.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";

/** 256-bit URL-safe opaque token. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Deterministic fingerprint used for at-rest storage. */
export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison for token material (lengths may differ → false). */
export function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
