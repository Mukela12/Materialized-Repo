import { storage } from "../server/storage";
const rows: any[] = await storage.listVouchers();
const used = rows.filter(r => r.redemptionCount > 0);
console.log("total:", rows.length, "| used:", used.length);
console.log("used row:", JSON.stringify({ code: used[0]?.code, redeemedBy: used[0]?.redeemedBy, count: used[0]?.redemptionCount }));
const unused = rows.find(r => r.redemptionCount === 0);
console.log("unused redeemedBy is null:", unused?.redeemedBy === null);
process.exit(0);
