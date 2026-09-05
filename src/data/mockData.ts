/**
 * RazorShield AI — mock data layer.
 *
 * Everything the UI renders comes from these structures. They are shaped
 * exactly like the future backend responses so `services/api.ts` can swap
 * mocks for live endpoints without touching a single component.
 *
 * All values are DEMO DATA for the Razorpay AI Buildathon 2026 demo.
 * No real Razorpay data is used or implied.
 */

import type {
  AppNotification,
  AuditEntry,
  Customer,
  Investigation,
  ModelPerformance,
  RiskLevel,
  RiskSignal,
  RiskMetric,
  SignalType,
  SystemService,
  TimelineEvent,
  Transaction,
} from "@/types";
import { riskLevelFromScore } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Deterministic RNG so demo runs are reproducible                     */
/* ------------------------------------------------------------------ */

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

const rand = mulberry32(20260214);

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

export function idFromSeed(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, "0").slice(0, 6);
}

/* ------------------------------------------------------------------ */
/* Reference pools                                                     */
/* ------------------------------------------------------------------ */

export const CITIES = [
  "Mumbai",
  "Bengaluru",
  "Delhi",
  "Hyderabad",
  "Chennai",
  "Pune",
  "Kolkata",
  "Jaipur",
  "Ahmedabad",
  "Surat",
  "Lucknow",
  "Goa",
] as const;

export const PAYMENT_METHODS = [
  "UPI",
  "Credit Card",
  "Debit Card",
  "Netbanking",
  "Wallet",
] as const;

export const MERCHANTS = [
  "SwiftCart",
  "KiranaMart",
  "ElectroHub",
  "Nimbus Travel",
  "MetroFoods",
  "CloudHost Pro",
  "UrbanRides",
  "MedPlus Pharmacy",
  "GameZone Top-ups",
  "FashionBazaar",
  "QuickLicense",
  "SkyFare Bookings",
] as const;

export const DEVICES = [
  "iPhone 15 · Safari",
  "Pixel 8 · Chrome",
  "MacBook Pro · Chrome",
  "Windows PC · Edge",
  "Redmi Note 13 · Chrome",
  "iPad Air · Safari",
  "Samsung S23 · Chrome",
] as const;

/* ------------------------------------------------------------------ */
/* Signal library                                                      */
/* ------------------------------------------------------------------ */

type SignalTemplate = Omit<RiskSignal, "id"> & { build: (txnSeed: string) => RiskSignal };

/** Clone a library template into a plain signal (strips the build fn). */
function instantiate(type: SignalType, id: string): RiskSignal {
  const { build: _build, ...base } = SIGNAL_LIBRARY[type];
  return { id, ...base, facts: base.facts.map((f) => ({ ...f })) };
}

const SIGNAL_LIBRARY: Record<SignalType, SignalTemplate> = {
  METHOD_MISMATCH: {
    type: "METHOD_MISMATCH",
    title: "Payment Method Switch",
    evidence: "Paid via a rail this customer has never used before.",
    severity: "MEDIUM",
    impact: 12,
    facts: [
      { label: "This txn", value: "Set per transaction" },
      { label: "Usual rail", value: "From customer history" },
    ],
    build: (s) => instantiate("METHOD_MISMATCH", `sig_${s}_mm`),
  },
  STRUCTURING: {
    type: "STRUCTURING",
    title: "Threshold-Hugging Amount",
    evidence: "Amount sits just under a common review threshold.",
    severity: "HIGH",
    impact: 18,
    facts: [
      { label: "Amount", value: "Set per transaction" },
      { label: "Pattern", value: "just-under-threshold" },
    ],
    build: (s) => instantiate("STRUCTURING", `sig_${s}_st`),
  },
  NEW_DEVICE: {
    type: "NEW_DEVICE",
    title: "New Device",
    evidence: "Device has never been associated with this customer.",
    severity: "HIGH",
    impact: 24,
    facts: [
      { label: "Device", value: "Chrome 128 · Windows 11" },
      { label: "First seen", value: "At transaction time" },
      { label: "Known devices", value: "iPhone 15 · Chrome (2 yrs)" },
    ],
    build: (s) => instantiate("NEW_DEVICE", `sig_${s}_nd`),
  },
  UNUSUAL_AMOUNT: {
    type: "UNUSUAL_AMOUNT",
    title: "Unusual Amount",
    evidence: "Transaction is significantly higher than the customer's typical transaction.",
    severity: "HIGH",
    impact: 26,
    facts: [
      { label: "Amount", value: "Set per transaction" },
      { label: "Basis", value: "90-day customer average" },
    ],
    build: (s) => instantiate("UNUSUAL_AMOUNT", `sig_${s}_ua`),
  },
  LOCATION_ANOMALY: {
    type: "LOCATION_ANOMALY",
    title: "Location Anomaly",
    evidence: "Transaction originates from a location inconsistent with recent activity.",
    severity: "HIGH",
    impact: 22,
    facts: [
      { label: "Origin", value: "Set per transaction" },
      { label: "Usual region", value: "Set per customer" },
    ],
    build: (s) => instantiate("LOCATION_ANOMALY", `sig_${s}_la`),
  },
  VELOCITY_SPIKE: {
    type: "VELOCITY_SPIKE",
    title: "Velocity Spike",
    evidence: "A short burst of transactions was detected in a narrow time window.",
    severity: "CRITICAL",
    impact: 20,
    facts: [
      { label: "Burst", value: "5 transactions / 3 min" },
      { label: "Customer baseline", value: "2.1 transactions / hour" },
    ],
    build: (s) => instantiate("VELOCITY_SPIKE", `sig_${s}_vs`),
  },
  IMPOSSIBLE_TRAVEL: {
    type: "IMPOSSIBLE_TRAVEL",
    title: "Impossible Travel",
    evidence: "Successive transactions imply physical travel faster than commercially possible.",
    severity: "HIGH",
    impact: 23,
    facts: [
      { label: "Gap", value: "42 min between regions" },
      { label: "Implied speed", value: "940 km/h" },
    ],
    build: (s) => instantiate("IMPOSSIBLE_TRAVEL", `sig_${s}_it`),
  },
  HIGH_VALUE: {
    type: "HIGH_VALUE",
    title: "High Value Transfer",
    evidence: "Amount crosses the elevated-value monitoring threshold for this payment method.",
    severity: "MEDIUM",
    impact: 15,
    facts: [
      { label: "Threshold", value: "₹1,00,000 (card)" },
      { label: "Policy", value: "RZS-POL-014" },
    ],
    build: (s) => instantiate("HIGH_VALUE", `sig_${s}_hv`),
  },
  MERCHANT_RISK: {
    type: "MERCHANT_RISK",
    title: "Merchant Risk Cluster",
    evidence: "Merchant category shows an elevated chargeback rate in the last 7 days.",
    severity: "MEDIUM",
    impact: 14,
    facts: [
      { label: "Category", value: "Digital goods / top-ups" },
      { label: "7-day chargebacks", value: "2.8% (category avg 0.4%)" },
    ],
    build: (s) => instantiate("MERCHANT_RISK", `sig_${s}_mr`),
  },
  TIME_ANOMALY: {
    type: "TIME_ANOMALY",
    title: "Time-of-Day Anomaly",
    evidence: "Transaction occurs far outside the customer's historical activity window.",
    severity: "MEDIUM",
    impact: 12,
    facts: [
      { label: "Local time", value: "03:12 IST" },
      { label: "Usual window", value: "08:00 – 23:00 IST" },
    ],
    build: (s) => instantiate("TIME_ANOMALY", `sig_${s}_ta`),
  },
};

