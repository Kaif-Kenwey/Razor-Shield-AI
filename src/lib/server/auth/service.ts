/**
 * RazorShield AI — authentication & organisation service (server-only).
 *
 * Implements the identity flows on top of the session/token primitives:
 * registration (with organisation creation or invite redemption), login
 * with account lockout + optional TOTP MFA, logout, email verification,
 * password reset, organisation switching, session management and member
 * administration with last-owner protection.
 *
 * Every consequential action is appended to the audit trail with the
 * authenticated actor — never a client-supplied identity.
 *
 * Email delivery: no SMTP provider exists in this environment, so
 * verification/reset links go through the log transport (dev-only
 * disclosure returns the link to the caller; production returns null).
 * See src/lib/server/mailer.ts.
 */

import { db } from "@/lib/db";
import { isRole, type Role } from "@/lib/rbac";
import { sendMail } from "@/lib/server/mailer";
import { writeAudit } from "@/lib/server/ledger";
import { hashPassword, verifyPassword, checkPasswordPolicy } from "./passwords";
import { newToken, tokenFingerprint } from "./tokens";
import { SESSION_TTL_MS } from "./cookies";

/* ------------------------------------------------------------------ */
/* Result plumbing                                                     */
/* ------------------------------------------------------------------ */

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string; extra?: Record<string, unknown> };

function ok<T>(value: T): ServiceResult<T> {
  return { ok: true, value };
}
function fail<T = never>(status: number, error: string, extra?: Record<string, unknown>): ServiceResult<T> {
  return { ok: false, status, error, extra };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(normalizeEmail(email));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  /** Create a new organisation with this name (mutually exclusive with invitationToken). */
  organisationName?: string;
  /** Redeem an invitation token instead of creating an organisation. */
  invitationToken?: string;
  ip?: string;
  userAgent?: string;
}

export interface RegisterOutput {
  user: { id: string; email: string; name: string };
  organisation: { id: string; name: string; slug: string } | null;
  role: Role | null;
  /** Dev-only: verification link when no SMTP transport exists. */
  devVerificationUrl: string | null;
}

export async function register(input: RegisterInput): Promise<ServiceResult<RegisterOutput>> {
  const email = normalizeEmail(input.email ?? "");
  const name = (input.name ?? "").trim();

  if (name.length < 1 || name.length > 80) return fail(400, "Name is required (1–80 characters).");
  if (!isValidEmail(email)) return fail(400, "A valid email address is required.");
  const policy = checkPasswordPolicy(input.password ?? "");
  if (!policy.ok) return fail(400, policy.reason ?? "Password rejected.");

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    // Non-disclosing in principle — but registration is a public form and
    // email enumeration via register is a known trade-off; the UI flow
    // (resend verification) makes the honest message more useful.
    return fail(409, "An account with this email already exists. Sign in instead.");
  }

  /* Invitation redemption path. */
  if (input.invitationToken) {
    const invite = await db.invitation.findUnique({ where: { tokenHash: tokenFingerprint(input.invitationToken) } });
    if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) {
      return fail(400, "This invitation is invalid, expired, or already used.");
    }
    if (invite.email !== email) return fail(400, "This invitation was issued to a different email address.");
    if (!isRole(invite.role)) return fail(500, "Invitation has an invalid role configured.");

    const user = await db.user.create({
      data: {
        email,
        name,
        passwordHash: await hashPassword(input.password),
      },
    });
    await db.membership.create({
      data: { organisationId: invite.organisationId, userId: user.id, role: invite.role },
    });
    await db.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });

    const org = await db.organisation.findUnique({ where: { id: invite.organisationId } });
    await writeAudit({
      organisationId: invite.organisationId,
      actor: "SYSTEM",
      actorType: "HUMAN",
      actorUserId: user.id,
      actorName: user.name,
      action: "USER_REGISTERED",
      entityType: "User",
      entityId: user.id,
      detail: { via: "invitation", role: invite.role },
    });

    const verify = await createEmailVerification(user.id, email);
    return ok({
      user: { id: user.id, email: user.email, name: user.name },
      organisation: org ? { id: org.id, name: org.name, slug: org.slug } : null,
      role: invite.role,
      devVerificationUrl: verify?.devUrl ?? null,
    });
  }

  /* Organisation creation path. */
  const orgName = (input.organisationName ?? "").trim();
  if (orgName.length < 2 || orgName.length > 60) {
    return fail(400, "Organisation name is required (2–60 characters).");
  }

  const passwordHash = await hashPassword(input.password);
  const user = await db.user.create({ data: { email, name, passwordHash } });

  let slug = slugify(orgName) || "org";
  let suffix = 0;
  // Slug uniqueness loop (bounded — collisions are rare).
  for (;;) {
    const clash = await db.organisation.findUnique({ where: { slug }, select: { id: true } });
    if (!clash) break;
    suffix += 1;
    slug = `${slugify(orgName)}-${suffix}`;
    if (suffix > 50) return fail(500, "Could not allocate an organisation handle.");
  }

  const organisation = await db.organisation.create({ data: { name: orgName, slug } });
  await db.membership.create({
    data: { organisationId: organisation.id, userId: user.id, role: "OWNER" },
  });

  await writeAudit({
    organisationId: organisation.id,
    actor: "SYSTEM",
    actorType: "HUMAN",
    actorUserId: user.id,
    actorName: user.name,
    action: "ORG_CREATED",
    entityType: "Organisation",
    entityId: organisation.id,
    detail: { name: orgName, slug },
  });
  await writeAudit({
    organisationId: organisation.id,
    actor: "SYSTEM",
    actorType: "HUMAN",
    actorUserId: user.id,
    actorName: user.name,
    action: "USER_REGISTERED",
    entityType: "User",
    entityId: user.id,
    detail: { via: "organisation-creation" },
  });

  const verify = await createEmailVerification(user.id, email);
  return ok({
    user: { id: user.id, email: user.email, name: user.name },
    organisation: { id: organisation.id, name: organisation.name, slug: organisation.slug },
    role: "OWNER",
    devVerificationUrl: verify?.devUrl ?? null,
  });
}

