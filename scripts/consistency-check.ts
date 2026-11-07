/* Dataset Studio vs ledger scoring consistency — per-row comparison. */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const ds = await db.dataset.findFirst({ orderBy: { createdAt: "desc" } });
if (!ds) { console.log("NO DATASET RUN FOUND"); process.exit(1); }
const rows = await db.datasetRow.findMany({
  where: { datasetId: ds.id },
  select: { txnId: true, riskScore: true, riskLevel: true, recommendation: true },
});
console.log("dataset run:", ds.name, "| rows:", rows.length);

// ledger ids are "TXN_" + txnId per the import route's freeId()
const ids = rows.map(r => "TXN_" + r.txnId);
const ledger = await db.transaction.findMany({
  where: { id: { in: ids } },
  select: { id: true, riskScore: true, riskLevel: true, recommendation: true },
});
const byId = new Map(ledger.map(l => [l.id, l]));

let same = 0, diffScore = 0, diffLevel = 0, missing = 0;
const examples: string[] = [];
for (const r of rows) {
  const l = byId.get("TXN_" + r.txnId);
  if (!l) { missing++; continue; }
  const scoreEq = Math.round(l.riskScore) === Math.round(r.riskScore);
  const levelEq = l.riskLevel === r.riskLevel;
  if (scoreEq && levelEq) same++;
  else {
    if (!scoreEq) diffScore++;
    if (!levelEq) diffLevel++;
    if (examples.length < 5) examples.push(`${r.txnId.slice(0,12)}: studio=${r.riskScore}/${r.riskLevel} ledger=${Math.round(l.riskScore)}/${l.riskLevel}`);
  }
}
console.log({ same, diffScore, diffLevel, missing });
console.log("match rate:", ((same / rows.length) * 100).toFixed(2) + "%");
if (examples.length) console.log("divergent examples:\n" + examples.join("\n"));
await db.$disconnect();
