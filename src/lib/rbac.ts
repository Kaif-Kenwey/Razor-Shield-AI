/**
 * RazorShield AI — Role-Based Access Control matrix.
 *
 * Pure data + pure functions, importable from BOTH client (to render
 * permission-aware UI) and server (to enforce decisions). The server is
 * the only authority: hiding a button client-side is UX, not security —
 * every API route independently re-checks permissions here.
 *
 * The role is ALWAYS derived server-side from the session's verified
 * Membership row — a client-supplied role is never trusted.
 */

export const ROLES = [
  "OWNER",
  "ADMIN",
  "FRAUD_MANAGER",
  "ANALYST",
  "INVESTIGATOR",
  "AUDITOR",
  "VIEWER",
  "BILLING_ADMIN",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  FRAUD_MANAGER: "Fraud Operations Manager",
  ANALYST: "Fraud Analyst",
  INVESTIGATOR: "Investigator",
  AUDITOR: "Auditor",
  VIEWER: "Viewer",
  BILLING_ADMIN: "Billing Administrator",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: "Full control of the organisation, members and billing.",
  ADMIN: "Manages members, integrations and configuration. Cannot delete the organisation.",
  FRAUD_MANAGER: "Runs fraud operations: policies, case assignment, evaluation.",
  ANALYST: "Investigates cases, records decisions on assigned work.",
  INVESTIGATOR: "Reads case evidence and adds notes. Cannot record final decisions.",
  AUDITOR: "Read-only access to everything, including the full audit trail.",
  VIEWER: "Read-only operational dashboards.",
  BILLING_ADMIN: "Manages subscription and billing. Read-only elsewhere.",
};

/** Every enforceable permission. Server routes must gate on these. */
export const PERMISSIONS = [
  "org:read",
  "org:manage",
  "org:members:read",
  "org:members:manage",
  "org:invitations:manage",
  "org:config:manage",
  "transactions:read",
  "transactions:write",
  "datasets:read",
  "datasets:import",
  "datasets:delete",
  "investigations:read",
  "investigations:create",
  "investigations:note",
  "investigations:decide",
  "investigations:assign",
  "audit:read",
  "network:read",
  "evaluation:read",
  "evaluation:run",
  "demo:manage",
  "billing:read",
  "billing:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL = PERMISSIONS as unknown as readonly Permission[];

/**
 * The permission matrix. Order matters for review: read each row as
 * "what this role can do". OWNER = all organisation permissions.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: ALL,
  ADMIN: [
    "org:read",
    "org:members:read",
    "org:members:manage",
    "org:invitations:manage",
    "org:config:manage",
    "transactions:read",
    "transactions:write",
    "datasets:read",
    "datasets:import",
    "datasets:delete",
    "investigations:read",
    "investigations:create",
    "investigations:note",
    "investigations:decide",
    "investigations:assign",
    "audit:read",
    "network:read",
    "evaluation:read",
    "evaluation:run",
    "demo:manage",
    "billing:read",
  ],
  FRAUD_MANAGER: [
    "org:read",
    "org:members:read",
    "transactions:read",
    "transactions:write",
    "datasets:read",
    "datasets:import",
    "investigations:read",
    "investigations:create",
    "investigations:note",
    "investigations:decide",
    "investigations:assign",
    "audit:read",
    "network:read",
    "evaluation:read",
    "evaluation:run",
    "demo:manage",
  ],
  ANALYST: [
    "org:read",
    "transactions:read",
    "transactions:write",
    "datasets:read",
    "datasets:import",
    "investigations:read",
    "investigations:create",
    "investigations:note",
    "investigations:decide",
    "network:read",
    "evaluation:read",
  ],
  INVESTIGATOR: [
    "org:read",
    "transactions:read",
    "investigations:read",
    "investigations:note",
    "network:read",
  ],
  AUDITOR: [
    "org:read",
    "org:members:read",
    "transactions:read",
    "datasets:read",
    "investigations:read",
    "audit:read",
    "network:read",
    "evaluation:read",
    "billing:read",
  ],
  VIEWER: [
    "org:read",
    "transactions:read",
    "datasets:read",
    "investigations:read",
    "network:read",
    "evaluation:read",
  ],
  BILLING_ADMIN: ["org:read", "org:members:read", "billing:read", "billing:manage"],
};

/** All permissions a role holds (O(1) via the static matrix). */
export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Server-side check — the only authoritative one. */
export function hasPermission(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** Editable roles an actor may assign, given their own role (never above own). */
export function assignableRoles(actorRole: Role): Role[] {
  if (actorRole === "OWNER") return [...ROLES];
  if (actorRole === "ADMIN") return ["FRAUD_MANAGER", "ANALYST", "INVESTIGATOR", "AUDITOR", "VIEWER", "BILLING_ADMIN"];
  return [];
}

/** Human-readable reason a permission is denied (for 403 bodies). */
export function permissionDeniedMessage(permission: Permission): string {
  return `Your role does not grant "${permission}" in this organisation.`;
}