export function makeSignals(types: SignalType[], seed: string): RiskSignal[] {
  return types.map((t) => SIGNAL_LIBRARY[t].build(seed));
}

/* ------------------------------------------------------------------ */
/* Investigation builder — reusable for any transaction                */
/* ------------------------------------------------------------------ */

export function buildTimeline(txn: Transaction, baseIso: string): TimelineEvent[] {
  const base = new Date(baseIso);
  const at = (offsetSec: number) =>
    new Date(base.getTime() + offsetSec * 1000).toLocaleTimeString("en-GB", { hour12: false });

  const events: TimelineEvent[] = [
    { id: `${txn.id}-t1`, time: at(0), label: "Transaction initiated", kind: "info" },
    {
      id: `${txn.id}-t2`,
      time: at(1),
      label: "Device fingerprint evaluated",
      detail: txn.isNewDevice ? "Unrecognized device" : "Known device",
      kind: txn.isNewDevice ? "warn" : "info",
    },
    {
      id: `${txn.id}-t3`,
      time: at(2),
      label: "Location checked against recent activity",
      kind: "info",
    },
    {
      id: `${txn.id}-t4`,
      time: at(3),
      label: "Velocity rule evaluated",
      detail: "Window: 3 minutes",
      kind: "info",
    },
    {
      id: `${txn.id}-t5`,
      time: at(4),
      label: "ML risk score calculated",
      detail: `Score ${txn.riskScore}/100`,
      kind: "model",
    },
  ];

  if (txn.riskLevel === "HIGH" || txn.riskLevel === "CRITICAL") {
    events.push({
      id: `${txn.id}-t6`,
      time: at(5),
      label: "AI investigation started",
      detail: "Correlating customer, device and location evidence",
      kind: "ai",
    });
    events.push({
      id: `${txn.id}-t7`,
      time: at(6),
      label: "Recommendation generated",
      detail: txn.recommendation ? `${txn.recommendation} · confidence ${txn.confidence}%` : undefined,
      kind: "ai",
    });
  }

  return events;
}

export function buildAuditTrail(txn: Transaction, baseIso: string): AuditEntry[] {
  const base = new Date(baseIso);
  const at = (offsetSec: number) =>
    new Date(base.getTime() + offsetSec * 1000).toLocaleTimeString("en-GB", { hour12: false });

  const trail: AuditEntry[] = [
    { time: at(0), actor: "SYSTEM", action: "Transaction received", detail: `${txn.paymentMethod} · ${txn.merchant}` },
    { time: at(4), actor: "RISK MODEL", action: `Risk score generated (${txn.riskScore}/100)`, detail: `Level: ${txn.riskLevel}` },
  ];

  if (txn.riskLevel === "HIGH" || txn.riskLevel === "CRITICAL") {
    trail.push(
      { time: at(5), actor: "AI ENGINE", action: "AI investigation initiated" },
      { time: at(6), actor: "AI ENGINE", action: "Recommendation generated", detail: txn.recommendation ?? undefined },
    );
  }

  return trail;
}

export function buildInvestigation(txn: Transaction, baseIso: string): Investigation {
  const highRisk = txn.riskLevel === "HIGH" || txn.riskLevel === "CRITICAL";
  const evidenceUsed = [
    "Customer transaction history",
    "Device history",
    "Location history",
    "Transaction velocity",
    "ML risk score",
  ];

  const signalNames = txn.signals.map((s) => s.title.toLowerCase()).join(", ");
  const reasoning = highRisk
    ? txn.aiSummary ??
      `Multiple independent risk signals converge on abnormal behavior: ${signalNames}. The combination is inconsistent with this customer's established pattern, so a bounded action is recommended pending analyst confirmation.`
    : "Transaction is consistent with the customer's historical behavior. No independent risk signals converged, so no bounded action is required.";

  return {
    transactionId: txn.id,
    status: "COMPLETE",
    timeline: buildTimeline(txn, baseIso),
    auditTrail: buildAuditTrail(txn, baseIso),
    evidenceUsed,
    reasoning,
  };
}

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