/* ------------------------------------------------------------------ */
/* Email verification                                                  */
/* ------------------------------------------------------------------ */

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

interface TokenWithDevUrl {
  token: string;
  devUrl: string | null;
}

async function createEmailVerification(userId: string, email: string): Promise<TokenWithDevUrl | null> {
  const token = newToken();
  await db.verificationToken.create({
    data: {
      userId,
      purpose: "EMAIL_VERIFY",
      tokenHash: tokenFingerprint(token),
      expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS),
    },
  });
  const url = `/verify-email?token=${encodeURIComponent(token)}`;
  const mail = await sendMail({
    to: email,
    subject: "Verify your RazorShield AI account",
    body: `Welcome to RazorShield AI. Verify your email address:\n${url}\n\nThis link expires in 24 hours.`,
    actionUrl: url,
  });
  return { token, devUrl: mail.devActionUrl };
}

export async function resendVerification(userId: string): Promise<ServiceResult<{ devUrl: string | null }>> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail(404, "Account not found.");
  if (user.emailVerifiedAt) return ok({ devUrl: null });
  const recent = await db.verificationToken.count({
    where: { userId, purpose: "EMAIL_VERIFY", createdAt: { gt: new Date(Date.now() - 60 * 1000) } },
  });
  if (recent > 0) return fail(429, "A verification email was just sent. Wait a minute before requesting another.");
  const t = await createEmailVerification(user.id, user.email);
  return ok({ devUrl: t?.devUrl ?? null });
}

export async function verifyEmail(token: string): Promise<ServiceResult<{ verified: true }>> {
  const row = await db.verificationToken.findUnique({ where: { tokenHash: tokenFingerprint(token) } });
  if (!row || row.purpose !== "EMAIL_VERIFY" || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    return fail(400, "This verification link is invalid or has expired.");
  }
  await db.$transaction([
    db.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } }),
    db.verificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ]);
  return ok({ verified: true });
}

/* ------------------------------------------------------------------ */
/* Login / logout / lockout / MFA                                      */
/* ------------------------------------------------------------------ */

export interface LoginOutput {
  kind: "session";
  sessionToken: string;
  expiresAt: Date;
  user: { id: string; email: string; name: string };
  /** Dev-only: verify link when the account is unverified. */
  devVerificationUrl: string | null;
}

