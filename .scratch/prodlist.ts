/** Runs the REAL listVouchers against PRODUCTION — the query that was 500ing. */
import { storage } from "../server/storage";
const rows: any[] = await storage.listVouchers();
console.log("rows:", rows.length);
console.log("all have batchId:", rows.every(r => !!r.batchId));
console.log("all have assignedTo:", rows.every(r => !!r.assignedTo));
console.log("distinct codes:", new Set(rows.map(r => r.code)).size);
console.log("sample:", JSON.stringify({ code: rows[0]?.code, label: rows[0]?.label, assignedTo: rows[0]?.assignedTo, redeemedBy: rows[0]?.redeemedBy, seats: rows[0]?.maxRedemptions }));
process.exit(0);