export const CUSTOMERS: Record<string, Customer> = {
  CUS_10482: {
    id: "CUS_10482",
    name: "Ananya Deshmukh",
    kycTier: "FULL KYC",
    accountAge: "2 years 4 months",
    avgTransaction: 7540,
    transactionCount: 184,
    previousIncidents: 2,
    usualLocation: "Bengaluru",
    usualDevice: "iPhone · Chrome",
    lastSeen: "Bengaluru · 2h ago",
    history: [
      { label: "Feb 01", amount: 4200, riskScore: 8 },
      { label: "Feb 03", amount: 12800, riskScore: 14 },
      { label: "Feb 05", amount: 6100, riskScore: 6 },
      { label: "Feb 07", amount: 9400, riskScore: 11 },
      { label: "Feb 09", amount: 3300, riskScore: 4 },
      { label: "Feb 11", amount: 15200, riskScore: 18 },
      { label: "Feb 12", amount: 7100, riskScore: 9 },
      { label: "Feb 13", amount: 5800, riskScore: 7 },
      { label: "Feb 13", amount: 11200, riskScore: 16 },
      { label: "Feb 14", amount: 8600, riskScore: 10 },
      { label: "Feb 14", amount: 6400, riskScore: 8 },
      { label: "Feb 14", amount: 48500, riskScore: 92, flagged: true },
    ],
  },
  CUS_22087: {
    id: "CUS_22087",
    name: "Rohan Iyer",
    kycTier: "FULL KYC",
    accountAge: "11 months",
    avgTransaction: 9800,
    transactionCount: 63,
    previousIncidents: 0,
    usualLocation: "Pune",
    usualDevice: "Pixel 8 · Chrome",
    lastSeen: "Pune · 41m ago",
    history: [
      { label: "Feb 08", amount: 7400, riskScore: 9 },
      { label: "Feb 09", amount: 11200, riskScore: 12 },
      { label: "Feb 11", amount: 8900, riskScore: 10 },
      { label: "Feb 13", amount: 15600, riskScore: 22 },
      { label: "Feb 14", amount: 184000, riskScore: 81, flagged: true },
    ],
  },
  CUS_31904: {
    id: "CUS_31904",
    name: "Kavya Nair",
    kycTier: "MIN KYC",
    accountAge: "3 years 1 month",
    avgTransaction: 1150,
    transactionCount: 412,
    previousIncidents: 1,
    usualLocation: "Chennai",
    usualDevice: "Redmi Note 13 · Chrome",
    lastSeen: "Chennai · 14m ago",
    history: [
      { label: "Feb 12", amount: 890, riskScore: 6 },
      { label: "Feb 13", amount: 1499, riskScore: 12 },
      { label: "Feb 14", amount: 990, riskScore: 8 },
      { label: "Feb 14", amount: 2400, riskScore: 31 },
      { label: "Feb 14", amount: 12400, riskScore: 73, flagged: true },
    ],
  },
  CUS_41230: {
    id: "CUS_41230",
    name: "Arjun Bhatia",
    kycTier: "FULL KYC",
    accountAge: "4 years 2 months",
    avgTransaction: 6200,
    transactionCount: 327,
    previousIncidents: 0,
    usualLocation: "Delhi",
    usualDevice: "MacBook Pro · Chrome",
    lastSeen: "Delhi · 1h ago",
    history: [
      { label: "Feb 10", amount: 5400, riskScore: 5 },
      { label: "Feb 11", amount: 7800, riskScore: 9 },
      { label: "Feb 12", amount: 4900, riskScore: 4 },
      { label: "Feb 13", amount: 9200, riskScore: 11 },
      { label: "Feb 14", amount: 31200, riskScore: 58, flagged: true },
    ],
  },
};

const customerCache = new Map<string, Customer>();