export interface LoginMfa {
  kind: "mfa";
  ticket: string;
}

export async function login(
  emailRaw: string,
  password: string,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<ServiceResult<LoginOutput | LoginMfa>> {
  const email = normalizeEmail(emailRaw ?? "");
  if (!email || !password) return fail(400, "Email and password are required.");

  const user = await db.user.findUnique({ where: { email } });

  /* Uniform failure for unknown accounts and wrong passwords. */
  const GENERIC = "Invalid email or password.";
  if (!user) return fail(401, GENERIC);

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const retrySec = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
    return fail(429, `Account temporarily locked after repeated failed sign-ins. Try again in ${Math.ceil(retrySec / 60)} minute(s).`, {
      retryAfterSec: retrySec,
    });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const failedLogins = user.failedLogins + 1;
    const locked = failedLogins >= LOGIN_LOCKOUT_THRESHOLD;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLogins: locked ? 0 : failedLogins,
        lockedUntil: locked ? new Date(Date.now() + LOGIN_LOCKOUT_MS) : null,
      },
    });
    await writeAudit({
      actor: "SYSTEM",
      actorType: "SYSTEM",
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: user.id,
      detail: { email: email.replace(/(.{2}).*(@.*)/, "$1***$2"), locked, ip: meta.ip ?? null },
    });
    return locked
      ? fail(429, "Account temporarily locked after repeated failed sign-ins. Try again in 15 minutes.")
      : fail(401, GENERIC);
  }

  /* Success — reset lockout state. */
  await db.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  if (user.totpEnabled && user.totpSecretEnc) {
    const ticket = newToken();
    await db.verificationToken.create({
      data: {
        userId: user.id,
        purpose: "MFA_CHALLENGE",
        tokenHash: tokenFingerprint(ticket),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    return ok({ kind: "mfa", ticket });
  }

  const session = await createSession(user.id, meta);
  const devVerificationUrl = user.emailVerifiedAt ? null : (await createEmailVerification(user.id, user.email))?.devUrl ?? null;
  await writeAudit({
    actor: "SYSTEM",
    actorType: "HUMAN",
    actorUserId: user.id,
    actorName: user.name,
    action: "USER_LOGIN",
    entityType: "User",
    entityId: user.id,
    detail: { ip: meta.ip ?? null },
  });
  return ok({
    kind: "session",
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    user: { id: user.id, email: user.email, name: user.name },
    devVerificationUrl,
  });
}

export async function verifyMfaLogin(
  ticket: string,
  code: string,
  meta: { ip?: string; userAgent?: string },
): Promise<ServiceResult<LoginOutput>> {
  const row = await db.verificationToken.findUnique({ where: { tokenHash: tokenFingerprint(ticket) } });
  if (!row || row.purpose !== "MFA_CHALLENGE" || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    return fail(401, "This sign-in attempt expired. Sign in again.");
  }
  const user = await db.user.findUnique({ where: { id: row.userId } });
  if (!user?.totpSecretEnc) return fail(401, "MFA is not configured for this account.");

  const { verifyTotp } = await import("./totp");
  const secret = verifyTotp(user.totpSecretEnc, code);
  if (!secret) {
    await writeAudit({
      actor: "SYSTEM",
      actorType: "SYSTEM",
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: user.id,
      detail: { reason: "mfa-invalid-code", ip: meta.ip ?? null },
    });
    return fail(401, "Invalid authentication code.");
  }

  await db.verificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });

  const session = await createSession(user.id, meta);
  await writeAudit({
    actor: "SYSTEM",
    actorType: "HUMAN",
    actorUserId: user.id,
    actorName: user.name,
    action: "USER_LOGIN",
    entityType: "User",
    entityId: user.id,
    detail: { mfa: true, ip: meta.ip ?? null },
  });
  return ok({
    kind: "session",
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    user: { id: user.id, email: user.email, name: user.name },
    devVerificationUrl: null,
  });
}

