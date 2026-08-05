import { sql, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { vouchers, voucherRedemptions, users } from "../shared/schema";
const db = drizzle(process.env.DATABASE_URL!);
const q = db.select({
  v: vouchers,
  redemptionCount: sql<number>`(select count(*) from ${voucherRedemptions} r where r.voucher_id = ${vouchers.id})::int`,
  redeemedBy: sql<string | null>`(
    select u.email from ${voucherRedemptions} r
    join ${users} u on u.id = r.user_id
    where r.voucher_id = ${vouchers.id}
    order by r.redeemed_at limit 1)`,
}).from(vouchers).orderBy(desc(vouchers.createdAt)).limit(1000);
console.log("SQL:", (q as any).toSQL().sql);
