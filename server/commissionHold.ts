/**
 * The 30-day hold on commissions (client, 3 Nov 2026): "payouts should be
 * processed at 30 days rather than immediately", so a sale that is refunded
 * inside its return window is never paid out. Every commission is recorded
 * as pending when the sale happens and approved once it is HOLD days old;
 * the Monday payout run only ever pays approved rows. A refund before then
 * reverses it, so it never becomes payable. Until then it shows to the
 * person earning it as an upcoming payout, with the date it becomes payable.
 *
 * An admin can still approve one early by hand (POST
 * /api/admin/commissions/:id/approve).
 */
import { sql } from "drizzle-orm";

const DAY = 86_400_000;

/** Days a commission is held before it can be paid. COMMISSION_HOLD_DAYS, default 30. */
export function commissionHoldDays(): number {
  const n = Number(process.env.COMMISSION_HOLD_DAYS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30;
}

/** When a commission recorded at `createdAt` can be paid. */
export function payableFrom(createdAt: Date | string, days = commissionHoldDays()): Date {
  return new Date(new Date(createdAt).getTime() + days * DAY);
}

/** Approve every pending commission whose hold has passed. Returns how many. */
export async function approveHeldCommissions(now = new Date(), days = commissionHoldDays()): Promise<number> {
  const { db } = await import("./db");
  const cutoff = new Date(now.getTime() - days * DAY);
  const r = await db.execute(sql`
    update commission_transactions set status = 'approved'
    where status = 'pending' and created_at <= ${cutoff.toISOString()}::timestamp
    returning id`);
  return r.rows.length;
}
