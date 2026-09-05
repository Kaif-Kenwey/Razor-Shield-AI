/**
 * RazorShield AI — deterministic fraud-cluster staging.
 *
 * The demo arrival stream occasionally stages a coordination burst: 3-5
 * transactions sharing a device or a merchant, arriving seconds apart.
 * Nothing here is random — composition is fully seeded per cycle, so every
 * replay of the demo produces the identical clusters at identical stream
 * positions (the stream script simply skips its tick when a burst plays).
 */

import type { SignalType, Transaction } from "@/types";
import { idFromSeed } from "@/data/mockData";

/** Which tick of the 8-step arrival script the burst replaces (index 5 = the quiet MEDIUM arrival). */
export const CLUSTER_TICK_INDEX = 5;
/** Spacing between burst members — the whole burst lands inside one 8s tick. */
export const CLUSTER_MEMBER_SPACING_MS = 2300;
/** How long the banner stays live before resolving/expiring ("2 min" monitoring window). */
export const CLUSTER_WINDOW_MS = 120_000;
/** The banner fires once this many members have landed (a 3-of-N coordinator). */
export const CLUSTER_DETECT_AFTER = 2;

export interface ClusterMemberPlan {
  id: string;
  amount: number;
  merchant: string;
  location: string;
  device: string;
  isNewDevice: boolean;
  method: Transaction["paymentMethod"];
  finalScore: number;
  signals: SignalType[];
  customerName: string;
}

export interface ClusterPlan {
  /** Cycle-scoped key — also the stream event id. */
  key: string;
  archetype: "merchant" | "device";
  members: ClusterMemberPlan[];
  memberIds: string[];
  /** Highest-risk member — the case the banner links to. */
  topTxnId: string;
  deviceCount: number;
  exposure: number;
}

/* Seeded PRNG (FNV-1a hash → mulberry32), same pattern as the mock layer. */
function seedFrom(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BURNER_NAMES = ["R. Sharma", "K. Devi", "S. Pal", "M. Rao", "P. Jain", "D. Gupta"];

/**
 * Builds the burst plan for a demo cycle. Alternates archetypes by cycle
 * parity so a pitch shows both coordination patterns: a mule ring hammering
 * one high-chargeback merchant, and one burner device spraying payments
 * across merchants. Scores descend with arrival order so the banner's
 * linked case is settled and clickable as early as possible.
 */
export function clusterPlanForCycle(cycle: number): ClusterPlan {
  const rand = mulberry32(seedFrom(`rzs-cluster-${cycle}`));
  const archetype: ClusterPlan["archetype"] = cycle % 2 === 0 ? "merchant" : "device";
  const key = `CLUSTER_${idFromSeed(`rzs-cluster-${cycle}`)}`;
  const scores = [91, 84, 78, 69]; // descending — top case arrives first
  const count = 4;

  const members: ClusterMemberPlan[] = Array.from({ length: count }, (_, i) => {
    const seed = `${key}-${i}`;
    const nameIdx = Math.floor(rand() * BURNER_NAMES.length);
    const amount =
      archetype === "merchant"
        ? Math.round(1800 + rand() * 8200) // wallet top-up drain profile
        : Math.round(14800 + rand() * 66000); // card spray profile
    return archetype === "merchant"
      ? {
          id: `TXN_${idFromSeed(seed)}`,
          amount,
          merchant: "GameZone Top-ups",
          location: i % 2 === 0 ? "Jaipur" : "Delhi",
          device: i % 2 === 0 ? "Redmi Note 13 · Chrome" : "Samsung S23 · Chrome",
          isNewDevice: true,
          method: i % 2 === 0 ? ("Wallet" as const) : ("UPI" as const),
          finalScore: scores[i],
          signals: i === 0 ? (["VELOCITY_SPIKE", "MERCHANT_RISK", "NEW_DEVICE"] as SignalType[]) : (["VELOCITY_SPIKE", "MERCHANT_RISK"] as SignalType[]),
          customerName: BURNER_NAMES[(nameIdx + i) % BURNER_NAMES.length],
        }
      : {
          id: `TXN_${idFromSeed(seed)}`,
          amount,
          merchant: ["SwiftCart", "ElectroHub", "FashionBazaar", "KiranaMart"][i],
          location: ["Mumbai", "Pune", "Surat", "Lucknow"][i],
          device: "Redmi Note 13 · Chrome",
          isNewDevice: true,
          method: "UPI" as const,
          finalScore: scores[i],
          signals: i === 0 ? (["NEW_DEVICE", "VELOCITY_SPIKE", "UNUSUAL_AMOUNT"] as SignalType[]) : (["NEW_DEVICE", "VELOCITY_SPIKE"] as SignalType[]),
          customerName: BURNER_NAMES[(nameIdx + i) % BURNER_NAMES.length],
        };
  });

  return {
    key,
    archetype,
    members,
    memberIds: members.map((m) => m.id),
    topTxnId: members[0].id,
    deviceCount: new Set(members.map((m) => m.device)).size,
    exposure: members.reduce((sum, m) => sum + m.amount, 0),
  };
}