function seedFrom(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic per-customer profile — same input always yields the same customer. */
export function customerFor(txn: Transaction): Customer {
  const cached = customerCache.get(txn.customerId);
  if (cached) return cached;
  const seededRand = mulberry32(seedFrom(txn.customerId));
  const built: Customer = (
    CUSTOMERS[txn.customerId] ?? {
      id: txn.customerId,
      name: txn.customerName,
      kycTier: "FULL KYC",
      accountAge: "1 year 6 months",
      avgTransaction: Math.max(800, Math.round(txn.amount / 5)),
      transactionCount: 90 + Math.floor(seededRand() * 200),
      previousIncidents: 0,
      usualLocation: txn.location,
      usualDevice: txn.isNewDevice ? "iPhone · Chrome" : txn.device,
      lastSeen: `${txn.location} · recently`,
      history: [
        ...Array.from({ length: 8 }, (_, i) => ({
          label: `W-${8 - i}`,
          amount: Math.max(500, Math.round((txn.amount / 6) * (0.4 + seededRand()))),
          riskScore: Math.max(3, Math.round(txn.riskScore * 0.2 + seededRand() * 10)),
        })),
        { label: "Now", amount: txn.amount, riskScore: txn.riskScore, flagged: txn.riskLevel === "CRITICAL" || txn.riskLevel === "HIGH" },
      ],
    }
  );
  customerCache.set(txn.customerId, built);
  return built;
}

/* ------------------------------------------------------------------ */
/* Flagship case — TXN_8F21A9                                          */
/* ------------------------------------------------------------------ */

const NOW = Date.now();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

export const FLAGSHIP_TXN_ID = "TXN_8F21A9";

const flagship: Transaction = {
  id: "TXN_8F21A9",
  amount: 48500,
  customerId: "CUS_10482",
  customerName: "Ananya Deshmukh",
  merchant: "QuickLicense",
  location: "Mumbai",
  device: "Windows PC · Edge",
  isNewDevice: true,
  paymentMethod: "Credit Card",
  riskScore: 92,
  riskLevel: "CRITICAL",
  status: "INVESTIGATING",
  timestamp: minutesAgo(7),
  currency: "INR",
  signals: [
    {
      id: "sig_8f21a9_1",
      type: "NEW_DEVICE",
      title: "New Device",
      evidence: "Device has never been associated with this customer.",
      severity: "HIGH",
      impact: 24,
      facts: [
        { label: "Device", value: "Chrome 128 · Windows 11" },
        { label: "First seen", value: "At transaction time" },
        { label: "Known devices", value: "iPhone · Chrome (2 yrs)" },
      ],
    },
    {
      id: "sig_8f21a9_2",
      type: "UNUSUAL_AMOUNT",
      title: "Unusual Amount",
      evidence: "Transaction is 6.4× higher than customer's typical transaction.",
      severity: "HIGH",
      impact: 26,
      facts: [
        { label: "Amount", value: "₹48,500" },
        { label: "Customer average", value: "₹7,540" },
        { label: "Deviation", value: "6.4× · 99.2nd percentile" },
      ],
    },
    {
      id: "sig_8f21a9_3",
      type: "LOCATION_ANOMALY",
      title: "Location Anomaly",
      evidence: "Transaction originates from a location inconsistent with recent activity.",
      severity: "HIGH",
      impact: 22,
      facts: [
        { label: "Origin", value: "Mumbai, IN" },
        { label: "Usual region", value: "Bengaluru, IN" },
        { label: "Distance", value: "843 km" },
        { label: "Recent login", value: "Bengaluru · 2h ago" },
      ],
    },
    {
      id: "sig_8f21a9_4",
      type: "VELOCITY_SPIKE",
      title: "Velocity Spike",
      evidence: "5 transactions detected within 3 minutes.",
      severity: "CRITICAL",
      impact: 20,
      facts: [
        { label: "Burst", value: "5 transactions / 3 min" },
        { label: "Window", value: "14:29 – 14:32 IST" },
        { label: "Customer baseline", value: "2.1 / hour" },
      ],
    },
  ],
  aiSummary:
    "This transaction is significantly outside the customer's historical behavior. The amount is 6.4× above their average transaction value, the device has not previously been associated with the account, and the transaction originates from an unusual location. A short burst of transactions was also detected.",
  recommendation: "BLOCK",
  confidence: 94,
};

flagship.investigation = buildInvestigation(flagship, flagship.timestamp);

/* Additional hand-crafted cases ------------------------------------ */

const caseA: Transaction = {
  id: "TXN_3C77E2",
  amount: 184000,
  customerId: "CUS_22087",
  customerName: "Rohan Iyer",
  merchant: "SkyFare Bookings",
  location: "Guwahati",
  device: "iPad Air · Safari",
  isNewDevice: true,
  paymentMethod: "Credit Card",
  riskScore: 81,
  riskLevel: "HIGH",
  status: "INVESTIGATING",
  timestamp: minutesAgo(23),
  currency: "INR",
  signals: [
    { ...SIGNAL_LIBRARY.IMPOSSIBLE_TRAVEL.build("3c77e2"), facts: [
      { label: "Last activity", value: "Pune · 41 min ago" },
      { label: "Current origin", value: "Guwahati, IN" },
      { label: "Implied speed", value: "940 km/h" },
    ] },
    { ...SIGNAL_LIBRARY.HIGH_VALUE.build("3c77e2"), facts: [
      { label: "Amount", value: "₹1,84,000" },
      { label: "Threshold", value: "₹1,00,000 (card)" },
      { label: "Policy", value: "RZS-POL-014" },
    ] },
    { ...SIGNAL_LIBRARY.NEW_DEVICE.build("3c77e2"), facts: [
      { label: "Device", value: "iPad Air · Safari" },
      { label: "Known devices", value: "Pixel 8 · Chrome" },
      { label: "First seen", value: "At transaction time" },
    ] },
  ],
  aiSummary:
    "Card-not-present transaction of ₹1,84,000 from a new device in Guwahati, 41 minutes after confirmed activity in Pune — physically implausible travel. The amount is 18.8× the customer's average and crosses the elevated-value policy threshold. Recommendation: BLOCK pending verification.",
  recommendation: "BLOCK",
  confidence: 91,
};
caseA.investigation = buildInvestigation(caseA, caseA.timestamp);

const caseB: Transaction = {
  id: "TXN_9B04D1",
  amount: 12400,
  customerId: "CUS_31904",
  customerName: "Kavya Nair",
  merchant: "GameZone Top-ups",
  location: "Chennai",
  device: "Redmi Note 13 · Chrome",
  isNewDevice: false,
  paymentMethod: "Wallet",
  riskScore: 73,
  riskLevel: "HIGH",
  status: "UNDER_REVIEW",
  timestamp: minutesAgo(38),
  currency: "INR",
  signals: [
    { ...SIGNAL_LIBRARY.VELOCITY_SPIKE.build("9b04d1"), facts: [
      { label: "Burst", value: "7 transactions / 4 min" },
      { label: "Customer baseline", value: "1.4 / hour" },
      { label: "Merchant", value: "GameZone Top-ups" },
    ] },
    { ...SIGNAL_LIBRARY.UNUSUAL_AMOUNT.build("9b04d1"), facts: [
      { label: "Amount", value: "₹12,400" },
      { label: "Customer average", value: "₹1,150" },
      { label: "Deviation", value: "10.8×" },
    ] },
    { ...SIGNAL_LIBRARY.MERCHANT_RISK.build("9b04d1"), facts: [
      { label: "Category", value: "Digital goods / top-ups" },
      { label: "7-day chargebacks", value: "2.8% (avg 0.4%)" },
    ] },
  ],
  aiSummary:
    "Rapid burst of 7 wallet top-ups totalling ₹12,400 in 4 minutes — 10.8× the customer's average transaction. Merchant category shows elevated chargeback rates this week. Pattern is consistent with account-takeover drain attempts. Recommendation: REVIEW with a temporary spend hold.",
  recommendation: "REVIEW",
  confidence: 87,
};
caseB.investigation = buildInvestigation(caseB, caseB.timestamp);

const caseC: Transaction = {
  id: "TXN_5D18F7",
  amount: 31200,
  customerId: "CUS_41230",
  customerName: "Arjun Bhatia",
  merchant: "ElectroHub",
  location: "Delhi",
  device: "Windows PC · Chrome",
  isNewDevice: false,
  paymentMethod: "Netbanking",
  riskScore: 58,
  riskLevel: "MEDIUM",
  status: "UNDER_REVIEW",
  timestamp: minutesAgo(64),
  currency: "INR",
  signals: [
    { ...SIGNAL_LIBRARY.UNUSUAL_AMOUNT.build("5d18f7"), facts: [
      { label: "Amount", value: "₹31,200" },
      { label: "Customer average", value: "₹6,200" },
      { label: "Deviation", value: "5.0× · 97th percentile" },
    ] },
    { ...SIGNAL_LIBRARY.TIME_ANOMALY.build("5d18f7"), facts: [
      { label: "Local time", value: "03:12 IST" },
      { label: "Usual window", value: "08:00 – 23:00 IST" },
    ] },
  ],
  aiSummary:
    "Netbanking payment of ₹31,200 at 03:12 IST — 5× the customer's average and far outside their normal activity window. Device and location are familiar, so account takeover is less likely; possible first-party anomaly. Recommendation: REVIEW before settlement.",
  recommendation: "REVIEW",
  confidence: 78,
};
caseC.investigation = buildInvestigation(caseC, caseC.timestamp);

/* ------------------------------------------------------------------ */
/* Generated background traffic                                        */
/* ------------------------------------------------------------------ */

const STATUS_POOL: Transaction["status"][] = [
  "MONITORING", "MONITORING", "MONITORING", "MONITORING", "MONITORING",
  "MONITORING", "MONITORING", "INVESTIGATING", "MONITORING",
  "UNDER_REVIEW", "MONITORING", "BLOCKED", "MONITORING", "MONITORING",
];

function generatePool(count: number): Transaction[] {
  const txns: Transaction[] = [];
  for (let i = 0; i < count; i++) {
    const roll = rand();
    const score =
      roll < 0.62 ? Math.round(4 + rand() * 26)
      : roll < 0.86 ? Math.round(35 + rand() * 28)
      : roll < 0.96 ? Math.round(63 + rand() * 20)
      : Math.round(85 + rand() * 13);
    const level: RiskLevel = riskLevelFromScore(score);
    const location = pick(CITIES);
    const method = pick(PAYMENT_METHODS);
    const merchant = pick(MERCHANTS);
    const isNewDevice = level === "HIGH" || level === "CRITICAL" ? rand() < 0.7 : rand() < 0.12;
    const customerId = `CUS_${10000 + Math.floor(rand() * 89999)}`;
    const amount =
      level === "LOW" ? Math.round(300 + rand() * 6500)
      : level === "MEDIUM" ? Math.round(6000 + rand() * 26000)
      : Math.round(15000 + rand() * 120000);

    const signalTypes: SignalType[] = [];
    if (isNewDevice) signalTypes.push("NEW_DEVICE");
    if (level !== "LOW" && rand() < 0.75) signalTypes.push("UNUSUAL_AMOUNT");
    if (level !== "LOW" && rand() < 0.6) signalTypes.push("LOCATION_ANOMALY");
    if (level === "HIGH" || level === "CRITICAL") signalTypes.push("VELOCITY_SPIKE");
    if (amount >= 100000 && (method === "Credit Card" || method === "Netbanking")) signalTypes.push("HIGH_VALUE");
    if (merchant === "GameZone Top-ups" && rand() < 0.8) signalTypes.push("MERCHANT_RISK");
    if (rand() < 0.25) signalTypes.push("TIME_ANOMALY");

    const txnSeed = `g${i}`;
    const status: Transaction["status"] =
      level === "CRITICAL" ? (rand() < 0.6 ? "INVESTIGATING" : "BLOCKED")
      : level === "HIGH" ? (rand() < 0.5 ? "INVESTIGATING" : "UNDER_REVIEW")
      : level === "MEDIUM" ? (rand() < 0.3 ? "UNDER_REVIEW" : "MONITORING")
      : "MONITORING";

    const txn: Transaction = {
      id: `TXN_${idFromSeed(txnSeed)}`,
      amount,
      customerId,
      customerName: pick([
        "N. Kulkarni", "S. Verma", "P. Menon", "D. Chawla", "V. Reddy",
        "A. Khan", "T. Bose", "M. Pillai", "R. Malhotra", "J. Fernandes",
      ]),
      merchant,
      location,
      device: isNewDevice ? pick(DEVICES) : "Known device",
      isNewDevice,
      paymentMethod: method,
      riskScore: score,
      riskLevel: level,
      status,
      timestamp: minutesAgo(2 + i * 7 + Math.floor(rand() * 5)),
      currency: "INR",
      signals: makeSignals(signalTypes, txnSeed),
      aiSummary: null,
      recommendation: null,
      confidence: null,
    };

    if (level === "HIGH" || level === "CRITICAL") {
      txn.aiSummary = null; // investigation not yet run for background traffic
      txn.recommendation = level === "CRITICAL" ? "BLOCK" : "REVIEW";
      txn.confidence = level === "CRITICAL" ? 88 + Math.floor(rand() * 8) : 74 + Math.floor(rand() * 12);
    }
    txns.push(txn);
  }
  return txns;
}

/* ------------------------------------------------------------------ */
/* Public dataset                                                      */
/* ------------------------------------------------------------------ */

export const INITIAL_TRANSACTIONS: Transaction[] = [
  flagship,
  caseA,
  caseB,
  caseC,
  ...generatePool(30),
].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

/* ------------------------------------------------------------------ */
/* Command-center metrics                                              */
/* ------------------------------------------------------------------ */

export const RISK_METRICS: RiskMetric[] = [
  {
    key: "analyzed",
    label: "Transactions Analyzed",
    value: 24891,
    delta: 12.4,
    deltaLabel: "vs yesterday",
    tone: "neutral",
    hint: "Total payments scored by the risk engine in the last 24h.",
  },
  {
    key: "highRisk",
    label: "High Risk",
    value: 183,
    delta: 8.1,
    deltaLabel: "vs yesterday",
    tone: "critical",
    hint: "Transactions scoring ≥ 85 requiring investigation.",
  },
  {
    key: "underReview",
    label: "Under Review",
    value: 67,
    delta: -4.2,
    deltaLabel: "vs yesterday",
    tone: "medium",
    hint: "Cases currently assigned to human analysts.",
  },
  {
    key: "blocked",
    label: "Blocked",
    value: 41,
    delta: 2.9,
    deltaLabel: "vs yesterday",
    tone: "high",
    hint: "Transactions blocked in the last 24h after investigation.",
  },
];

/** 24h rolling trend per metric (2-hour buckets) — powers metric-card sparklines. */
export const METRIC_SPARKS: Record<string, number[]> = {
  analyzed: [612, 648, 704, 682, 731, 815, 902, 968, 1010, 976, 1042, 1098],
  highRisk: [4, 5, 4, 7, 6, 9, 11, 10, 14, 12, 17, 15],
  underReview: [9, 8, 10, 7, 8, 6, 7, 5, 6, 5, 4, 4],
  blocked: [1, 2, 1, 2, 3, 2, 4, 3, 5, 4, 6, 5],
};

/* ------------------------------------------------------------------ */
/* Risk intelligence chart datasets                                    */
/* ------------------------------------------------------------------ */

export const RISK_DISTRIBUTION = [
  { level: "Low", count: 21354, tone: "#34d399" },
  { level: "Medium", count: 2923, tone: "#fbbf24" },
  { level: "High", count: 431, tone: "#fb7185" },
  { level: "Critical", count: 183, tone: "#f87171" },
];

export const SCORE_HISTOGRAM = [
  { bucket: "0–10", count: 6420 },
  { bucket: "10–20", count: 5210 },
  { bucket: "20–30", count: 3980 },
  { bucket: "30–40", count: 2870 },
  { bucket: "40–50", count: 2110 },
  { bucket: "50–60", count: 1640 },
  { bucket: "60–70", count: 1080 },
  { bucket: "70–80", count: 760 },
  { bucket: "80–90", count: 470 },
  { bucket: "90–100", count: 183 },
];

export const TRANSACTIONS_BY_HOUR = Array.from({ length: 24 }, (_, h) => {
  const dayCurve = Math.round(360 + 640 * Math.exp(-Math.pow(h - 13, 2) / 46) + 320 * Math.exp(-Math.pow(h - 20, 2) / 12));
  const night = h <= 5 ? 1.6 : 1;
  const total = Math.round((h >= 1 && h <= 5 ? 180 + rand() * 90 : dayCurve) * night);
  const highRisk = Math.max(1, Math.round(total * (h >= 1 && h <= 5 ? 0.028 : 0.0074)));
  return { hour: `${String(h).padStart(2, "0")}:00`, transactions: total, highRisk };
});

export const RISK_BY_LOCATION = [
  { city: "Mumbai", total: 4820, high: 41 },
  { city: "Bengaluru", total: 4310, high: 28 },
  { city: "Delhi", total: 3960, high: 33 },
  { city: "Hyderabad", total: 2870, high: 19 },
  { city: "Chennai", total: 2440, high: 17 },
  { city: "Pune", total: 2180, high: 12 },
  { city: "Kolkata", total: 1930, high: 14 },
  { city: "Jaipur", total: 1120, high: 11 },
];

export const RISK_BY_PAYMENT_METHOD = [
  { method: "UPI", total: 14820, high: 61 },
  { method: "Credit Card", total: 5912, high: 52 },
  { method: "Debit Card", total: 2204, high: 24 },
  { method: "Netbanking", total: 1284, high: 31 },
  { method: "Wallet", total: 671, high: 15 },
];

export const TOP_RISK_SIGNALS = [
  { signal: "New Device", count: 412, weight: 24 },
  { signal: "Location Anomaly", count: 351, weight: 22 },
  { signal: "Velocity Spike", count: 287, weight: 20 },
  { signal: "Unusual Amount", count: 265, weight: 26 },
  { signal: "Impossible Travel", count: 154, weight: 23 },
  { signal: "Merchant Risk", count: 96, weight: 14 },
];

export const VELOCITY_TREND = [
  { t: "T-55m", rate: 118 }, { t: "T-50m", rate: 124 }, { t: "T-45m", rate: 131 },
  { t: "T-40m", rate: 127 }, { t: "T-35m", rate: 142 }, { t: "T-30m", rate: 156 },
  { t: "T-25m", rate: 149 }, { t: "T-20m", rate: 168 }, { t: "T-15m", rate: 181 },
  { t: "T-10m", rate: 174 }, { t: "T-5m", rate: 193 }, { t: "Now", rate: 187 },
];

/* ------------------------------------------------------------------ */
/* Model performance — DEMO SNAPSHOT (clearly labelled in the UI)      */
/* ------------------------------------------------------------------ */

export const MODEL_PERFORMANCE: ModelPerformance = {
  modelVersion: "rse-1.2",
  trainedAt: "2026-01-28",
  trainingDataset: "rz-fraud-historic-2025Q4 · 18.2M labelled transactions",
  evaluationDataset: "rz-fraud-holdout-2026Jan · 24,891 transactions (demo)",
  isDemoSnapshot: true,
  precision: 91.4,
  recall: 87.8,
  f1: 89.6,
  rocAuc: 94.1,
  confusionMatrix: {
    truePositives: 1284,
    falsePositives: 121,
    falseNegatives: 178,
    trueNegatives: 23308,
    totalEvaluated: 24891,
  },
  costAssumptions: {
    falsePositiveCostPerCase: 210,
    falseNegativeCostPerCase: 8900,
    currency: "INR",
  },
  threshold: 85,
  note: "Demo snapshot — replace with backend evaluation metrics when available.",
};

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export const NOTIFICATIONS: AppNotification[] = [
  {
    id: "n1",
    title: "CRITICAL · TXN_8F21A9",
    body: "₹48,500 from new device + location anomaly. AI recommends BLOCK.",
    time: minutesAgo(7),
    tone: "critical",
    transactionId: "TXN_8F21A9",
    read: false,
  },
  {
    id: "n2",
    title: "HIGH · TXN_3C77E2",
    body: "Impossible travel: Pune → Guwahati in 41 min. ₹1,84,000.",
    time: minutesAgo(23),
    tone: "high",
    transactionId: "TXN_3C77E2",
    read: false,
  },
  {
    id: "n3",
    title: "HIGH · TXN_9B04D1",
    body: "Velocity burst on wallet top-ups. Moved to review queue.",
    time: minutesAgo(38),
    tone: "high",
    transactionId: "TXN_9B04D1",
    read: true,
  },
  {
    id: "n4",
    title: "Model rse-1.2 deployed",
    body: "Risk engine reloaded with threshold 85. No downtime.",
    time: minutesAgo(121),
    tone: "intel",
    read: true,
  },
];

/* ------------------------------------------------------------------ */
/* System services                                                     */
/* ------------------------------------------------------------------ */

export const SYSTEM_SERVICES: SystemService[] = [
  { id: "engine", name: "Risk Engine", status: "operational", latencyMs: 12, uptimeP30d: "99.99%", detail: "Streaming scorer · threshold 85" },
  { id: "ai", name: "AI Investigator", status: "operational", latencyMs: 340, uptimeP30d: "99.95%", detail: "Evidence correlation + recommendation" },
  { id: "features", name: "Feature Store", status: "operational", latencyMs: 8, uptimeP30d: "100%", detail: "Customer · device · location features" },
  { id: "events", name: "Event Stream", status: "operational", latencyMs: 21, uptimeP30d: "99.97%", detail: "Real-time payment ingestion" },
  { id: "cases", name: "Case Store", status: "operational", latencyMs: 9, uptimeP30d: "100%", detail: "Investigations + audit trail" },
];

/* ------------------------------------------------------------------ */
/* Demo mode — deterministic arrival script (cycles forever)           */
/* ------------------------------------------------------------------ */

export interface DemoArrival {
  amount: number;
  merchant: string;
  location: string;
  device: string;
  isNewDevice: boolean;
  method: (typeof PAYMENT_METHODS)[number];
  finalScore: number;
  signals: SignalType[];
  customerName: string;
}

/**
 * Deterministic 8-step script. Every cycle produces:
 * routine → routine → ESCALATING CRITICAL → routine → HIGH → routine → CRITICAL → routine
 * so the Buildathon demo always shows at least two investigation-worthy
 * arrivals per cycle, in a predictable order.
 */
export const DEMO_ARRIVALS_SCRIPT: DemoArrival[] = [
  { amount: 1480, merchant: "KiranaMart", location: "Bengaluru", device: "Known device", isNewDevice: false, method: "UPI", finalScore: 14, signals: [], customerName: "S. Verma" },
  { amount: 8600, merchant: "MetroFoods", location: "Pune", device: "Known device", isNewDevice: false, method: "Credit Card", finalScore: 38, signals: ["TIME_ANOMALY"], customerName: "D. Chawla" },
  { amount: 66200, merchant: "ElectroHub", location: "Jaipur", device: "Chrome 128 · Windows 11", isNewDevice: true, method: "Credit Card", finalScore: 93, signals: ["NEW_DEVICE", "UNUSUAL_AMOUNT", "LOCATION_ANOMALY", "VELOCITY_SPIKE"], customerName: "V. Reddy" },
  { amount: 2750, merchant: "UrbanRides", location: "Mumbai", device: "Known device", isNewDevice: false, method: "Wallet", finalScore: 9, signals: [], customerName: "T. Bose" },
  { amount: 74800, merchant: "Nimbus Travel", location: "Goa", device: "iPad Air · Safari", isNewDevice: true, method: "Netbanking", finalScore: 71, signals: ["NEW_DEVICE", "UNUSUAL_AMOUNT"], customerName: "M. Pillai" },
  { amount: 1240, merchant: "MedPlus Pharmacy", location: "Chennai", device: "Known device", isNewDevice: false, method: "UPI", finalScore: 21, signals: [], customerName: "A. Khan" },
  { amount: 152400, merchant: "SkyFare Bookings", location: "Lucknow", device: "Windows PC · Edge", isNewDevice: true, method: "Credit Card", finalScore: 95, signals: ["NEW_DEVICE", "IMPOSSIBLE_TRAVEL", "HIGH_VALUE", "VELOCITY_SPIKE"], customerName: "R. Malhotra" },
  { amount: 5320, merchant: "FashionBazaar", location: "Hyderabad", device: "Known device", isNewDevice: false, method: "Debit Card", finalScore: 44, signals: ["UNUSUAL_AMOUNT"], customerName: "J. Fernandes" },
];

/* ------------------------------------------------------------------ */
/* Similar past cases — precedent library for investigations           */
/* ------------------------------------------------------------------ */

export type CaseOutcome =
  | "FRAUD_CONFIRMED"
  | "LEGITIMATE"
  | "CUSTOMER_VERIFIED"
  | "CHARGEBACK_FILED";

export interface SimilarCase {
  id: string;
  /** Display label for when the case was closed. */
  closedLabel: string;
  merchant: string;
  location: string;
  amount: number;
  score: number;
  level: RiskLevel;
  signals: SignalType[];
  /** Bounded action the analyst took on the past case. */
  action: "ALLOW" | "REVIEW" | "HOLD" | "BLOCK";
  outcome: CaseOutcome;
  /** Analyst-facing one-liner of how the case ended. */
  outcomeLabel: string;
}

/**
 * Closed cases from the (demo) investigation archive. Used by the
 * investigation workspace to show the analyst comparable precedents for
 * the case at hand — mirroring a future GET /cases/similar endpoint.
 */
export const SIMILAR_CASES: SimilarCase[] = [
  {
    id: "TXN_7A19K2", closedLabel: "12 Jan", merchant: "QuickLicense", location: "Mumbai",
    amount: 52300, score: 94, level: "CRITICAL",
    signals: ["NEW_DEVICE", "UNUSUAL_AMOUNT", "LOCATION_ANOMALY"],
    action: "BLOCK", outcome: "FRAUD_CONFIRMED",
    outcomeLabel: "Card-not-present fraud confirmed; amount reversed to customer.",
  },
  {
    id: "TXN_5E40Q8", closedLabel: "9 Jan", merchant: "ElectroHub", location: "Hyderabad",
    amount: 61150, score: 89, level: "CRITICAL",
    signals: ["NEW_DEVICE", "UNUSUAL_AMOUNT", "VELOCITY_SPIKE"],
    action: "BLOCK", outcome: "FRAUD_CONFIRMED",
    outcomeLabel: "Device + burst pattern matched a stolen-credential ring.",
  },
  {
    id: "TXN_9C27D6", closedLabel: "5 Jan", merchant: "SkyFare Bookings", location: "Pune",
    amount: 192000, score: 91, level: "CRITICAL",
    signals: ["IMPOSSIBLE_TRAVEL", "HIGH_VALUE", "NEW_DEVICE"],
    action: "BLOCK", outcome: "CHARGEBACK_FILED",
    outcomeLabel: "Account-takeover sequence; linked to 3 other cases.",
  },
  {
    id: "TXN_2B63M4", closedLabel: "7 Jan", merchant: "Nimbus Travel", location: "Guwahati",
    amount: 18900, score: 76, level: "HIGH",
    signals: ["LOCATION_ANOMALY", "NEW_DEVICE"],
    action: "REVIEW", outcome: "CUSTOMER_VERIFIED",
    outcomeLabel: "Customer confirmed travel; device registered, case closed.",
  },
  {
    id: "TXN_8C14P3", closedLabel: "11 Dec", merchant: "FashionBazaar", location: "Kolkata",
    amount: 12650, score: 67, level: "HIGH",
    signals: ["NEW_DEVICE", "TIME_ANOMALY"],
    action: "REVIEW", outcome: "CUSTOMER_VERIFIED",
    outcomeLabel: "New laptop first login; step-up authentication passed.",
  },
  {
    id: "TXN_6F35L9", closedLabel: "22 Dec", merchant: "PayZen Wallet", location: "Jaipur",
    amount: 23700, score: 72, level: "HIGH",
    signals: ["VELOCITY_SPIKE", "MERCHANT_RISK"],
    action: "HOLD", outcome: "CHARGEBACK_FILED",
    outcomeLabel: "Top-up burst held in time; merchant later blacklisted.",
  },
  {
    id: "TXN_3A92N7", closedLabel: "18 Dec", merchant: "JewelsIndia", location: "Surat",
    amount: 44000, score: 83, level: "HIGH",
    signals: ["UNUSUAL_AMOUNT", "HIGH_VALUE", "LOCATION_ANOMALY"],
    action: "REVIEW", outcome: "LEGITIMATE",
    outcomeLabel: "Salary-month gold purchase; KYC call confirmed intent.",
  },
  {
    id: "TXN_4D81F1", closedLabel: "28 Dec", merchant: "MetroFoods", location: "Chennai",
    amount: 8420, score: 58, level: "MEDIUM",
    signals: ["UNUSUAL_AMOUNT", "TIME_ANOMALY"],
    action: "ALLOW", outcome: "LEGITIMATE",
    outcomeLabel: "Late-night order verified; logged as false positive.",
  },
  {
    id: "TXN_1E77R5", closedLabel: "3 Dec", merchant: "VendorPay", location: "Nagpur",
    amount: 96800, score: 88, level: "CRITICAL",
    signals: ["UNUSUAL_AMOUNT", "HIGH_VALUE", "VELOCITY_SPIKE"],
    action: "BLOCK", outcome: "FRAUD_CONFIRMED",
    outcomeLabel: "Business-email-compromise payout; stopped before settlement.",
  },
];

export interface ScoredSimilarCase extends SimilarCase {
  similarity: number;
  sharedSignals: SignalType[];
}

/**
 * Deterministically match a transaction against the precedent archive.
 * Similarity = shared signal coverage over the union of both signal sets.
 * Returns the top 3 precedents that share at least one signal.
 */
export function similarCasesFor(txn: Transaction): ScoredSimilarCase[] {
  const txnTypes = new Set(txn.signals.map((s) => s.type));
  if (txnTypes.size === 0) return [];

  return SIMILAR_CASES.map((c) => {
    const shared = c.signals.filter((s) => txnTypes.has(s));
    const union = new Set([...c.signals, ...txnTypes]);
    return { ...c, sharedSignals: shared, similarity: Math.round((shared.length / union.size) * 100) };
  })
    .filter((c) => c.sharedSignals.length > 0)
    .sort((a, b) => b.similarity - a.similarity || b.score - a.score)
    .slice(0, 3);
}

/* ------------------------------------------------------------------ */
/* Analyst roster — case handoff / assignment                          */
/* ------------------------------------------------------------------ */

export interface Analyst {
  id: string;
  name: string;
  initials: string;
  level: string;
  role: string;
}

export const CURRENT_ANALYST_ID = "RK";

export const ANALYSTS: Analyst[] = [
  { id: "RK", name: "R. Khan", initials: "RK", level: "L2", role: "Risk analyst · you" },
  { id: "SI", name: "S. Iyer", initials: "SI", level: "L1", role: "Payments ops" },
  { id: "MC", name: "M. Chopra", initials: "MC", level: "L2", role: "Risk analyst" },
  { id: "AD", name: "A. Das", initials: "AD", level: "L3", role: "Fraud lead" },
];

/**
 * Deterministic per-analyst open-case trend — 12 five-minute windows,
 * oldest → newest. Rendered as a sparkline in the digest workload rows.
 * Purely synthetic demo data (labelled as such in the digest footnote).
 */
export const ANALYST_LOAD_HISTORY: Record<string, number[]> = {
  RK: [3, 4, 4, 5, 6, 5, 7, 8, 7, 6, 7, 8],
  SI: [2, 2, 3, 2, 3, 4, 4, 3, 3, 4, 5, 4],
  MC: [5, 5, 4, 6, 6, 7, 6, 5, 6, 6, 5, 6],
  AD: [1, 2, 1, 1, 2, 2, 1, 2, 2, 1, 1, 2],
};
