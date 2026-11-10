/**
 * RazorShield AI — password hashing + policy.
 *
 * Hashing uses bcrypt (bcryptjs, cost 12) — a reputable, widely-reviewed
 * implementation. We never implement cryptography ourselves. Policy is
 * length-based (NIST SP 800-63B: length over composition rules); a block
 * list of trivial passwords catches the worst offenders.
 */

import bcrypt from "bcryptjs";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

const BLOCKED = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "1234567890",
  "qwertyuiop",
  "letmein123",
  "iloveyou12",
  "admin12345",
  "welcome123",
]);

export interface PasswordCheck {
  ok: boolean;
  reason?: string;
}

export function checkPasswordPolicy(password: string): PasswordCheck {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, reason: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.` };
  }
  const lower = password.toLowerCase();
  if (BLOCKED.has(lower)) {
    return { ok: false, reason: "That password is too common. Choose something less predictable." };
  }
  return { ok: true };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}
