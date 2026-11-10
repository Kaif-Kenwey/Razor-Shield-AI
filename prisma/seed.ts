/**
 * RazorShield AI — demo data seed script.
 *
 *   bun run db:seed
 *
 * Populates the DEMO ORGANISATION's ledger with a reproducible,
 * clearly-labelled synthetic portfolio (normal traffic + high-value,
 * velocity, new-device, odd-hour, structuring and mule-ring scenarios)
 * through the same server-side scoring service the UI uses. Creates the
 * bootstrap org + demo owner first if needed (same as the migration
 * bootstrap). Skips when demo rows already exist — clear only
 * demo-labelled records from the app (System → Clear demo data) or
 * DELETE /api/demo.
 */

import { db } from "../src/lib/db";
import { seedDemoData } from "../src/lib/server/demoData";

async function main() {
  const org = await db.organisation.upsert({
    where: { slug: "razorshield-demo" },
    update: {},
    create: { name: "RazorShield Demo", slug: "razorshield-demo" },
  });
  console.log(`[RazorShield] seeding synthetic demo portfolio into org ${org.name} (${org.id})…`);
  const result = await seedDemoData(org.id);
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
