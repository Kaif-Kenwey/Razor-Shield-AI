/**
 * RazorShield AI — server-side secret box (AES-256-GCM).
 *
 * One encryption facility for all secrets at rest (per-organisation LLM
 * API keys, TOTP secrets). Wire format: "enc:v1:<iv>.<tag>.<ciphertext>"
 * (hex) — authenticated encryption; a tampered or wrongly-keyed value
 * fails to open and is treated as ABSENT, never trusted.
 *
 * Key management:
 *   1. ENCRYPTION_KEY env var (recommended for production; any long
 *      passphrase — stretched to 32 bytes via SHA-256).
 *   2. Fallback: a random per-machine key persisted to db/.secret-box-key
 *      with 0600 permissions (gitignored) — convenient for local dev.
 *
 * Rotation: set a new ENCRYPTION_KEY and re-save affected secrets; values
 * that fail to open are reported as "not configured" instead of erroring.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { chmodSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const ENC_PREFIX = "enc:v1:";

let cachedKey: Buffer | null = null;

function secretBoxKey(): Buffer {
  if (cachedKey) return cachedKey;
  const envKey = process.env.ENCRYPTION_KEY?.trim();
  if (envKey) {
    cachedKey = createHash("sha256").update(`razorshield:secretbox:${envKey}`).digest();
    return cachedKey;
  }
  // Per-machine fallback key file.
  try {
    const keyPath = path.join(process.cwd(), "db", ".secret-box-key");
    if (existsSync(keyPath)) {
      const material = readFileSync(keyPath, "utf8").trim();
      if (material.length >= 32) {
        cachedKey = createHash("sha256").update(`razorshield:secretbox:${material}`).digest();
        return cachedKey;
      }
    }
    const material = randomBytes(32).toString("hex");
    mkdirSync(path.dirname(keyPath), { recursive: true });
    const fd = openSync(keyPath, "w", 0o600);
    writeFileSync(fd, material + "\n", "utf8");
    closeSync(fd);
    try {
      chmodSync(keyPath, 0o600);
    } catch {
      /* best effort on platforms without chmod */
    }
    cachedKey = createHash("sha256").update(`razorshield:secretbox:${material}`).digest();
    return cachedKey;
  } catch {
    // Ephemeral in-memory key: still safe within this process; secrets
    // re-sealed on next save after a restart.
    cachedKey = createHash("sha256").update(randomBytes(32)).digest();
    return cachedKey;
  }
}

/** Encrypts a secret for storage. Returns "enc:v1:iv.tag.ciphertext". */
export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretBoxKey(), iv, { authTagLength: 16 });
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("hex")}.${tag.toString("hex")}.${ct.toString("hex")}`;
}

/**
 * Opens a sealed secret. Returns "" when the value is absent, tampered
 * with, or was sealed under a different key — callers treat "" as "not
 * configured" (fail-closed, never trust unauthenticated bytes).
 */
export function openSecret(sealed: string | null | undefined): string {
  if (!sealed) return "";
  if (!sealed.startsWith(ENC_PREFIX)) return ""; // unknown format — fail closed
  try {
    const [ivHex, tagHex, ctHex] = sealed.slice(ENC_PREFIX.length).split(".");
    if (!ivHex || !tagHex || !ctHex) return "";
    const decipher = createDecipheriv("aes-256-gcm", secretBoxKey(), Buffer.from(ivHex, "hex"), {
      authTagLength: 16,
    });
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

/** True when a value is in the sealed wire format. */
export function isSealed(v: string | null | undefined): boolean {
  return typeof v === "string" && v.startsWith(ENC_PREFIX);
}
