/**
 * Admin CRM and partner inactivity (client, 22 Nov 2026): the facts behind
 * shared/crm.ts. One row per account (the team's own admin accounts are left
 * out, as on the Activity tab and in the snapshot email).
 *
 * VIEWS, SALES AND REVENUE are all time and counted as each account's own
 * dashboard counts them (server/creatorDashboard.ts):
 *   creator    views of the videos they made; orders from those videos.
 *   brand      views of the videos they uploaded, that feature their products
 *              or that one of their orders came from; their own orders only.
 *   publisher  views and orders that came through their own reposts.
 * A partner is shown with the numbers of the account type they joined as.
 * One row per real order: a store order (fee accrual), an in-video order with
 * no accrual, or a sale recorded by hand. Revenue is in US dollars.
 *
 * users.crm_company, crm_notes and archived_at, and program_senders
 * .deactivated_at and .reactivated_at, are read and written only here.
 */
import { sql, type SQL } from "drizzle-orm";
import {
  PARTNER_DEACTIVATE_DAYS, PARTNER_INACTIVE_DAYS, conversionPct, crmStatus, crmType, daysSince, firstName,
  partnerState, trialProgress, type CrmReport, type CrmRow,
} from "@shared/crm";
import { convertCents, type UsdRates } from "./creatorDashboard";
import { usdRate } from "./fx";
import { getPlatformCurrency } from "./feeConfig";

type Db = { execute: (q: any) => Promise<{ rows: any[] }> };
async function database(): Promise<Db> {
  return (await import("./db")).db as unknown as Db;
}

/**
 * Who each partner brought in: (partner_id, user_id, joined_at), credited the
 * way server/partners.ts credits a sale. The first code an account joined
 * with names the partner, or is one of the partner's program invites, or an
 * invite from the partner's own brand; plus creators invited by a brand the
 * partner brought in.
 */
export function partnerRefsSql(): SQL {
  return sql`
    with firsts as (
      select distinct on (r.user_id) r.user_id, r.redeemed_at, v.referrer_user_id, v.batch_id
      from voucher_redemptions r join vouchers v on v.id = r.voucher_id
      order by r.user_id, r.redeemed_at
    ),
    direct as (
      select coalesce(f.referrer_user_id,
          case when f.batch_id like 'program:%' then split_part(f.batch_id, ':', 2)
               when f.batch_id like 'invite:%' then (select b.owner_id from brands b where 'invite:' || b.id = f.batch_id limit 1)
          end) as partner_id,
        f.user_id, f.redeemed_at
      from firsts f
    )
    select d.partner_id, d.user_id, d.redeemed_at as joined_at
    from direct d join program_senders ps on ps.user_id = d.partner_id and ps.commission_pct is not null
    where d.user_id <> d.partner_id
    union
    select d.partner_id, f.user_id, f.redeemed_at
    from firsts f
    join brands b on f.batch_id = 'invite:' || b.id
    join direct d on d.user_id = b.owner_id
    join program_senders ps on ps.user_id = d.partner_id and ps.commission_pct is not null
    where f.referrer_user_id is null and f.user_id <> d.partner_id`;
}

/** Each partner's last activity and how many accounts they brought in. */
export function partnerActivitySql(): SQL {
  return sql`
    with refs as (${partnerRefsSql()})
    select ps.user_id, ps.program_name, ps.commission_pct, ps.commission_until, ps.deactivated_at,
      (select count(*) from refs r where r.partner_id = ps.user_id)::int as referrals,
      greatest(
        ps.created_at,
        coalesce(ps.reactivated_at, ps.created_at),
        coalesce(u.last_seen_at, ps.created_at),
        coalesce(u.last_login_at, ps.created_at),
        coalesce((select max(r.joined_at) from refs r where r.partner_id = ps.user_id), ps.created_at),
        coalesce((select max(v.created_at) from videos v join refs r on r.user_id = v.creator_id where r.partner_id = ps.user_id), ps.created_at),
        coalesce((select max(c.created_at) from commission_transactions c where c.affiliate_id = ps.user_id and c.kind = 'partner'), ps.created_at)
      ) as last_activity
    from program_senders ps join users u on u.id = ps.user_id
    where ps.commission_pct is not null`;
}

/**
 * The daily job: switch off the partner status of every partner with no
 * activity for 60 days. Returns who was switched off. Admin switches a
 * partner back on from the CRM, which restarts the count.
 */
export async function sweepPartnerInactivity(now: Date = new Date()): Promise<{ userId: string; name: string }[]> {
  const db = await database();
  const cutoff = new Date(now.getTime() - PARTNER_DEACTIVATE_DAYS * 86_400_000);
  const r = await db.execute(sql`
    with act as (${partnerActivitySql()})
    update program_senders ps set deactivated_at = ${now}, updated_at = ${now}
    from act where act.user_id = ps.user_id and ps.deactivated_at is null and act.last_activity < ${cutoff}
    returning ps.user_id, ps.program_name`);
  return (r.rows as any[]).map((x) => ({ userId: x.user_id, name: x.program_name }));
}