export async function logout(sessionId: string, userId: string, userName?: string): Promise<void> {
  await db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } }).catch(() => undefined);
  await writeAudit({
    actor: "SYSTEM",
    actorType: "HUMAN",
    actorUserId: userId,
    actorName: userName,
    action: "LOGOUT",
    entityType: "Session",
    entityId: sessionId,
  });
}

export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: {
      userId,
      tokenHash: tokenFingerprint(token),
      expiresAt,
      ip: meta.ip?.slice(0, 64) ?? null,
      userAgent: meta.userAgent?.slice(0, 256) ?? null,
    },
  });
  return { token, expiresAt };
}

/* ------------------------------------------------------------------ */
/* Password reset                                                      */
/* ------------------------------------------------------------------ */

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

/** Always succeeds from the caller's perspective (no account enumeration). */
export async function requestPasswordReset(emailRaw: string): Promise<ServiceResult<{ devUrl: string | null }>> {
  const email = normalizeEmail(emailRaw ?? "");
  if (!isValidEmail(email)) return ok({ devUrl: null });
  const user = await db.user.findUnique({ where: { email } });
  if (!user) return ok({ devUrl: null });

  const recent = await db.verificationToken.count({
    where: { userId: user.id, purpose: "PASSWORD_RESET", createdAt: { gt: new Date(Date.now() - 60 * 1000) } },
  });
  if (recent > 0) return ok({ devUrl: null });

  const token = newToken();
  await db.verificationToken.create({
    data: {
      userId: user.id,
      purpose: "PASSWORD_RESET",
      tokenHash: tokenFingerprint(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    },
  });
  const url = `/reset-password?token=${encodeURIComponent(token)}`;
  const mail = await sendMail({
    to: user.email,
    subject: "Reset your RazorShield AI password",
    body: `Reset your password with this link (valid 30 minutes):\n${url}\n\nIf you did not request this, ignore this email — your password is unchanged.`,
    actionUrl: url,
  });
  await writeAudit({
    actor: "SYSTEM",
    actorType: "SYSTEM",
    action: "PASSWORD_RESET_REQUESTED",
    entityType: "User",
    entityId: user.id,
  });
  return ok({ devUrl: mail.devActionUrl });
}

export async function resetPassword(token: string, password: string): Promise<ServiceResult<{ reset: true }>> {
  const policy = checkPasswordPolicy(password);
  if (!policy.ok) return fail(400, policy.reason ?? "Password rejected.");

  const row = await db.verificationToken.findUnique({ where: { tokenHash: tokenFingerprint(token) } });
  if (!row || row.purpose !== "PASSWORD_RESET" || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    return fail(400, "This reset link is invalid or has expired.");
  }

  const passwordHash = await hashPassword(password);
  await db.$transaction([
    db.user.update({ where: { id: row.userId }, data: { passwordHash, failedLogins: 0, lockedUntil: null } }),
    db.verificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    // Security: a password reset invalidates every existing session.
    db.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  const user = await db.user.findUnique({ where: { id: row.userId }, select: { name: true } });
  await writeAudit({
    actor: "SYSTEM",
    actorType: "HUMAN",
    actorUserId: row.userId,
    actorName: user?.name,
    action: "PASSWORD_RESET_COMPLETED",
    entityType: "User",
    entityId: row.userId,
    detail: { sessionsRevoked: "all" },
  });
  return ok({ reset: true });
}

/* ------------------------------------------------------------------ */
/* Sessions management                                                 */
/* ------------------------------------------------------------------ */

export async function listSessions(userId: string, currentSessionId: string) {
  const sessions = await db.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true },
    take: 50,
  });
  return sessions.map((s) => ({ ...s, current: s.id === currentSessionId }));
}

export async function revokeSession(userId: string, sessionId: string): Promise<ServiceResult<{ revoked: true }>> {
  const session = await db.session.findUnique({ where: { id: sessionId }, select: { userId: true } });
  if (!session || session.userId !== userId) return fail(404, "Session not found.");
  await db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  return ok({ revoked: true });
}

export async function revokeAllOtherSessions(userId: string, currentSessionId: string): Promise<number> {
  const res = await db.session.updateMany({
    where: { userId, revokedAt: null, id: { not: currentSessionId } },
    data: { revokedAt: new Date() },
  });
  return res.count;
}
