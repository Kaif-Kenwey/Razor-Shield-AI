/**
 * RazorShield AI — authenticated request context + route guards.
 *
 * SECURITY MODEL
 *   - The session cookie carries an opaque token; its SHA-256 hash is
 *     looked up server-side. Expired or revoked sessions are rejected.
 *   - The active organisation comes from the rs_org cookie but is NEVER
 *     trusted as authorisation: membership is re-verified against the
 *     database on every request.
 *   - Roles/permissions are derived server-side from that verified
 *     membership (see src/lib/rbac.ts).
 *   - Cross-tenant resource access must be answered with a
 *     non-disclosing 404 (resource "does not exist" for the caller).
 *
 * Every protected API route starts with requireAuth / requireOrg /
 * requirePermission. Guards read the request object directly (not
 * next/headers) so route handlers stay unit-testable.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hasPermission, permissionDeniedMessage, permissionsForRole, type Permission, type Role } from "@/lib/rbac";
import { ORG_COOKIE, SESSION_COOKIE } from "./cookies";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  emailVerified: boolean;
  totpEnabled: boolean;
}

export interface AuthMembership {
  organisationId: string;
  organisationName: string;
  organisationSlug: string;
  role: Role;
}

export interface AuthContext {
  user: AuthUser;
  sessionId: string;
  memberships: AuthMembership[];
  /** Active organisation — verified membership, or null when the user has none selected/joined. */
  organisationId: string | null;
  role: Role | null;
  permissions: Permission[];
}

/** A guard failure carries a ready-to-return response. */
export type GuardResult<T> = { ok: true; value: T } | { ok: false; response: NextResponse };

function unauthorized(message: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ok: false, error: message, code: "UNAUTHENTICATED", ...extra }, { status: 401 });
}

function forbidden(message: string): NextResponse {
  return NextResponse.json({ ok: false, error: message, code: "FORBIDDEN" }, { status: 403 });
}

/**
 * Resolves the authenticated context for a request, or null when no
 * valid session. Also applies sliding expiry: sessions near the end of
 * their lifetime are extended; lastSeenAt is refreshed at most every
 * 5 minutes to bound write traffic.
 */
export async function resolveSession(request: Request): Promise<AuthContext | null> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const sessionCookie = readCookie(cookieHeader, SESSION_COOKIE);
  if (!sessionCookie) return null;

  const { tokenFingerprint } = await import("./tokens");
  const tokenHash = tokenFingerprint(sessionCookie);

  const session = await db.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session || session.revokedAt) return null;

  const now = new Date();
  if (session.expiresAt.getTime() <= now.getTime()) return null;

  // Sliding window: extend when more than half the TTL has elapsed.
  const halfLife = new Date(session.expiresAt.getTime() - 15 * 24 * 60 * 60 * 1000);
  const expiredStale = session.lastSeenAt.getTime() < now.getTime() - 5 * 60 * 1000;
  if (halfLife <= now || expiredStale) {
    await db.session.update({
      where: { id: session.id },
      data: {
        lastSeenAt: now,
        ...(halfLife <= now ? { expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) } : {}),
      },
    });
  }

  const memberships = await db.membership.findMany({
    where: { userId: session.userId },
    include: { organisation: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: "asc" },
  });

  const membershipDtos: AuthMembership[] = memberships.map((m) => ({
    organisationId: m.organisationId,
    organisationName: m.organisation.name,
    organisationSlug: m.organisation.slug,
    role: m.role as Role,
  }));

  // Active org: rs_org cookie when it is a verified membership, else the
  // first membership. Client-supplied org ids are validated, never trusted.
  const orgCookie = readCookie(cookieHeader, ORG_COOKIE);
  const active =
    membershipDtos.find((m) => m.organisationId === orgCookie) ?? membershipDtos[0] ?? null;

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      isPlatformAdmin: session.user.isPlatformAdmin,
      emailVerified: session.user.emailVerifiedAt !== null,
      totpEnabled: session.user.totpEnabled,
    },
    sessionId: session.id,
    memberships: membershipDtos,
    organisationId: active?.organisationId ?? null,
    role: active?.role ?? null,
    permissions: active ? [...permissionsOf(active.role)] : [],
  };
}

