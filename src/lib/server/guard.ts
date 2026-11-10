/**
 * RazorShield AI — server-side request utilities.
 *
 * RATE LIMIT — a small in-memory fixed-window limiter blunts obvious
 * abuse of expensive endpoints (LLM probes, investigations, imports,
 * auth endpoints). State is per-process: good enough to stop casual
 * hammering in a single-node deployment. Phase 2 (see
 * docs/saas/implementation-roadmap.md) moves this behind Redis for a
 * distributed, durable limiter — documented, not yet wired.
 *
 * HISTORY NOTE: this module previously hosted a shared ADMIN_TOKEN guard
 * for the public no-auth demo. Phase 1 replaced it with real
 * authenticated sessions + RBAC (src/lib/server/auth/*) — the token
 * guard was REMOVED, not disabled, so no route can fall back to it.
 */

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
 * rate limiting must never take the app down.
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
