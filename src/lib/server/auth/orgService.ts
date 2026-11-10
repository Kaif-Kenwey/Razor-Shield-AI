/**
 * RazorShield AI — organisation (tenant) service: profiles, membership
 * administration, invitations and switching. All functions require a
 * verified AuthContext; permission checks are re-stated here so service
 * callers cannot bypass them.
 */

import { db } from "@/lib/db";
import {
  assignableRoles,
  hasPermission,
  isRole,
  type Role,
} from "@/lib/rbac";
import { sendMail } from "@/lib/server/mailer";
import { writeAudit } from "@/lib/server/ledger";
import { newToken, tokenFingerprint } from "./tokens";
import type { AuthContext } from "./context";

export type OrgResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string; extra?: Record<string, unknown> };

function ok<T>(value: T): OrgResult<T> {
  return { ok: true, value };
}
function fail<T = never>(status: number, error: string, extra?: Record<string, unknown>): OrgResult<T> {
  return { ok: false, status, error, extra };
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export async function getOrganisationProfile(ctx: AuthContext) {
  if (!ctx.organisationId) return null;
  const org = await db.organisation.findUnique({
    where: { id: ctx.organisationId },
    include: { _count: { select: { memberships: true, transactions: true, datasets: true } } },
  });
  if (!org) return null;
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    createdAt: org.createdAt.toISOString(),
    counts: { members: org._count.memberships, transactions: org._count.transactions, datasets: org._count.datasets },
  };
}

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

export async function listMembers(ctx: AuthContext) {
  if (!ctx.organisationId || !hasPermission(ctx.role, "org:members:read")) {
    return fail(403, 'Your role does not grant "org:members:read" in this organisation.');
  }
  const members = await db.membership.findMany({
    where: { organisationId: ctx.organisationId },
    include: { user: { select: { id: true, email: true, name: true, lastLoginAt: true } } },
    orderBy: { createdAt: "asc" },
  });
  return ok({
    members: members.map((m) => ({
      membershipId: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
      joinedAt: m.createdAt.toISOString(),
    })),
  });
}

export async function changeMemberRole(
  ctx: AuthContext,
  membershipId: string,
  nextRoleRaw: string,
): Promise<OrgResult<{ changed: true }>> {
  if (!ctx.organisationId || !hasPermission(ctx.role, "org:members:manage")) {
    return fail(403, 'Your role does not grant "org:members:manage" in this organisation.');
  }
  if (!isRole(nextRoleRaw)) return fail(400, "Unknown role.");

  const target = await db.membership.findUnique({
    where: { id: membershipId },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!target || target.organisationId !== ctx.organisationId) {
    return fail(404, "Member not found in this organisation.");
  }

  const assignable = assignableRoles(ctx.role as Role);
  if (!assignable.includes(nextRoleRaw)) {
    return fail(403, `Your role cannot assign the role "${nextRoleRaw}".`);
  }

  /* Last-owner protection: an organisation must always keep at least one OWNER. */
  if (target.role === "OWNER" && nextRoleRaw !== "OWNER") {
    const owners = await db.membership.count({ where: { organisationId: ctx.organisationId, role: "OWNER" } });
    if (owners <= 1) return fail(409, "Cannot demote the last owner of the organisation.");
  }

  await db.membership.update({ where: { id: target.id }, data: { role: nextRoleRaw } });
  await writeAudit({
    organisationId: ctx.organisationId,
    actor: "ANALYST",
    actorType: "HUMAN",
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    action: "MEMBER_ROLE_CHANGED",
    entityType: "Membership",
    entityId: target.id,
    detail: { user: target.user.email, from: target.role, to: nextRoleRaw },
  });
  return ok({ changed: true });
}

export async function removeMember(ctx: AuthContext, membershipId: string): Promise<OrgResult<{ removed: true }>> {
  if (!ctx.organisationId || !hasPermission(ctx.role, "org:members:manage")) {
    return fail(403, 'Your role does not grant "org:members:manage" in this organisation.');
  }
  const target = await db.membership.findUnique({
    where: { id: membershipId },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!target || target.organisationId !== ctx.organisationId) {
    return fail(404, "Member not found in this organisation.");
  }
  if (target.role === "OWNER") {
    const owners = await db.membership.count({ where: { organisationId: ctx.organisationId, role: "OWNER" } });
    if (owners <= 1) return fail(409, "Cannot remove the last owner of the organisation.");
  }
  await db.membership.delete({ where: { id: target.id } });
  await writeAudit({
    organisationId: ctx.organisationId,
    actor: "ANALYST",
    actorType: "HUMAN",
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    action: "MEMBER_REMOVED",
    entityType: "Membership",
    entityId: target.id,
    detail: { user: target.user.email, role: target.role },
  });
  return ok({ removed: true });
}

/* ------------------------------------------------------------------ */
/* Invitations                                                         */
/* ------------------------------------------------------------------ */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createInvitation(
  ctx: AuthContext,
  emailRaw: string,
  roleRaw: string,
): Promise<OrgResult<{ invitationId: string; email: string; role: Role; devUrl: string | null }>> {
  if (!ctx.organisationId || !hasPermission(ctx.role, "org:invitations:manage")) {
    return fail(403, 'Your role does not grant "org:invitations:manage" in this organisation.');
  }
  const email = (emailRaw ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return fail(400, "A valid email address is required.");
  if (!isRole(roleRaw)) return fail(400, "Unknown role.");
  const assignable = assignableRoles(ctx.role as Role);
  if (!assignable.includes(roleRaw)) return fail(403, `Your role cannot invite with the role "${roleRaw}".`);

  const existingMember = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existingMember) {
    const alreadyMember = await db.membership.findUnique({
      where: { organisationId_userId: { organisationId: ctx.organisationId, userId: existingMember.id } },
    });
    if (alreadyMember) return fail(409, "This user is already a member of the organisation.");
  }

  const pending = await db.invitation.findFirst({
    where: { organisationId: ctx.organisationId, email, revokedAt: null, acceptedAt: null, expiresAt: { gt: new Date() } },
  });
  if (pending) return fail(409, "An invitation is already pending for this email.");

  const token = newToken();
  const invite = await db.invitation.create({
    data: {
      organisationId: ctx.organisationId,
      email,
      role: roleRaw,
      tokenHash: tokenFingerprint(token),
      invitedById: ctx.user.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });

  const org = await db.organisation.findUnique({ where: { id: ctx.organisationId }, select: { name: true } });
  const url = `/accept-invitation?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: email,
    subject: `You're invited to ${org?.name ?? "an organisation"} on RazorShield AI`,
    body: `You have been invited as ${roleRaw}. Accept your invitation:\n${url}\n\nThe link expires in 7 days.`,
    actionUrl: url,
  });

  await writeAudit({
    organisationId: ctx.organisationId,
    actor: "ANALYST",
    actorType: "HUMAN",
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    action: "MEMBER_INVITED",
    entityType: "Invitation",
    entityId: invite.id,
    detail: { email, role: roleRaw },
  });

  return ok({ invitationId: invite.id, email, role: roleRaw, devUrl: process.env.NODE_ENV === "production" ? null : url });
}

export async function listInvitations(ctx: AuthContext) {
  if (!ctx.organisationId || !hasPermission(ctx.role, "org:invitations:manage")) {
    return fail(403, 'Your role does not grant "org:invitations:manage" in this organisation.');
  }
  const invites = await db.invitation.findMany({
    where: { organisationId: ctx.organisationId, revokedAt: null, acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    include: { invitedBy: { select: { name: true } } },
    take: 100,
  });
  return ok({
    invitations: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      invitedBy: i.invitedBy?.name ?? null,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    })),
  });
}

