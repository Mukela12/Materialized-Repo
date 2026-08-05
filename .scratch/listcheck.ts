/** Runs the REAL listVouchers against a REAL Postgres. Fakes cannot catch SQL. */
import { storage } from "../server/storage";
const rows = await storage.listVouchers();
console.log("rows:", rows.length);
const r: any = rows[0];
console.log("sample:", JSON.stringify({
  code: r?.code, batchId: r?.batchId, assignedTo: r?.assignedTo,
  redemptionCount: r?.redemptionCount, redeemedBy: r?.redeemedBy,
}));
console.log("all have batchId:", rows.every((x: any) => !!x.batchId));
console.log("all have assignedTo:", rows.every((x: any) => !!x.assignedTo));
console.log("distinct codes:", new Set(rows.map((x: any) => x.code)).size);
process.exit(0);