/** Admin: switch a partner's status on or off by hand. On restarts the 60 days. */
export async function setPartnerActive(userId: string, active: boolean, now: Date = new Date()): Promise<boolean> {
  const db = await database();
  const r = active
    ? await db.execute(sql`update program_senders set deactivated_at = null, reactivated_at = ${now}, updated_at = ${now}
        where user_id = ${userId} and commission_pct is not null returning user_id`)
    : await db.execute(sql`update program_senders set deactivated_at = ${now}, updated_at = ${now}
        where user_id = ${userId} and commission_pct is not null and deactivated_at is null returning user_id`);
  return r.rows.length > 0;
}

/** Admin: the company, the notes and Archived. Only the fields given are changed. */
export async function setCrmFields(userId: string, f: { company?: string; notes?: string; archived?: boolean }, now: Date = new Date()): Promise<boolean> {
  const sets: SQL[] = [];
  if (f.company !== undefined) sets.push(sql`crm_company = ${f.company.trim() || null}`);
  if (f.notes !== undefined) sets.push(sql`crm_notes = ${f.notes.trim() || null}`);
  if (f.archived !== undefined) sets.push(f.archived ? sql`archived_at = coalesce(archived_at, ${now})` : sql`archived_at = null`);
  if (sets.length === 0) return false;
  const db = await database();
  const r = await db.execute(sql`update users set ${sql.join(sets, sql`, `)} where id = ${userId} and not coalesce(is_admin, false) returning id`);
  return r.rows.length > 0;
}

/** Every real order, all time: video, its maker, the brand it was for, the Publisher it came through. */
function ordersSql(platformCurrency: string): SQL {
  return sql`
    select a.video_id, v.creator_id, a.brand_user_id, a.sale_cents::float8 as cents, lower(a.currency) as currency,
      coalesce(
        (select o.affiliate_id from video_orders o
          where a.store_connection_id is null and o.stripe_checkout_session_id = a.external_order_id limit 1),
        (select c.affiliate_id from commission_transactions c
          where c.external_order_id = a.external_order_id
            and c.store_connection_id is not distinct from a.store_connection_id
            and (c.kind = 'publisher' or (c.kind is null and c.affiliate_id <> v.creator_id))
          limit 1)
      ) as publisher_id
    from platform_fee_accruals a join videos v on v.id = a.video_id
    where a.attribution_state = 'attributed' and a.status <> 'void'
    union all
    select o.video_id, v.creator_id, o.brand_user_id, o.amount_cents::float8, lower(o.currency), o.affiliate_id
    from video_orders o join videos v on v.id = o.video_id
    where o.status = 'paid'
      and not exists (
        select 1 from platform_fee_accruals a
        where a.store_connection_id is null and a.external_order_id = o.stripe_checkout_session_id)
    union all
    select c.video_id, v.creator_id,
      (select b.owner_id from products p join brands b on b.id = p.brand_id where p.id = c.product_id limit 1),
      round(c.sale_amount * 100)::float8, ${platformCurrency},
      (select p.affiliate_id from commission_transactions p
        where p.external_order_id is null and p.video_id = c.video_id and p.sale_amount = c.sale_amount
          and p.analytics_event_id is not distinct from c.analytics_event_id
          and abs(extract(epoch from (p.created_at - c.created_at))) < 10
          and (p.kind = 'publisher' or (p.kind is null and p.affiliate_id <> v.creator_id))
        limit 1)
    from commission_transactions c join videos v on v.id = c.video_id
    where c.external_order_id is null
      and c.status not in ('reversed', 'rejected')
      and not exists (
        select 1 from commission_transactions e
        where e.external_order_id is null and e.id <> c.id and e.video_id = c.video_id
          and e.sale_amount = c.sale_amount
          and e.analytics_event_id is not distinct from c.analytics_event_id
          and abs(extract(epoch from (e.created_at - c.created_at))) < 10
          and (e.created_at < c.created_at or (e.created_at = c.created_at and e.id < c.id)))`;
}

type Tally = { views: number; sales: number; byCurrency: Map<string, number> };
const tally = (): Tally => ({ views: 0, sales: 0, byCurrency: new Map() });

