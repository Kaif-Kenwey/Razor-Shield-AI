/**
 * RazorShield AI — synthetic demo-data generator (server-side).
 *
 * Creates clearly-labelled synthetic payments that exercise the REAL
 * engine: quiet normal traffic, one high-value alert, a velocity burst,
 * first-seen devices, an odd-hour payment, a merchant outlier and a
 * shared-burner mule ring for the fraud-graph panel. Every record lands
 * in the ledger through the same scoring service as manual imports, with
 * dataSource="demo" so it can be cleared without touching other records.
 *
 * Honesty rules baked in here:
 *   - the UI labels these as "Demo environment · synthetic payment feed";
 *   - nothing in this file pretends to be real gateway traffic.
 */

import { db } from "@/lib/db";
import { writeAudit } from "@/lib/server/ledger";
import { scoreAndPersistTransaction } from "@/lib/server/scoringService";

const CUSTOMER_POOL: { id: string; name: string; city: string; device: string; method: string }[] = [
  { id: "CUS_D01", name: "Ananya Sharma", city: "Bengaluru", device: "Pixel-7-A1", method: "UPI" },
  { id: "CUS_D02", name: "Rohan Mehta", city: "Mumbai", device: "iPhone-14-B2", method: "Credit Card" },
  { id: "CUS_D03", name: "Priya Nair", city: "Kochi", device: "Redmi-12-C3", method: "Wallet" },
  { id: "CUS_D04", name: "Kabir Singh", city: "Delhi", device: "Galaxy-S21-U5", method: "UPI" },
  { id: "CUS_D05", name: "Ishita Rao", city: "Hyderabad", device: "iPhone-13-Q7", method: "Netbanking" },
  { id: "CUS_D06", name: "Arjun Patel", city: "Ahmedabad", device: "Galaxy-M34-F2", method: "Debit Card" },
  { id: "CUS_D07", name: "Meera Iyer", city: "Chennai", device: "OnePlus-Nord-D8", method: "UPI" },
  { id: "CUS_D08", name: "Sahil Khan", city: "Lucknow", device: "Poco-C65-S9", method: "Wallet" },
];

const MERCHANTS = [
  "BigBasket", "Zomato", "Swiggy", "Croma", "Reliance Digital", "Myntra",
  "Apollo Pharmacy", "IRCTC", "BookMyShow", "Decathlon",
];

const QUIET_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

let demoSeq = 0;

function pick<T>(arr: T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)];
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nextId(): string {
  demoSeq += 1;
  return `TXN_D${Date.now().toString(36).toUpperCase().slice(-6)}${demoSeq.toString(36).toUpperCase()}`;
}

interface GenTxn {
  amount: number;
  customerId: string;
  customerName: string;
  merchant: string;
  location: string;
  device: string;
  paymentMethod: string;
  timestamp: string;
  label?: number | null;
}

/** Normal background traffic for the past `days` days. */
function normalTraffic(days: number, count: number, rnd: () => number): GenTxn[] {
  const out: GenTxn[] = [];
  for (let i = 0; i < count; i++) {
    const c = pick(CUSTOMER_POOL, rnd);
    const day = Math.floor(rnd() * days);
    const hour = pick(QUIET_HOURS, rnd);
    const ts = new Date();
    ts.setDate(ts.getDate() - day);
    ts.setHours(hour, Math.floor(rnd() * 60), Math.floor(rnd() * 60), 0);
    out.push({
      amount: Math.round(150 + rnd() * 4200),
      customerId: c.id,
      customerName: c.name,
      merchant: pick(MERCHANTS, rnd),
      location: c.city,
      device: c.device,
      paymentMethod: c.method,
      timestamp: ts.toISOString(),
      label: 0,
    });
  }
  return out;
}

