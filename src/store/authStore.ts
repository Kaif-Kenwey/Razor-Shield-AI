"use client";

/**
 * RazorShield AI — authentication state.
 *
 * The single source of truth for "who is signed in, in which
 * organisation, allowed to do what". Permissions are computed by the
 * SERVER from the verified membership and delivered read-only here —
 * the UI uses them to hide entry points, never to grant access.
 */

import { create } from "zustand";
import * as authApi from "@/services/authApi";
import type { AuthMembership, AuthUser, OrganisationProfile, Role } from "@/services/authApi";

export type AuthStatus = "loading" | "unauthenticated" | "authenticated";

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  memberships: AuthMembership[];
  organisationId: string | null;
  role: Role | null;
  permissions: string[];
  organisation: OrganisationProfile | null;
  /** Dev-only demo sign-in availability (from the boot 401 payload). */
  demoAvailable: boolean;
  /** Last error message from an auth flow (login/register/MFA). */
  error: string | null;
  busy: boolean;

  bootstrap: () => Promise<void>;
  refreshSession: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ mfa: boolean; ticket?: string; devVerificationUrl?: string }>;
  verifyMfa: (ticket: string, code: string) => Promise<void>;
  register: (input: {
    name: string;
    email: string;
    password: string;
    organisationName?: string;
    invitationToken?: string;
  }) => Promise<{ devVerificationUrl?: string }>;
  logout: () => Promise<void>;
  switchOrganisation: (organisationId: string) => Promise<void>;
  clearError: () => void;
  can: (permission: string) => boolean;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: "loading",
  user: null,
  memberships: [],
  organisationId: null,
  role: null,
  permissions: [],
  organisation: null,
  demoAvailable: false,
  error: null,
  busy: false,

  bootstrap: async () => {
    set({ status: "loading" });
    try {
      const session = await authApi.fetchSession();
      set({
        status: "authenticated",
        user: session.user,
        memberships: session.memberships,
        organisationId: session.organisationId,
        role: session.role,
        permissions: session.permissions,
        organisation: session.organisation,
        error: null,
      });
    } catch (err) {
      const payload = (err as { payload?: { demoAvailable?: boolean } }).payload;
      set({
        status: "unauthenticated",
        user: null,
        memberships: [],
        organisationId: null,
        role: null,
        permissions: [],
        organisation: null,
        demoAvailable: Boolean(payload?.demoAvailable),
      });
    }
  },

  refreshSession: async () => {
    await get().bootstrap();
  },

  login: async (email, password) => {
    set({ busy: true, error: null });
    try {
      const res = await authApi.login(email, password);
      if (res.mfaRequired && res.ticket) {
        return { mfa: true, ticket: res.ticket };
      }
      await get().refreshSession();
      return {
        mfa: false,
        devVerificationUrl: res.devVerificationUrl,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign-in failed.";
      set({ error: message });
      throw err;
    } finally {
      set({ busy: false });
    }
  },

  verifyMfa: async (ticket, code) => {
    set({ busy: true, error: null });
    try {
      await authApi.verifyMfa(ticket, code);
      await get().refreshSession();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Verification failed.";
      set({ error: message });
      throw err;
    } finally {
      set({ busy: false });
    }
  },

  register: async (input) => {
    set({ busy: true, error: null });
    try {
      const res = await authApi.register(input);
      await get().refreshSession();
      return { devVerificationUrl: res.devVerificationUrl };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Registration failed.";
      set({ error: message });
      throw err;
    } finally {
      set({ busy: false });
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
    } finally {
      set({
        status: "unauthenticated",
        user: null,
        memberships: [],
        organisationId: null,
        role: null,
        permissions: [],
        organisation: null,
        demoAvailable: false,
      });
    }
  },

  switchOrganisation: async (organisationId) => {
    await authApi.switchOrganisation(organisationId);
    await get().refreshSession();
  },

  clearError: () => set({ error: null }),

  can: (permission) => {
    const { permissions } = get();
    return permissions.includes(permission);
  },
}));

/** Initials helper for avatar chips ("Aarav Khan" → "AK"). */
export function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "RS"
  );
}
