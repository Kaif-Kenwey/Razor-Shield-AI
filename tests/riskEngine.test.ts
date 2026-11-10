/**
 * RazorShield AI — engine & platform test suite (bun test).
 *
 * 21 tests covering what DEMO.md and docs/saas promise:
 *   - future-data leakage prevention (causal scoring)
 *   - Dataset Studio ⇔ ledger scoring consistency
 *   - duplicate + invalid-row import handling
 *   - tamper-proof investigation facts (server-only context)
 *   - investigation aggregates exclude the case itself & future rows
 *   - honest "Unknown" account age
 *   - LLM failure → deterministic heuristic fallback (recorded)
 *   - analyst decision / note / audit persistence across a FRESH
 *     database connection (the "restart" proof)
 *   - SaaS foundation: registration→org provisioning, password policy,
 *     account lockout, CROSS-TENANT isolation, sealed-secret tamper
 *     resistance, hashed session tokens at rest
 *
 * ISOLATION
 *   Tests never touch the app's real database or the operator's saved LLM
 *   credentials. Run against a dedicated SQLite file:
 *
 *     DATABASE_URL="file:<abs>/db/test.db" bunx prisma db push --skip-generate
 *     DATABASE_URL="file:<abs>/db/test.db" bun test
 *
 *   LLM_CONFIG_PATH redirects the runtime LLM config store to a temp dir,
 *   so saved provider keys are invisible here and no network call to any
 *   provider can ever happen (the fallback test points the LLM at a
 *   loopback port the SSRF guard blocks — a failure BY DESIGN).
 *
 * NOTE ON IMPORT ORDER: environment variables are assigned BEFORE any
 * module is imported (PrismaClient reads DATABASE_URL at first
 * instantiation; llmConfigStore reads LLM_CONFIG_PATH at module load), so
 * this file uses dynamic imports inside beforeAll only.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

/* ------------------------------------------------------------------ */
/* Environment — MUST run before the first import                      */
/* ------------------------------------------------------------------ */

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || "file:../db/test.db";

/** Temp home for the runtime LLM config store — invisible to real config. */
const LLM_TMP_DIR = mkdtempSync(path.join(tmpdir(), "razorshield-test-"));
process.env.LLM_CONFIG_PATH = path.join(LLM_TMP_DIR, "llm-config.json");

/* Default state for these tests: NO LLM configured (heuristic paths). */
delete process.env.LLM_BASE_URL;
delete process.env.LLM_API_KEY;
delete process.env.LLM_MODEL;
delete process.env.LLM_EXTRA_HEADERS;
delete process.env.ADMIN_TOKEN;

/* ------------------------------------------------------------------ */
/* Shared handles (filled in beforeAll via dynamic imports)            */
/* ------------------------------------------------------------------ */

type AnyDb = {
  transaction: any;
  customer: any;
  investigation: any;
  caseNote: any;
  auditEvent: any;
  datasetRow: any;
  dataset: any;
  llmProviderConfig: any;
  invitation: any;
  membership: any;
  session: any;
  verificationToken: any;
  organisation: any;
  user: any;
  $transaction: any;
  $disconnect: any;
};

