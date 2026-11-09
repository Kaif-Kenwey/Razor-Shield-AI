/**
 * RazorShield AI — route protection utilities (server-side only).
 *
 * This is a deliberately small, honest layer for a public no-auth demo:
 *
 *   1. ADMIN GUARD — mutating "operator" surfaces (LLM config write/clear,
 *      destructive demo-data clears, ledger row deletes) can require a
 *      shared admin token. Enable it by setting ADMIN_TOKEN in the
 *      environment; the UI then prompts for the token once and sends it
 *      as the x-admin-token header. With no ADMIN_TOKEN set the app runs
 *      in open demo mode — writes stay allowed but every guarded action
 *      is audit-logged and /api/system/health reports the state so the
 *      mode is never silent.
 *
 *   2. RATE LIMIT — a tiny in-memory fixed-window limiter blunts obvious
 *      abuse of expensive endpoints (LLM probes, investigations, imports)
 *      on public deployments. State is per-process: good enough to stop
 *      casual hammering, not a substitute for an edge rate limiter.
 */

import { timingSafeEqual } from "crypto";

/* ------------------------------------------------------------------ */
/* Admin guard                                                         */
/* ------------------------------------------------------------------ */

export type AdminGuardState = {
  /** "env" = ADMIN_TOKEN from environment; "open" = open demo mode. */
  mode: "env" | "open";
};

export function adminGuardState(): AdminGuardState {
  return { mode: process.env.ADMIN_TOKEN?.trim() ? "env" : "open" };
}

export function adminGuardEnabled(): boolean {
  return adminGuardState().mode === "env";
}

/** Constant-time string equality (lengths may differ → false). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Returns null when the request may proceed, or a ready-to-return 401
 * response body describing what to do. Reads the token from the
 * `x-admin-token` header (what the UI sends) or `?adminToken=` (what a
 * script might use).
 */
export function checkAdminGuard(request: Request): { ok: true } | { ok: false; message: string } {
  const state = adminGuardState();
  if (state.mode === "open") return { ok: true };

  const header = request.headers.get("x-admin-token")?.trim() ?? "";
  const query = new URL(request.url).searchParams.get("adminToken")?.trim() ?? "";
  const provided = header || query;
  const expected = process.env.ADMIN_TOKEN?.trim() ?? "";

  if (provided && expected && safeEqual(provided, expected)) return { ok: true };
  return {
    ok: false,
    message:
      "This deployment requires an admin token for configuration changes. Set the x-admin-token header (the AI panel will prompt for it), or unset ADMIN_TOKEN to run in open demo mode.",
  };
}

/* ------------------------------------------------------------------ */
/* Fixed-window rate limiter (per process, per key)                    */
/* ------------------------------------------------------------------ */

const buckets = new Map<string, { count: number; resetAt: number }>();

/** Drop expired buckets occasionally so the map cannot grow unbounded. */
function sweep(now: number): void {
  if (buckets.size < 512) return;
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

export interface RateLimitVerdict {
  allowed: boolean;
  retryAfterSec: number;
}

/**
 * Fixed-window limiter. `key` should already contain route + identity
 * (e.g. `llm-config:save:1.2.3.4`). Fails OPEN on internal errors —
 * rate limiting must never take the demo down.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitVerdict {
  try {
    const now = Date.now();
    sweep(now);
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSec: 0 };
    }
    if (bucket.count < limit) {
      bucket.count += 1;
      return { allowed: true, retryAfterSec: 0 };
    }
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  } catch {
    return { allowed: true, retryAfterSec: 0 };
  }
}

/** Best-effort client identity for the limiter (proxy-aware). */
export function clientKey(request: Request, scope: string): string {
  const fwd =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "local";
  return `${scope}:${fwd}`;
}
