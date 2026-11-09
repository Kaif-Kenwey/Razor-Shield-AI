"use client";

/**
 * useFraudClusters — typed stream events for staged coordination bursts.
 *
 * A tiny ephemeral store (module-scoped, deliberately not persisted): the
 * demo arrival stream registers a cluster when its coordinator fires, the
 * live feed renders it as a banner row, and the monitoring window decides
 * its end state — resolved with an emerald "linked to case" chip when the
 * analyst opened the linked case, or silently removed otherwise.
 */

import { create } from "zustand";

export interface ClusterEvent {
  id: string;
  /** ISO instant the coordinator detected the burst. */
  detectedAt: string;
  archetype: "merchant" | "device";
  /** Stream-event summary rendered on the banner row. */
  summary: { txnCount: number; deviceCount: number; exposure: number };
  /** Member transaction ids, arrival order. */
  memberIds: string[];
  /** Highest-risk member — the case the banner opens. */
  topTxnId: string;
  /** Set once the analyst opens the linked case from the banner. */
  linkedCaseId: string | null;
  status: "active" | "resolved";
}

interface ClusterState {
  clusters: ClusterEvent[];
  registerCluster: (evt: ClusterEvent) => void;
  /** Banner clicked — pin the linked case so the resolved row keeps it. */
  linkCluster: (id: string, caseId: string) => void;
  /** Monitoring window elapsed: resolve if linked, expire otherwise. */
  closeWindow: (id: string) => void;
}

/** Keep at most this many resolved banners in the feed (older ones drop off). */
const MAX_RESOLVED = 3;

export const useClusterStore = create<ClusterState>()((set) => ({
  clusters: [],

  registerCluster: (evt) =>
    set((s) => {
      if (s.clusters.some((c) => c.id === evt.id)) return {};
      return { clusters: [evt, ...s.clusters] };
    }),

  linkCluster: (id, caseId) =>
    set((s) => ({
      clusters: s.clusters.map((c) =>
        c.id === id && !c.linkedCaseId ? { ...c, linkedCaseId: caseId } : c,
      ),
    })),

  closeWindow: (id) =>
    set((s) => {
      const cluster = s.clusters.find((c) => c.id === id);
      if (!cluster || cluster.status === "resolved") return {};
      if (!cluster.linkedCaseId) {
        // never linked — the burst passes and the banner leaves the feed
        return { clusters: s.clusters.filter((c) => c.id !== id) };
      }
      const resolved = s.clusters.map((c) =>
        c.id === id ? { ...c, status: "resolved" as const } : c,
      );
      const kept = resolved.filter((c) => c.status === "resolved").slice(0, MAX_RESOLVED);
      const keptIds = new Set(kept.map((c) => c.id));
      return {
        clusters: resolved.filter((c) => c.status === "active" || keptIds.has(c.id)),
      };
    }),
}));