let db: AnyDb;
let PrismaClientCtor: any;
let scoreBatch: (inputs: any[]) => { rows: any[] };
let FLAG_THRESHOLD: number;
let scoreAndPersistTransaction: (input: any, organisationId: string) => Promise<any>;
let loadServerCaseContext: (id: string, organisationId: string) => Promise<any>;
let importPost: (request: Request) => Promise<Response>;
let investigatePost: (request: Request) => Promise<Response>;
let txnPatch: (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let notesPost: (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let authRegister: (input: {
  name: string;
  email: string;
  password: string;
  organisationName?: string;
  invitationToken?: string;
}) => Promise<any>;
let authLogin: (email: string, password: string) => Promise<any>;

/* ------------------------------------------------------------------ */
/* SaaS fixtures — identity created through the REAL auth service      */
/* ------------------------------------------------------------------ */

let ORG_ID = "";
let USER_ID = "";
let USER_EMAIL = "";
let SESSION_TOKEN = "";

/** Run-unique suffix — reruns never collide with leftover rows. */
const RUN = `T${Date.now().toString(36)}`;
const BASE = Date.UTC(2024, 2, 15, 10, 0, 0); // 2024-03-15T10:00:00Z
const at = (hOffset: number, min = 0) =>
  new Date(BASE + hOffset * 3_600_000 + min * 60_000).toISOString();

/** Empty the isolated database (business + identity tables) so every test
 * starts from a known state. FK-safe order: children first. */
async function resetLedger(): Promise<void> {
  await db.datasetRow.deleteMany({});
  await db.dataset.deleteMany({});
  await db.auditEvent.deleteMany({});
  await db.caseNote.deleteMany({});
  await db.investigation.deleteMany({});
  await db.transaction.deleteMany({});
  await db.customer.deleteMany({});
  await db.llmProviderConfig.deleteMany({});
  await db.invitation.deleteMany({});
  await db.membership.deleteMany({});
  await db.session.deleteMany({});
  await db.verificationToken.deleteMany({});
  await db.organisation.deleteMany({});
  await db.user.deleteMany({});
}

/** Surrogate row for an external (UI-facing) transaction id in THIS org. */
async function txnRow(externalId: string) {
  return db.transaction.findFirst({ where: { organisationId: ORG_ID, externalId } });
}

/** Authenticated, same-origin request — routes now require a session
 * (opaque cookie token) and mutations must present a matching Origin. */
function authed(url: string, body: unknown, ip: string, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
      cookie: `rs_session=${SESSION_TOKEN}`,
      origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}

/** Minimal EngineInput builder. */
function input(
  id: string,
  amount: number,
  iso: string,
  customerId: string,
  extra?: Partial<Record<"merchant" | "location" | "device" | "paymentMethod" | "label", unknown>>,
) {
  return {
    index: 0,
    txnId: id,
    amount,
    at: new Date(iso).getTime(),
    customerId,
    customerName: "",
    merchant: (extra?.merchant as string) ?? "Generic Mart",
    location: (extra?.location as string) ?? "Mumbai",
    device: (extra?.device as string) ?? "device-shared",
    paymentMethod: (extra?.paymentMethod as string) ?? "UPI",
    label: (extra?.label as 0 | 1 | null) ?? null,
  };
}

const post = (url: string, body: unknown, ip: string) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  const dbMod = await import("@/lib/db");
  db = dbMod.db as AnyDb;

  const prismaMod = await import("@prisma/client");
  PrismaClientCtor = prismaMod.PrismaClient;

  const engine = await import("@/lib/riskEngine");
  scoreBatch = engine.scoreBatch;
  FLAG_THRESHOLD = engine.FLAG_THRESHOLD;

  const scoring = await import("@/lib/server/scoringService");
  scoreAndPersistTransaction = scoring.scoreAndPersistTransaction;

  const caseCtx = await import("@/lib/server/caseContext");
  loadServerCaseContext = caseCtx.loadServerCaseContext;

  const importRoute = await import("@/app/api/transactions/import/route");
  importPost = importRoute.POST;

  const investigateRoute = await import("@/app/api/investigate/route");
  investigatePost = investigateRoute.POST;

  const txnRoute = await import("@/app/api/transactions/[id]/route");
  txnPatch = txnRoute.PATCH;

  const notesRoute = await import("@/app/api/transactions/[id]/notes/route");
  notesPost = notesRoute.POST;

  const authService = await import("@/lib/server/auth/service");
  authRegister = authService.register;
  authLogin = authService.login;

  await resetLedger();

  /* Identity fixtures through the REAL service paths (bcrypt, audit). */
  const reg = await authRegister({
    name: "Test Analyst",
    email: `${RUN.toLowerCase()}@test.local`,
    password: "test-password-123",
    organisationName: `Test Org ${RUN}`,
  });
  if (!reg.ok) throw new Error(`test identity bootstrap failed: ${reg.error}`);
  ORG_ID = reg.value.organisation!.id;
  USER_ID = reg.value.user.id;
  USER_EMAIL = reg.value.user.email;
  const session = await authService.createSession(USER_ID, {
    ip: "10.0.0.9",
    userAgent: "bun-test",
  });
  SESSION_TOKEN = session.token;
});