/** The suspicious scenarios — each one lands a distinct engine signal. */
function suspiciousScenarios(rnd: () => number): GenTxn[] {
  const out: GenTxn[] = [];
  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

  // 1 — high-value spike on an established customer, unusual ticket (≥10×
  // their median) from an out-of-corridor location → stacks to HIGH
  const hv = CUSTOMER_POOL[0];
  out.push({
    amount: 185_000, customerId: hv.id, customerName: hv.name,
    merchant: "Tanishq", location: "Surat", device: hv.device,
    paymentMethod: "Credit Card", timestamp: at(190), label: 0,
  });

  // 2 — velocity burst: 6 rapid payments, tickets ≫ the customer's median
  // → velocity + unusual-amount stack to HIGH
  const vel = CUSTOMER_POOL[1];
  for (let i = 5; i >= 0; i--) {
    out.push({
      amount: Math.round(12_000 + rnd() * 6_000),
      customerId: vel.id, customerName: vel.name,
      merchant: "Electronics Bazaar", location: vel.city, device: vel.device,
      paymentMethod: "Credit Card", timestamp: at(120 + i * 2), label: 1,
    });
  }

  // 3 — first-seen device + new location on a mid ticket
  const nd = CUSTOMER_POOL[2];
  out.push({
    amount: 14_500, customerId: nd.id, customerName: nd.name,
    merchant: "TravelMart", location: "Guwahati", device: "Unknown-Dev-M77",
    paymentMethod: "UPI", timestamp: at(95), label: 1,
  });

  // 4 — odd-hour activity (03:10 today)
  const oh = CUSTOMER_POOL[3];
  const oddTs = new Date();
  oddTs.setHours(3, 10, 0, 0);
  if (oddTs.getTime() > now) oddTs.setDate(oddTs.getDate() - 1);
  out.push({
    amount: 7_400, customerId: oh.id, customerName: oh.name,
    merchant: "QuickMart Kiosk", location: oh.city, device: oh.device,
    paymentMethod: "Wallet", timestamp: oddTs.toISOString(), label: 0,
  });

  // 5 — structuring: just under the ₹50,000 review line
  const st = CUSTOMER_POOL[4];
  out.push({
    amount: 49_200, customerId: st.id, customerName: st.name,
    merchant: "Goldsmith & Co", location: st.city, device: st.device,
    paymentMethod: "Netbanking", timestamp: at(55), label: 1,
  });

  // 6 — mule ring: three accounts, one shared burner, one merchant, tight window
  const ringAccounts = [CUSTOMER_POOL[5], CUSTOMER_POOL[6], CUSTOMER_POOL[7]];
  ringAccounts.forEach((c, i) => {
    out.push({
      amount: Math.round(38_000 + i * 3_400),
      customerId: c.id, customerName: c.name,
      merchant: "QuickMart Kiosk", location: "Ludhiana",
      device: "BURNER-D900", paymentMethod: "Wallet",
      timestamp: at(30 + i * 4), label: 1,
    });
  });
  // second leg keeps the ring's device reuse ≥3 shared-device txns
  ringAccounts.forEach((c, i) => {
    out.push({
      amount: Math.round(41_500 + i * 2_100),
      customerId: c.id, customerName: c.name,
      merchant: "QuickMart Kiosk", location: "Ludhiana",
      device: "BURNER-D900", paymentMethod: "Wallet",
      timestamp: at(20 + i * 3), label: 1,
    });
  });

  return out;
}

/** Seed the ledger with a reproducible demo portfolio. Idempotent-ish:
 * skips customers/txns that already exist.
 * TENANT SCOPE: seeds into the caller's organisation only. */
export async function seedDemoData(organisationId: string): Promise<{ created: number; skipped: number }> {
  const rnd = mulberry(20260112);

  const existing = await db.transaction.count({ where: { organisationId, dataSource: "demo" } });
  if (existing > 0) {
    return { created: 0, skipped: existing };
  }

  // KYC-tier variety so customer profiles aren't uniform
  // (SQLite has no createMany skipDuplicates — upsert keeps it idempotent)
  for (const [i, c] of CUSTOMER_POOL.entries()) {
    const existingCustomer = await db.customer.findFirst({
      where: { organisationId, externalId: c.id },
      select: { id: true },
    });
    if (!existingCustomer) {
      await db.customer.create({
        data: {
          organisationId,
          externalId: c.id,
          name: c.name,
          kycTier: i % 3 === 0 ? "FULL KYC" : i % 3 === 1 ? "MIN KYC" : "PENDING",
          riskProfile: "normal",
          priorIncidents: 0,
        },
      });
    }
  }

  const all = [...normalTraffic(6, 64, rnd), ...suspiciousScenarios(rnd)];
  let created = 0;
  // chronological order so customer history reads naturally
  all.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  for (const t of all) {
    await scoreAndPersistTransaction({ ...t, id: nextId(), dataSource: "demo" }, organisationId);
    created += 1;
  }

  await writeAudit({
    organisationId,
    actor: "SYSTEM",
    action: "DEMO_SEEDED",
    entityType: "Ledger",
    entityId: "demo",
    detail: { created, note: "Synthetic demo portfolio — labelled dataSource=demo." },
  });

  return { created, skipped: 0 };
}