export async function crmReport(now: Date = new Date()): Promise<CrmReport> {
  const db = await database();
  const platformCurrency = getPlatformCurrency().toLowerCase();

  const [accounts, partners, videos, views, sales] = await Promise.all([
    db.execute(sql`
      select u.id, u.email, u.display_name, u.username, u.role::text as role, u.created_at, u.last_seen_at, u.last_login_at,
        coalesce(u.free_access, false) as free_access, u.free_access_until, u.archived_at, u.crm_notes, u.crm_company,
        (select b.name from brands b where b.owner_id = u.id order by b.name limit 1) as brand_name,
        (select min(r.redeemed_at) from voucher_redemptions r where r.user_id = u.id) as first_redeemed
      from users u where not coalesce(u.is_admin, false)
      order by u.created_at desc
      limit 5000`),
    db.execute(partnerActivitySql()),
    db.execute(sql`select v.creator_id as uid, count(*)::int as n from videos v group by 1`),
    // Views three ways; each account takes the one for its own type.
    db.execute(sql`
      with bv as (
        select v.creator_id as uid, v.id as video_id from videos v
        union select b.owner_id, vp.video_id from video_products vp join products p on p.id = vp.product_id join brands b on b.id = p.brand_id
        union select b.owner_id, ov.video_id from video_product_overlays ov join products p on p.id = ov.product_id join brands b on b.id = p.brand_id
        union select a.brand_user_id, a.video_id from platform_fee_accruals a where a.video_id is not null
        union select o.brand_user_id, o.video_id from video_orders o
      )
      select 'creator' as kind, e.creator_id as uid, count(*)::int as n
        from analytics_events e join videos v on v.id = e.video_id
        where e.event_type = 'view' and e.creator_id = v.creator_id group by 2
      union all
      select 'publisher', e.affiliate_id, count(*)::int from analytics_events e
        where e.event_type = 'view' and e.affiliate_id is not null group by 2
      union all
      select 'brand', bv.uid, count(*)::int from analytics_events e join bv on bv.video_id = e.video_id
        where e.event_type = 'view' and bv.uid is not null group by 2`),
    db.execute(sql`
      with s as (${ordersSql(platformCurrency)})
      select 'creator' as kind, s.creator_id as uid, s.currency, count(*)::int as n, sum(s.cents)::float8 as cents from s where s.creator_id is not null group by 2, 3
      union all
      select 'brand', s.brand_user_id, s.currency, count(*)::int, sum(s.cents)::float8 from s where s.brand_user_id is not null group by 2, 3
      union all
      select 'publisher', s.publisher_id, s.currency, count(*)::int, sum(s.cents)::float8 from s where s.publisher_id is not null group by 2, 3`),
  ]);

  const key = (kind: string, uid: string) => `${kind}:${uid}`;
  const tallies = new Map<string, Tally>();
  const get = (k: string) => { let t = tallies.get(k); if (!t) { t = tally(); tallies.set(k, t); } return t; };
  for (const r of views.rows) get(key(r.kind, r.uid)).views += Number(r.n) || 0;
  const currencies = new Set<string>();
  for (const r of sales.rows) {
    const t = get(key(r.kind, r.uid));
    t.sales += Number(r.n) || 0;
    const cur = String(r.currency || platformCurrency).toLowerCase();
    currencies.add(cur);
    t.byCurrency.set(cur, (t.byCurrency.get(cur) ?? 0) + (Number(r.cents) || 0));
  }
  const usdPer: UsdRates = { usd: 1 };
  await Promise.all(Array.from(currencies).filter((c) => c !== "usd").map(async (c) => {
    const r = await usdRate(c).catch(() => null);
    if (r) usdPer[c] = r.rate;
  }));

  const videoCount = new Map<string, number>(videos.rows.map((r) => [r.uid as string, Number(r.n) || 0]));
  const partnerById = new Map<string, any>(partners.rows.map((r) => [r.user_id as string, r]));
  const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

  const rows: CrmRow[] = accounts.rows.map((u) => {
    const p = partnerById.get(u.id);
    const accountType = crmType(u.role, false) as CrmRow["accountType"];
    const t = tallies.get(key(accountType, u.id)) ?? tally();
    let grossCents = 0;
    t.byCurrency.forEach((cents, cur) => { grossCents += convertCents(cents, cur, "usd", usdPer) ?? 0; });
    const lastUsedAt = iso(u.last_seen_at) ?? iso(u.last_login_at) ?? iso(u.created_at);
    const pState = p ? partnerState(p.last_activity, p.deactivated_at, now) : null;
    const pct = p && p.commission_pct != null && (!p.commission_until || new Date(p.commission_until).getTime() > now.getTime())
      ? Number(p.commission_pct) : null;
    const name = (u.display_name || u.username || "").trim();
    return {
      id: u.id,
      type: crmType(u.role, !!p),
      accountType,
      firstName: firstName(name, u.email),
      name,
      email: u.email ?? "",
      company: (u.crm_company || u.brand_name || p?.program_name || "").trim(),
      status: crmStatus({ archivedAt: u.archived_at, lastUsedAt, partner: pState }, now),
      notes: u.crm_notes ?? "",
      createdAt: iso(u.created_at) ?? now.toISOString(),
      lastUsedAt,
      trial: trialProgress({ freeAccess: !!u.free_access, start: u.first_redeemed ?? u.created_at, end: u.free_access_until }, now),
      videos: videoCount.get(u.id) ?? 0,
      views: t.views,
      sales: t.sales,
      conversionPct: conversionPct(t.sales, t.views),
      grossCents: Math.round(grossCents),
      partner: p ? {
        state: pState!,
        pct,
        lastActivityAt: iso(p.last_activity),
        daysQuiet: daysSince(p.last_activity, now),
        referrals: Number(p.referrals) || 0,
        deactivatedAt: iso(p.deactivated_at),
      } : null,
    };
  });

  return { currency: "usd", rows, rules: { inactiveDays: PARTNER_INACTIVE_DAYS, deactivateDays: PARTNER_DEACTIVATE_DAYS } };
}