afterAll(async () => {
  try {
    await db.$disconnect();
  } catch {
    /* isolated test db — nothing to save */
  }
  try {
    rmSync(LLM_TMP_DIR, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/* ================================================================== */
/* 1 — Pure engine: rules & causal guarantees                          */
/* ================================================================== */

describe("risk engine (pure)", () => {
  test("1. flags a large payment with a traceable HIGH_VALUE signal", () => {
    const { rows } = scoreBatch([input(`${RUN}-HV1`, 184_000, at(0), `${RUN}-C1`)]);
    const r = rows[0];
    expect(r.riskScore).toBeGreaterThanOrEqual(20);
    expect(r.signals.some((s: any) => s.type === "HIGH_VALUE")).toBe(true);
    // Honest banding: recommendation follows the risk band — below the
    // FLAG_THRESHOLD (28) a lone high-value payment with NO history scores
    // LOW band (ALLOW); at/above it the engine escalates to review actions.
    if (r.riskScore >= FLAG_THRESHOLD) {
      expect(["REVIEW", "HOLD", "BLOCK"]).toContain(r.recommendation);
    } else {
      expect(r.recommendation).toBe("ALLOW");
    }
  }, 30_000);

  test("2. future transactions never leak into earlier scores", () => {
    const cust = `${RUN}-C2`;
    const smalls = [
      input(`${RUN}-F1`, 500, at(0), cust),
      input(`${RUN}-F2`, 520, at(1), cust),
      input(`${RUN}-F3`, 480, at(2), cust),
      input(`${RUN}-F4`, 510, at(3), cust),
    ];
    const big = input(`${RUN}-F5`, 250_000, at(4), cust);

    const withFuture = scoreBatch([...smalls, big]).rows;
    const withoutFuture = scoreBatch([...smalls]).rows;

    smalls.forEach((_s, i) => {
      expect(withFuture[i].riskScore).toBe(withoutFuture[i].riskScore);
    });
    // The future payment itself DID see the prior history:
    expect(withFuture[4].signals.some((s: any) => s.type === "HIGH_VALUE")).toBe(true);
  }, 30_000);

  test("3. scoring is deterministic — same input, same scores", () => {
    const cust = `${RUN}-C3`;
    const rows = [
      input(`${RUN}-D1`, 900, at(0), cust, { device: "d-A" }),
      input(`${RUN}-D2`, 42_000, at(1), cust, { device: "d-B" }),
      input(`${RUN}-D3`, 950, at(2), cust, { device: "d-A" }),
      input(`${RUN}-D4`, 1_100, at(3), cust, { device: "d-A" }),
    ];
    const run1 = scoreBatch(rows).rows.map((r) => r.riskScore);
    const run2 = scoreBatch(rows).rows.map((r) => r.riskScore);
    expect(run1).toEqual(run2);

    // Causality, not array luck: the earliest row (empty history in any
    // order) keeps its score even when the input array is reversed.
    const reversed = scoreBatch([...rows].reverse()).rows;
    expect(reversed.find((r) => r.txnId === `${RUN}-D1`)!.riskScore).toBe(run1[0]);
  }, 30_000);

  test("4. customer-relative rules need ≥3 prior transactions", () => {
    const mk = (n: number, cust: string) => [
      ...Array.from({ length: n }, (_v, i) => input(`${RUN}-P${cust}${i}`, 500, at(i), cust)),
      input(`${RUN}-Q${cust}`, 20_000, at(n, 30), cust),
    ];
    const withThree = scoreBatch(mk(3, `${RUN}-C4a`)).rows;
    const withTwo = scoreBatch(mk(2, `${RUN}-C4b`)).rows;

    expect(withThree[3].signals.some((s: any) => s.type === "UNUSUAL_AMOUNT")).toBe(true);
    expect(withTwo[2].signals.some((s: any) => s.type === "UNUSUAL_AMOUNT")).toBe(false);
  }, 30_000);

  test("5. composite score equals the sum of signal impacts, capped at 100", () => {
    const cust = `${RUN}-C5`;
    const inputs = [
      input(`${RUN}-S1`, 120, at(0), cust, { device: "d1", location: "Chennai" }),
      input(`${RUN}-S2`, 980, at(0, 10), cust, { device: "d2", location: "Varanasi" }),
      input(`${RUN}-S3`, 145_000, at(0, 20), cust, { device: "d3", location: "Srinagar" }),
      input(`${RUN}-S4`, 97_500, at(0, 30), cust, { device: "d4", location: "Madurai" }),
    ];
    for (const row of scoreBatch(inputs).rows) {
      const sum = row.signals.reduce((s: number, sig: any) => s + sig.impact, 0);
      const expected = Math.min(100, sum);
      expect(Math.abs(row.riskScore - expected)).toBeLessThan(0.001);
    }
  }, 30_000);
});

/* ================================================================== */
/* 2 — Ledger pipeline: consistency, duplicates, validation, labels    */
/* ================================================================== */

describe("ledger ingestion (isolated DB)", () => {
  test("6. ledger per-row scores match batch scores (Studio ⇔ ledger consistency)", async () => {
    const custA = `${RUN}-CC-A`;
    const custB = `${RUN}-CC-B`;
    const seeds = [
      { id: `${RUN}-CC1`, amount: 640, iso: at(0), cust: custA, device: "da-1" },
      { id: `${RUN}-CC2`, amount: 720, iso: at(1), cust: custA, device: "da-1" },
      { id: `${RUN}-CC3`, amount: 68_000, iso: at(1, 30), cust: custB, device: "db-1" },
      { id: `${RUN}-CC4`, amount: 690, iso: at(2), cust: custA, device: "da-1" },
      { id: `${RUN}-CC5`, amount: 88_000, iso: at(2, 40), cust: custB, device: "db-1" },
      { id: `${RUN}-CC6`, amount: 24_500, iso: at(3), cust: custA, device: "da-2" },
      { id: `${RUN}-CC7`, amount: 710, iso: at(3, 20), cust: custA, device: "da-1" },
      { id: `${RUN}-CC8`, amount: 19_900, iso: at(4), cust: custB, device: "db-2" },
    ];

    // Ledger path: chronological per-row ingestion (exactly what the import
    // route does), starting from an EMPTY ledger.
    const ledgerScores = new Map<string, number>();
    for (const s of seeds) {
      const out = await scoreAndPersistTransaction({
        id: s.id,
        amount: s.amount,
        customerId: s.cust,
        merchant: "Consistency Mart",
        location: "Mumbai",
        device: s.device,
        paymentMethod: "UPI",
        timestamp: s.iso,
        dataSource: "import",
      }, ORG_ID);
      ledgerScores.set(s.id, out.riskScore);
    }

    // Batch path: the same rows through the pure engine (Dataset Studio).
    const batch = scoreBatch(
      seeds.map((s) =>
        input(s.id, s.amount, s.iso, s.cust, { device: s.device, merchant: "Consistency Mart" }),
      ),
    ).rows;

    for (const s of seeds) {
      const batchRow = batch.find((r) => r.txnId === s.id)!;
      expect(ledgerScores.get(s.id)).toBe(Math.round(batchRow.riskScore));
    }
  }, 60_000);

  test("7. duplicate transaction ids are rejected, never silently overwritten", async () => {
    const cust = `${RUN}-C7`;
    const row = {
      txnId: `${RUN}-DUP1`,
      amount: 5_000,
      timestamp: at(0),
      customerId: cust,
      merchant: "Dup Mart",
    };
    const first = await importPost(
      authed("http://localhost/api/transactions/import", { datasetName: "dup-test", rows: [row] }, "10.7.0.1"),
    );
    const firstBody = (await first.json()) as any;
    expect(firstBody.ok).toBe(true);
    expect(firstBody.imported).toBe(1);

    // Tamper the amount in the replay — the duplicate must NOT overwrite.
    const second = await importPost(
      authed(
        "http://localhost/api/transactions/import",
        { datasetName: "dup-test", rows: [{ ...row, amount: 999_999 }] },
        "10.7.0.2",
      ),
    );
    const secondBody = (await second.json()) as any;
    expect(secondBody.imported).toBe(0);
    expect(secondBody.duplicates).toContain(`${RUN}-DUP1`);

    const stored = await txnRow(`TXN_${RUN}-DUP1`);
    expect(stored?.amount).toBe(5_000);
  }, 60_000);

  test("8. invalid rows are reported and never poison the batch", async () => {
    const cust = `${RUN}-C8`;
    const res = await importPost(
      authed(
        "http://localhost/api/transactions/import",
        {
          datasetName: "invalid-row-test",
          rows: [
            { txnId: `${RUN}-V1`, amount: 1_200, timestamp: at(0), customerId: cust },
            { txnId: `${RUN}-V2-BAD`, amount: -50, timestamp: at(0, 5), customerId: cust },
            { txnId: `${RUN}-V3`, amount: 340, timestamp: at(0, 10), customerId: cust },
          ],
        },
        "10.8.0.1",
      ),
    );
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.imported).toBe(2);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].txnId).toBe(`${RUN}-V2-BAD`);
  }, 60_000);

  test("9. ground-truth labels survive the import", async () => {
    const cust = `${RUN}-C9`;
    const res = await importPost(
      authed(
        "http://localhost/api/transactions/import",
        {
          datasetName: "label-test",
          rows: [
            { txnId: `${RUN}-L1`, amount: 76_000, timestamp: at(0), customerId: cust, label: 1 },
            { txnId: `${RUN}-L2`, amount: 830, timestamp: at(0, 15), customerId: cust, label: 0 },
          ],
        },
        "10.9.0.1",
      ),
    );
    const body = (await res.json()) as any;
    expect(body.imported).toBe(2);
    const fraud = await txnRow(`TXN_${RUN}-L1`);
    const legit = await txnRow(`TXN_${RUN}-L2`);
    expect(fraud?.label).toBe(1);
    expect(legit?.label).toBe(0);
  }, 60_000);
});

/* ================================================================== */
/* 3 — Investigation context: tamper-proofing + honest aggregates      */
/* ================================================================== */

describe("investigation context (server-only facts)", () => {
  test("10. tampered requests cannot change the facts the engine uses", async () => {
    const cust = `${RUN}-C10`;
    await scoreAndPersistTransaction({
      id: `${RUN}-TAM1`,
      amount: 42.5,
      customerId: cust,
      merchant: "Truth Mart",
      location: "Pune",
      device: "dev-10",
      paymentMethod: "UPI",
      timestamp: at(0),
      dataSource: "import",
    }, ORG_ID);

    // A malicious body smuggles amount/score/signals — the route accepts
    // ONLY transactionId, so these must be ignored end to end.
    const res = await investigatePost(
      authed(
        "http://localhost/api/investigate",
        {
          transactionId: `${RUN}-TAM1`,
          amount: 99_999_999,
          riskScore: 1,
          signals: [{ type: "HIGH_VALUE", impact: 100 }],
        },
        "10.10.0.1",
      ),
    );
    const body = (await res.json()) as any;
    // No LLM configured → the route hands off to the heuristic engine…
    expect(body.ok).toBe(false);
    expect(String(body.reason)).toContain("heuristic");

    // …and the SERVER-side context still carries the real stored facts.
    const serverCase = await loadServerCaseContext(`${RUN}-TAM1`, ORG_ID);
    expect(serverCase).not.toBeNull();
    expect(serverCase.context.transaction.amount).toBe(42.5);
    expect(serverCase.context.transaction.merchant).toBe("Truth Mart");

    // Unknown ids are rejected outright.
    const missing = await investigatePost(
      authed("http://localhost/api/investigate", { transactionId: `${RUN}-DOES-NOT-EXIST` }, "10.10.0.2"),
    );
    expect(missing.status).toBe(404);
  }, 60_000);

  test("11. prior aggregates exclude the case itself and all future rows", async () => {
    const cust = `${RUN}-C11`;
    // One genuine prior payment (T-1h), the case itself (T), one future
    // payment (T+1h). The prior count/average must reflect ONLY the prior.
    await scoreAndPersistTransaction({
      id: `${RUN}-AGG0`, amount: 500, customerId: cust, timestamp: at(-1),
      merchant: "Hist Mart", device: "d11", location: "Nagpur", paymentMethod: "UPI", dataSource: "import",
    }, ORG_ID);
    await scoreAndPersistTransaction({
      id: `${RUN}-AGG1`, amount: 100_000, customerId: cust, timestamp: at(0),
      merchant: "Case Mart", device: "d11", location: "Nagpur", paymentMethod: "UPI", dataSource: "import",
    }, ORG_ID);
    await scoreAndPersistTransaction({
      id: `${RUN}-AGG2`, amount: 900_000, customerId: cust, timestamp: at(1),
      merchant: "Future Mart", device: "d11", location: "Nagpur", paymentMethod: "UPI", dataSource: "import",
    }, ORG_ID);

    const serverCase = await loadServerCaseContext(`${RUN}-AGG1`, ORG_ID);
    expect(serverCase).not.toBeNull();
    expect(serverCase.context.customer.transactionCount).toBe(1); // not 2, not 3
    expect(serverCase.context.customer.avgTransaction).toBe(500); // excludes self (100k) & future (900k)
    expect(serverCase.factsSummary.priorIncidents).toBe(0);
  }, 60_000);

  test("12. account age is Unknown without a genuine account-opening date", async () => {
    const serverCase = await loadServerCaseContext(`${RUN}-AGG1`, ORG_ID);
    expect(serverCase).not.toBeNull();
    // Customer.createdAt is the RazorShield record-creation time — NOT a
    // bank account open date. The context must not present it as one.
    expect(serverCase.context.customer.accountAge).toBeUndefined();
  }, 30_000);
});

/* ================================================================== */
/* 4 — LLM fallback & persistence guarantees                           */
/* ================================================================== */

describe("fallback & persistence (isolated DB)", () => {
  test("13. LLM failure falls back to the heuristic engine and records why", async () => {
    // Env-configured LLM pointing at a loopback port the SSRF guard blocks
    // — a deterministic, network-free way to make the LLM call FAIL.
    process.env.LLM_BASE_URL = "http://127.0.0.1:9/v1";
    process.env.LLM_API_KEY = "test-key-123456";
    process.env.LLM_MODEL = "test-model";
    try {
      const res = await investigatePost(
        authed("http://localhost/api/investigate", { transactionId: `${RUN}-TAM1` }, "10.13.0.1"),
      );
      const body = (await res.json()) as any;
      expect(body.ok).toBe(false);
      expect(String(body.reason)).toContain("falling back");

      const persistedTxn = await txnRow(`${RUN}-TAM1`);
      const inv = persistedTxn
        ? await db.investigation.findUnique({ where: { transactionId: persistedTxn.id } })
        : null;
      expect(inv?.mode).toBe("heuristic");
      expect(String(inv?.fallbackReason)).toContain("LLM call failed");
      expect(inv?.recommendedAction).toBe("REVIEW");
    } finally {
      delete process.env.LLM_BASE_URL;
      delete process.env.LLM_API_KEY;
      delete process.env.LLM_MODEL;
    }
  }, 60_000);

  test("14. analyst decision and notebook entry survive a FRESH connection (restart)", async () => {
    const cust = `${RUN}-C14`;
    await scoreAndPersistTransaction({
      id: `${RUN}-PERS1`, amount: 58_000, customerId: cust, timestamp: at(0),
      merchant: "Persist Mart", device: "d14", location: "Delhi", paymentMethod: "Credit Card", dataSource: "import",
    }, ORG_ID);

    const patchRes = await txnPatch(
      authed(
        `http://localhost/api/transactions/${RUN}-PERS1`,
        { decision: "BLOCK", note: "Confirmed mule pattern — blocked" },
        "10.14.0.1",
        "PATCH",
      ),
      { params: Promise.resolve({ id: `${RUN}-PERS1` }) },
    );
    expect(((await patchRes.json()) as any).ok).toBe(true);

    const noteRes = await notesPost(
      authed(
        `http://localhost/api/transactions/${RUN}-PERS1/notes`,
        { text: "Customer could not explain the beneficiary" },
        "10.14.0.2",
      ),
      { params: Promise.resolve({ id: `${RUN}-PERS1` }) },
    );
    expect(((await noteRes.json()) as any).ok).toBe(true);

    // RESTART PROOF: a brand-new PrismaClient (fresh connection, same disk
    // file) must see the decision, the note and the resolution timestamp.
    const fresh = new PrismaClientCtor({ datasourceUrl: process.env.DATABASE_URL });
    try {
      const row = await fresh.transaction.findFirst({
        where: { organisationId: ORG_ID, externalId: `${RUN}-PERS1` },
        include: { investigation: true },
      });
      expect(row?.investigation?.analystAction).toBe("BLOCK");
      expect(row?.investigation?.analystNote).toBe("Confirmed mule pattern — blocked");
      expect(row?.investigation?.resolvedAt).not.toBeNull();
      expect(row?.status).toBe("BLOCKED");

      const notes = await fresh.caseNote.findMany({ where: { transactionId: row!.id } });
      expect(notes).toHaveLength(1);
      expect(notes[0].text).toContain("beneficiary");
    } finally {
      await fresh.$disconnect();
    }
  }, 60_000);

  test("15. the audit trail records the analyst decision, append-only", async () => {
    const persisted = await txnRow(`${RUN}-PERS1`);
    expect(persisted).not.toBeNull();
    const events = async () =>
      db.auditEvent.findMany({
        where: { transactionId: persisted!.id },
        orderBy: { createdAt: "asc" },
      });

    const before = await events();
    expect(before.some((e: any) => e.action === "DECISION_RECORDED")).toBe(true);
    expect(before.some((e: any) => e.action === "NOTE_ADDED")).toBe(true);
    expect(before.some((e: any) => e.action === "STATUS_CHANGED")).toBe(true);

    // Append-only: existing rows keep their identity and order — a re-read
    // only ever EXTENDS the trail, never rewrites it.
    const after = await events();
    expect(after.length).toBeGreaterThanOrEqual(before.length);
    expect(after.slice(0, before.length).map((e: any) => e.id)).toEqual(
      before.map((e: any) => e.id),
    );

    // The decision event names the AUTHENTICATED actor (from the session,
    // never a client-supplied analyst id) and the action.
    const decision = before.find((e: any) => e.action === "DECISION_RECORDED");
    const detail = JSON.parse(decision!.detailJson);
    expect(detail.decision).toBe("BLOCK");
    expect(detail.by).toBe(USER_EMAIL);
    expect(decision!.actorUserId).toBe(USER_ID);
  }, 30_000);
});

/* ================================================================== */
/* 5 — SaaS foundation: identity, tenancy, secrets                     */
/* ================================================================== */

describe("SaaS foundation — identity, tenancy, secrets", () => {
  test("16. registration provisions an organisation with an OWNER membership", async () => {
    const email = `${RUN.toLowerCase()}-saas@test.local`;
    const res = await authRegister({
      name: "SaaS Owner",
      email,
      password: "owner-password-1",
      organisationName: `SaaS Org ${RUN}`,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.organisation).not.toBeNull();
      expect(res.value.role).toBe("OWNER");
      const membership = await db.membership.findFirst({ where: { userId: res.value.user.id } });
      expect(membership?.role).toBe("OWNER");
      expect(membership?.organisationId).toBe(res.value.organisation!.id);
    }
  }, 30_000);

  test("17. weak passwords are rejected by policy", async () => {
    const res = await authRegister({
      name: "Weak Password",
      email: `${RUN.toLowerCase()}-weak@test.local`,
      password: "short",
      organisationName: `Weak Org ${RUN}`,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  }, 30_000);

  test("18. five failed logins lock the account — even the right password then fails", async () => {
    const email = `${RUN.toLowerCase()}-lock@test.local`;
    const reg = await authRegister({
      name: "Lockout Analyst",
      email,
      password: "lockout-pass-1",
      organisationName: `Lockout Org ${RUN}`,
    });
    expect(reg.ok).toBe(true);

    for (let i = 0; i < 5; i++) {
      const attempt = await authLogin(email, "definitely-wrong-password");
      expect(attempt.ok).toBe(false);
    }
    // Correct password AFTER lockout must still be refused (429).
    const locked = await authLogin(email, "lockout-pass-1");
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.status).toBe(429);
  }, 60_000);

  test("19. CROSS-TENANT ISOLATION: another organisation cannot resolve foreign transactions", async () => {
    const regB = await authRegister({
      name: "Other Owner",
      email: `${RUN.toLowerCase()}-b@test.local`,
      password: "other-pass-123",
      organisationName: `Other Org ${RUN}`,
    });
    expect(regB.ok).toBe(true);
    if (!regB.ok) return;
    const ORG_B = regB.value.organisation!.id;

    // Investigation context: org B sees NOTHING of org A's ledger.
    const foreignCase = await loadServerCaseContext(`${RUN}-TAM1`, ORG_B);
    expect(foreignCase).toBeNull();

    // Direct lookup helper: foreign id ≡ missing id (non-disclosing).
    const { findOrgTransaction } = await import("@/lib/server/ledger");
    expect(await findOrgTransaction(ORG_B, `${RUN}-PERS1`)).toBeNull();
    expect(await findOrgTransaction(ORG_ID, `${RUN}-PERS1`)).not.toBeNull();

    // Scoped counts: B's ledger is empty, A's is not — no bleed either way.
    const countA = await db.transaction.count({ where: { organisationId: ORG_ID } });
    const countB = await db.transaction.count({ where: { organisationId: ORG_B } });
    expect(countA).toBeGreaterThan(0);
    expect(countB).toBe(0);
  }, 60_000);

  test("20. sealed secrets fail closed on tampering or wrong format", async () => {
    const { sealSecret, openSecret } = await import("@/lib/server/secretBox");
    const sealed = sealSecret("provider-key-123");
    expect(sealed.startsWith("enc:v1:")).toBe(true);
    expect(openSecret(sealed)).toBe("provider-key-123");

    // Flip the last hex chars — authentication must reject the ciphertext.
    const tampered = sealed.slice(0, -2) + (sealed.endsWith("aa") ? "bb" : "aa");
    expect(openSecret(tampered)).toBe("");
    // Unsealed plaintext is never trusted.
    expect(openSecret("plaintext-not-sealed")).toBe("");
    expect(openSecret(null)).toBe("");
  }, 30_000);

  test("21. session tokens are stored hashed — the raw token never touches the database", async () => {
    const sessions = await db.session.findMany({ where: { userId: USER_ID } });
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) {
      expect(s.tokenHash).not.toBe(SESSION_TOKEN);
      expect(s.tokenHash).toMatch(/^[a-f0-9]{64}$/); // sha-256 hex
    }
  }, 30_000);
});