/**
 * One synthetic arrival for the live feed. Deterministic mix: ~85% normal
 * traffic, otherwise one of the alert shapes. Returns the created ids so
 * the client can highlight them.
 */
export async function generateDemoArrival(organisationId: string): Promise<{ ids: string[]; burst: boolean }> {
  const rnd = mulberry((Date.now() ^ 0x5f3759df) >>> 0);
  const roll = rnd();
  const batch: GenTxn[] = [];

  if (roll < 0.8) {
    batch.push(pick(normalTraffic(0, 8, rnd), rnd));
  } else if (roll < 0.88) {
    // high-value alert — ≥₹1,00,000 watch threshold
    const c = pick(CUSTOMER_POOL, rnd);
    batch.push({
      amount: Math.round(1_05_000 + rnd() * 180_000),
      customerId: c.id, customerName: c.name,
      merchant: pick(["Tanishq", "TravelMart", "Goldsmith & Co"], rnd),
      location: c.city, device: c.device,
      paymentMethod: pick(["Credit Card", "Netbanking"], rnd),
      timestamp: new Date().toISOString(),
      label: 0,
    });
  } else if (roll < 0.94) {
    // velocity burst — 4 rapid, unusually large payments
    const c = pick(CUSTOMER_POOL, rnd);
    for (let i = 3; i >= 0; i--) {
      batch.push({
        amount: Math.round(11_000 + rnd() * 6_000),
        customerId: c.id, customerName: c.name,
        merchant: "Electronics Bazaar", location: c.city, device: c.device,
        paymentMethod: c.method,
        timestamp: new Date(Date.now() - i * 45_000).toISOString(),
        label: 1,
      });
    }
  } else {
    // burner mini-ring — 3 accounts, one shared device
    const device = `BURNER-${Math.floor(rnd() * 900 + 100)}`;
    const shuffled = [...CUSTOMER_POOL].sort(() => rnd() - 0.5).slice(0, 3);
    shuffled.forEach((c, i) => {
      batch.push({
        amount: Math.round(36_000 + rnd() * 14_000),
        customerId: c.id, customerName: c.name,
        merchant: "QuickMart Kiosk", location: c.city, device,
        paymentMethod: "Wallet",
        timestamp: new Date(Date.now() - i * 60_000).toISOString(),
        label: 1,
      });
    });
  }

  const ids: string[] = [];
  for (const t of batch) {
    const id = nextId();
    await scoreAndPersistTransaction({ ...t, id, dataSource: "demo" }, organisationId);
    ids.push(id);
  }
  return { ids, burst: batch.length > 1 };
}

/** Clear ONLY synthetic demo records in the caller's organisation —
 * imported/manual data and other tenants survive. */
export async function clearDemoData(organisationId: string): Promise<{ deleted: number }> {
  const demoTxns = await db.transaction.findMany({
    where: { organisationId, dataSource: "demo" },
    select: { id: true },
  });
  const ids = demoTxns.map((t) => t.id);

  // investigations + audit rows cascade/set-null via schema relations
  const deleted = ids.length
    ? (await db.transaction.deleteMany({ where: { id: { in: ids } } })).count
    : 0;

  // customers that no longer have any transactions in the ledger
  const orphans = await db.customer.findMany({
    where: { organisationId, transactions: { none: {} } },
    select: { id: true },
  });
  if (orphans.length) {
    await db.customer.deleteMany({ where: { id: { in: orphans.map((c) => c.id) } } });
  }

  await writeAudit({
    organisationId,
    actor: "SYSTEM",
    action: "DEMO_CLEARED",
    entityType: "Ledger",
    entityId: "demo",
    detail: { deleted },
  });

  return { deleted };
}