function permissionsOf(role: Role): Permission[] {
  return [...permissionsForRole(role)];
}

function readCookie(cookieHeader: string, name: string): string | null {
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Route guards                                                        */
/* ------------------------------------------------------------------ */

const DEMO_HINT_COOKIE = "demo@example.com";

/** 401 unless a valid session exists. */
export async function requireAuth(request: Request): Promise<GuardResult<AuthContext>> {
  const ctx = await resolveSession(request);
  if (!ctx) {
    const demoAvailable =
      process.env.NODE_ENV !== "production" &&
      (await db.user.findUnique({ where: { email: DEMO_HINT_COOKIE }, select: { id: true } })) !== null;
    return {
      ok: false,
      response: unauthorized("Authentication required. Sign in to continue.", {
        demoAvailable,
      }),
    };
  }
  return { ok: true, value: ctx };
}

/** 401 unless authenticated; 403 without an active organisation. */
export async function requireOrg(request: Request): Promise<GuardResult<AuthContext & { organisationId: string; role: Role }>> {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth;
  const ctx = auth.value;
  if (!ctx.organisationId || !ctx.role) {
    return { ok: false, response: forbidden("You are not a member of any organisation.") };
  }
  return { ok: true, value: ctx as AuthContext & { organisationId: string; role: Role } };
}

/** 401/403 unless the active membership grants the permission. */
export async function requirePermission(
  request: Request,
  permission: Permission,
): Promise<GuardResult<AuthContext & { organisationId: string; role: Role }>> {
  const auth = await requireOrg(request);
  if (!auth.ok) return auth;
  if (!hasPermission(auth.value.role, permission)) {
    return { ok: false, response: forbidden(permissionDeniedMessage(permission)) };
  }
  return auth;
}

/**
 * CSRF defence for cookie-authenticated mutations.
 *
 * Primary signal: `Sec-Fetch-Site` — set by the BROWSER itself (a
 * forbidden header name, unforgeable by page JavaScript) describing
 * whether the request originates from the same site. "same-origin" and
 * "none" (user-initiated navigation) are allowed; "cross-site"/"same-site"
 * are rejected. This stays correct even behind proxies that rewrite the
 * Host header (e.g. preview gateways), where Origin/Host comparison
 * breaks.
 *
 * Fallback (browsers without Fetch Metadata, curl, server-to-server):
 * compare the Origin header against the request host when Origin is
 * present; requests without Origin cannot silently carry a victim's
 * cookies, so they are allowed.
 */
export function assertSameOrigin(request: Request): NextResponse | null {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite) {
    if (fetchSite === "same-origin" || fetchSite === "none") return null;
    return forbidden(`Cross-site ${method} rejected (CSRF protection, sec-fetch-site=${fetchSite}).`);
  }

  const origin = request.headers.get("origin");
  if (!origin) return null; // non-browser client

  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    /* Programmatically-built Requests (integration tests, internal calls)
     * may omit Host — the request URL's own authority is the server's
     * address and cannot be attacker-chosen. */
    new URL(request.url).host;
  if (!host) return forbidden("Missing host header.");

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return forbidden("Malformed Origin header.");
  }
  if (originHost !== host) {
    return forbidden("Cross-origin request rejected (CSRF protection).");
  }
  return null;
}

/**
 * Standard guard stack for a mutating, permission-gated route:
 * same-origin check → auth → permission.
 */
export async function guardMutation(
  request: Request,
  permission: Permission,
): Promise<GuardResult<AuthContext & { organisationId: string; role: Role }>> {
  const csrf = assertSameOrigin(request);
  if (csrf) return { ok: false, response: csrf };
  return requirePermission(request, permission);
}

/** Standard guard stack for a mutating route that only needs auth. */
export async function guardMutationAuth(request: Request): Promise<GuardResult<AuthContext>> {
  const csrf = assertSameOrigin(request);
  if (csrf) return { ok: false, response: csrf };
  return requireAuth(request);
}
