/**
 * RazorShield AI — demo data seed script.
 *
 *   bun run db:seed
 *
 * Populates the SQLite ledger with a reproducible, clearly-labelled
 * synthetic portfolio (normal traffic + high-value, velocity, new-device,
 * odd-hour, structuring and mule-ring scenarios) through the same
 * server-side scoring service the UI uses. Skips when demo rows already
 * exist — clear only demo-labelled records from the app (System → Clear
 * demo data) or DELETE /api/demo.
 */

import { seedDemoData } from "../src/lib/server/demoData";

async function main() {
  console.log("[RazorShield] seeding synthetic demo portfolio…");
  const result = await seedDemoData();
  if (result.created === 0 && result.skipped > 0) {
    console.log(`[RazorShield] demo rows already present (${result.skipped}) — nothing to do.`);
    console.log("             Clear them from the app (System → Clear demo data) or DELETE /api/demo.");
  } else {
    console.log(`[RazorShield] created ${result.created} scored demo transactions.`);
  }
}

main()
  .catch((err) => {
    console.error("[RazorShield] seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    /* The shared Prisma singleton keeps the event loop alive — exit hard
     * once the seed outcome is printed. */
    process.exit(process.exitCode ?? 0);
  });
