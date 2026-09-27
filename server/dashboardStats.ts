/**
 * Month-to-date numbers for the "This month" panel on the brand and creator
 * dashboards.
 *
 * WHY THIS EXISTS. Both panels were headed "This month" but neither was:
 *
 *  - /api/brands/stats counted every analytics event on the platform, with no
 *    brand filter and no date filter, so every brand saw the whole
 *    marketplace's views and clicks as their own. Its revenue and orders read
 *    analytics_events.revenue, which the ingest route deliberately never
 *    writes (it is client-supplied), so they were zero forever.
 *  - /api/analytics/stats sums lifetime per-video counters.
 *
 * Money here comes from platform_fee_accruals: one row per real order, written
 * by both the store webhook and the in-video checkout webhook, so an order is
 * counted once whichever way it was paid. Only `attributed` rows count (a
 * Materialized link drove the sale), and voided rows (refunds) are excluded.
 *
 * Periods are half-open [from, to) in UTC, the same convention billing uses.
 */
import { sql } from "drizzle-orm";
import type { MonthStats } from "@shared/monthStats";

export type { MonthStats };


export function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** YYYY-MM-DD for each UTC day from `from` through `now`'s day. */
export function daysInPeriod(from: Date, now: Date): string[] {
  const out: string[] = [];
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let t = from.getTime(); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Spread sparse per-day rows over every day of the period, zero-filled. */
export function fillDaily(rows: { day: string; value: number }[], days: string[]): number[] {
  const byDay = new Map(rows.map((r) => [r.day, Number(r.value) || 0]));
  return days.map((d) => byDay.get(d) ?? 0);
}

/**
 * Pick the currency to headline. Mixed-currency sums are meaningless, so the
 * currency with the most sales volume wins and the others are only counted.
 */
export function pickCurrency(
  rows: { currency: string; cents: number; orders: number }[],
): { currency: string; cents: number; orders: number } {
  const orders = rows.reduce((n, r) => n + Number(r.orders || 0), 0);
  const top = [...rows].sort((a, b) => Number(b.cents) - Number(a.cents))[0];
  return { currency: (top?.currency ?? "usd").toUpperCase(), cents: Number(top?.cents ?? 0), orders };
}

export function ctrOf(views: number, clicks: number): number {
  return views > 0 ? (clicks / views) * 100 : 0;
}

type Rows<T> = { rows: T[] };

async function salesFor(
  scope: { brandUserId: string } | { creatorId: string },
  from: Date,
  to: Date,
  days: string[],
) {
  const { db } = await import("./db");
  const where = "brandUserId" in scope
    ? sql`a.brand_user_id = ${scope.brandUserId}`
    : sql`v.creator_id = ${scope.creatorId}`;

  const totals = (await db.execute(sql`
    SELECT a.currency, COALESCE(SUM(a.sale_cents), 0)::bigint AS cents, COUNT(*)::int AS orders
    FROM platform_fee_accruals a
    LEFT JOIN videos v ON v.id = a.video_id
    WHERE ${where}
      AND a.attribution_state = 'attributed'
      AND a.status <> 'void'
      AND a.occurred_at >= ${from} AND a.occurred_at < ${to}
    GROUP BY a.currency
  `)) as unknown as Rows<{ currency: string; cents: number; orders: number }>;
  const picked = pickCurrency(totals.rows);

  const daily = (await db.execute(sql`
    SELECT to_char(a.occurred_at, 'YYYY-MM-DD') AS day, COALESCE(SUM(a.sale_cents), 0)::bigint AS value
    FROM platform_fee_accruals a
    LEFT JOIN videos v ON v.id = a.video_id
    WHERE ${where}
      AND a.attribution_state = 'attributed'
      AND a.status <> 'void'
      AND lower(a.currency) = ${picked.currency.toLowerCase()}
      AND a.occurred_at >= ${from} AND a.occurred_at < ${to}
    GROUP BY 1
  `)) as unknown as Rows<{ day: string; value: number }>;

  return {
    currency: picked.currency,
    revenue: picked.cents / 100,
    orders: picked.orders,
    revenueByDay: fillDaily(daily.rows, days).map((c) => c / 100),
  };
}

export async function brandMonthStats(brandUserId: string, now: Date = new Date()): Promise<MonthStats> {
  const { db } = await import("./db");
  const from = monthStartUtc(now);
  const days = daysInPeriod(from, now);

  /*
   * An event belongs to this brand when it names one of the brand's products,
   * or names no product but happened on a video that features one (or that
   * the brand uploaded itself). A click on ANOTHER brand's product in a shared
   * video is that brand's, not this one's.
   */
  const events = (await db.execute(sql`
    WITH bp AS (
      SELECT p.id FROM products p JOIN brands b ON b.id = p.brand_id WHERE b.owner_id = ${brandUserId}
    ), sv AS (
      SELECT vp.video_id AS id FROM video_products vp WHERE vp.product_id IN (SELECT id FROM bp)
      UNION
      SELECT v.id FROM videos v WHERE v.creator_id = ${brandUserId}
    )
    SELECT
      COUNT(*) FILTER (WHERE e.event_type = 'view')::int AS views,
      COUNT(*) FILTER (WHERE e.event_type = 'click')::int AS clicks,
      COUNT(DISTINCT e.creator_id) FILTER (
        WHERE e.creator_id IS NOT NULL AND e.creator_id <> ${brandUserId}
      )::int AS active_creators
    FROM analytics_events e
    WHERE e.created_at >= ${from} AND e.created_at < ${now}
      AND (
        e.product_id IN (SELECT id FROM bp)
        OR (e.product_id IS NULL AND e.video_id IN (SELECT id FROM sv))
      )
  `)) as unknown as Rows<{ views: number; clicks: number; active_creators: number }>;
  const ev = events.rows[0] ?? { views: 0, clicks: 0, active_creators: 0 };

  const sales = await salesFor({ brandUserId }, from, now, days);
  const views = Number(ev.views) || 0;
  const clicks = Number(ev.clicks) || 0;
  return {
    since: from.toISOString(),
    ...sales,
    views,
    clicks,
    ctr: ctrOf(views, clicks),
    activeCreators: Number(ev.active_creators) || 0,
  };
}

export async function creatorMonthStats(creatorId: string, now: Date = new Date()): Promise<MonthStats> {
  const { db } = await import("./db");
  const from = monthStartUtc(now);
  const days = daysInPeriod(from, now);

  // analytics_events.creator_id is denormalized at write time and indexed with
  // created_at (analytics_events_creator_period_idx), so this is one range scan.
  const events = (await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE event_type = 'view')::int AS views,
      COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks
    FROM analytics_events
    WHERE creator_id = ${creatorId} AND created_at >= ${from} AND created_at < ${now}
  `)) as unknown as Rows<{ views: number; clicks: number }>;
  const ev = events.rows[0] ?? { views: 0, clicks: 0 };

  const sales = await salesFor({ creatorId }, from, now, days);
  const views = Number(ev.views) || 0;
  const clicks = Number(ev.clicks) || 0;
  return { since: from.toISOString(), ...sales, views, clicks, ctr: ctrOf(views, clicks) };
}
