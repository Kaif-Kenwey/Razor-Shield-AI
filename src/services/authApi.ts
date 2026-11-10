/**
 * RazorShield AI — authentication API client.
 *
 * Typed surface over the /api/auth/* + /api/org/* endpoints. All requests
 * are same-origin (cookies ride along automatically; the server's CSRF
 * guard checks the Origin header the browser sets on mutations).
 */

export type Role =
  | "OWNER"
  | "ADMIN"
  | "FRAUD_MANAGER"
  | "ANALYST"
  | "INVESTIGATOR"
  | "AUDITOR"
  | "VIEWER"
  | "BILLING_ADMIN";

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

export interface OrganisationProfile {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  counts: { members: number; transactions: number; datasets: number };
}

export interface SessionResponse {
  ok: true;
  user: AuthUser;
  sessionId: string;
  memberships: AuthMembership[];
  organisationId: string | null;
  role: Role | null;
  permissions: string[];
  organisation: OrganisationProfile | null;
}

export interface ApiFailure {
  ok: false;
  error: string;
  code?: string;
  demoAvailable?: boolean;
  retryAfterSec?: number;
}

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || (data && (data as { ok?: boolean }).ok === false)) {
    const err = new Error(data?.error || `Request failed (${res.status})`) as Error & {
      status?: number;
      payload?: unknown;
    };
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data as T;
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  return parse<T>(res);
}

/* ------------------------------------------------------------------ */
/* Auth flows                                                          */
/* ------------------------------------------------------------------ */

export interface LoginResult {
  ok: true;
  user?: AuthUser;
  mfaRequired?: boolean;
  ticket?: string;
  requiresEmailVerification?: boolean;
  devVerificationUrl?: string;
}

export function login(email: string, password: string): Promise<LoginResult> {
  return send<LoginResult>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function verifyMfa(ticket: string, code: string): Promise<{ ok: true; user: AuthUser }> {
  return send("/api/auth/mfa/verify", {
    method: "POST",
    body: JSON.stringify({ ticket, code }),
  });
}

export interface RegisterResult {
  ok: true;
  user: AuthUser;
  organisation: { id: string; name: string; slug: string } | null;
  role: Role | null;
  requiresEmailVerification?: boolean;
  devVerificationUrl?: string;
}

export function register(input: {
  name: string;
  email: string;
  password: string;
  organisationName?: string;
  invitationToken?: string;
}): Promise<RegisterResult> {
  return send<RegisterResult>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function logout(): Promise<{ ok: true }> {
  return send("/api/auth/logout", { method: "POST" });
}

export function fetchSession(): Promise<SessionResponse> {
  return send<SessionResponse>("/api/auth/session");
}

export function switchOrganisation(organisationId: string): Promise<{ ok: true; organisationId: string; role: Role }> {
  return send("/api/auth/switch-organisation", {
    method: "POST",
    body: JSON.stringify({ organisationId }),
  });
}

export function requestPasswordReset(email: string): Promise<{ ok: true; sent: boolean; devResetUrl?: string }> {
  return send("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
}

export function resetPassword(token: string, password: string): Promise<{ ok: true }> {
  return send("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
}

export function verifyEmail(token: string): Promise<{ ok: true }> {
  return send("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) });
}

export function resendVerification(): Promise<{ ok: true; devVerificationUrl?: string }> {
  return send("/api/auth/resend-verification", { method: "POST" });
}

/* ------------------------------------------------------------------ */
/* Session / device management                                         */
/* ------------------------------------------------------------------ */

export interface SessionDevice {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export function listSessions(): Promise<{ ok: true; sessions: SessionDevice[] }> {
  return send("/api/auth/sessions");
}

export function revokeSession(id: string): Promise<{ ok: true }> {
  return send(`/api/auth/sessions/${id}`, { method: "DELETE" });
}

export function revokeAllOtherSessions(): Promise<{ ok: true; revoked: number }> {
  return send("/api/auth/sessions", { method: "DELETE" });
}

/* ------------------------------------------------------------------ */
/* MFA management                                                      */
/* ------------------------------------------------------------------ */

export function mfaSetup(): Promise<{ ok: true; otpauthUrl: string; secretOnce: string; instructions: string }> {
  return send("/api/auth/mfa/setup", { method: "POST" });
}

export function mfaEnable(secret: string, code: string): Promise<{ ok: true; enabled: true }> {
  return send("/api/auth/mfa/enable", { method: "POST", body: JSON.stringify({ secret, code }) });
}

export function mfaDisable(password: string, code: string): Promise<{ ok: true; enabled: false }> {
  return send("/api/auth/mfa/disable", { method: "POST", body: JSON.stringify({ password, code }) });
}

/* ------------------------------------------------------------------ */
/* Organisation administration                                         */
/* ------------------------------------------------------------------ */

export interface OrgMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  lastLoginAt: string | null;
  joinedAt: string;
}

export function listMembers(): Promise<{ ok: true; members: OrgMember[] }> {
  return send("/api/org/members");
}

export function changeMemberRole(membershipId: string, role: Role): Promise<{ ok: true }> {
  return send(`/api/org/members/${membershipId}`, { method: "PATCH", body: JSON.stringify({ role }) });
}

export function removeMember(membershipId: string): Promise<{ ok: true }> {
  return send(`/api/org/members/${membershipId}`, { method: "DELETE" });
}

export interface OrgInvitation {
  id: string;
  email: string;
  role: Role;
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
}

export function listInvitations(): Promise<{ ok: true; invitations: OrgInvitation[] }> {
  return send("/api/org/invitations");
}

export function createInvitation(email: string, role: Role): Promise<{ ok: true; invitation: { id: string; email: string; role: Role }; devUrl?: string }> {
  return send("/api/org/invitations", { method: "POST", body: JSON.stringify({ email, role }) });
}

export function revokeInvitation(id: string): Promise<{ ok: true }> {
  return send(`/api/org/invitations/${id}/revoke`, { method: "POST" });
}

export function acceptInvitation(token: string): Promise<{ ok: true; organisation: { id: string; name: string }; role: Role }> {
  return send("/api/auth/accept-invitation", { method: "POST", body: JSON.stringify({ token }) });
}

/** Fired by the shared business-API layer on any 401 so AuthGate can react. */
export const UNAUTHORIZED_EVENT = "razorshield:unauthorized";