export async function revokeInvitation(ctx: AuthContext, invitationId: string): Promise<OrgResult<{ revoked: true }>> {
  if (!ctx.organisationId || !hasPermission(ctx.role, "org:invitations:manage")) {
    return fail(403, 'Your role does not grant "org:invitations:manage" in this organisation.');
  }
  const invite = await db.invitation.findUnique({ where: { id: invitationId } });
  if (!invite || invite.organisationId !== ctx.organisationId) return fail(404, "Invitation not found.");
  await db.invitation.update({ where: { id: invite.id }, data: { revokedAt: new Date() } });
  await writeAudit({
    organisationId: ctx.organisationId,
    actor: "ANALYST",
    actorType: "HUMAN",
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    action: "MEMBER_INVITATION_REVOKED",
    entityType: "Invitation",
    entityId: invite.id,
    detail: { email: invite.email },
  });
  return ok({ revoked: true });
}

/** Accepts an invitation for the signed-in user (email must match). */
export async function acceptInvitation(ctx: AuthContext, token: string): Promise<OrgResult<{ organisationId: string; organisationName: string; role: Role }>> {
  const invite = await db.invitation.findUnique({
    where: { tokenHash: tokenFingerprint(token) },
    include: { organisation: { select: { id: true, name: true } } },
  });
  if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) {
    return fail(400, "This invitation is invalid, expired, or already used.");
  }
  if (invite.email !== ctx.user.email.toLowerCase()) {
    return fail(403, "This invitation was issued to a different email address. Sign in with the invited email.");
  }
  const existing = await db.membership.findUnique({
    where: { organisationId_userId: { organisationId: invite.organisationId, userId: ctx.user.id } },
  });
  if (existing) return fail(409, "You are already a member of this organisation.");

  await db.membership.create({
    data: { organisationId: invite.organisationId, userId: ctx.user.id, role: invite.role },
  });
  await db.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
  await writeAudit({
    organisationId: invite.organisationId,
    actor: "ANALYST",
    actorType: "HUMAN",
    actorUserId: ctx.user.id,
    actorName: ctx.user.name,
    action: "MEMBER_JOINED",
    entityType: "Invitation",
    entityId: invite.id,
    detail: { role: invite.role },
  });
  return ok({
    organisationId: invite.organisationId,
    organisationName: invite.organisation.name,
    role: invite.role as Role,
  });
}

/* ------------------------------------------------------------------ */
/* Switching                                                           */
/* ------------------------------------------------------------------ */

/** Validates the caller's membership and returns the org to activate. */
export async function resolveSwitchTarget(ctx: AuthContext, organisationId: string) {
  const membership = ctx.memberships.find((m) => m.organisationId === organisationId);
  if (!membership) return null;
  return membership;
}
