/**
 * RazorShield AI — session cookie plumbing.
 *
 * Two cookies:
 *   rs_session — opaque session token (httpOnly, SameSite=Lax, Secure in
 *                production, 30-day expiry with server-side sliding).
 *   rs_org     — active organisation id for members of 2+ organisations.
 *                NEVER trusted on its own: the server re-verifies
 *                membership for the active organisation on every request.
 */

import type { NextResponse } from "next/server";

export const SESSION_COOKIE = "rs_session";
export const ORG_COOKIE = "rs_org";

/** 30 days. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionCookieOptions {
  maxAgeSec?: number;
}

export function setSessionCookie(res: NextResponse, token: string, opts?: SessionCookieOptions): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: opts?.maxAgeSec ?? Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function setOrgCookie(res: NextResponse, organisationId: string): void {
  res.cookies.set(ORG_COOKIE, organisationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookies(res: NextResponse): void {
  const base = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  };
  res.cookies.set(SESSION_COOKIE, "", base);
  res.cookies.set(ORG_COOKIE, "", base);
}
