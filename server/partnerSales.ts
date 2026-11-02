/**
 * A partner's own Sales view (client, 2 Nov 2026): every sale they were paid
 * on and how it split, and the people they brought in with the date each one
 * stops earning. Promised to Clipur, who asked to "validate the 90-day
 * referral credit" before choosing a pilot brand.
 *
 * Read-only, and only ever the asking partner's own rows. The other people on
 * a sale show as amounts (creator, publisher), never as names or emails,
 * except the creator and brand, whose names already appear on the video.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";
import { activeDealPct, partnerReferralDays } from "./partners";

const DAY = 86_400_000;

export interface PartnerSale {
  id: string;
  at: string;
  video: string;
  product: string | null;
  brand: string | null;
  creator: string | null;
  /** Which of the partner's referrals put them on this sale. */
  through: "brand" | "creator" | "both" | null;
  saleCents: number;
  brandCents: number;
  creatorCents: number;
  publisherCents: number;
  otherPartnersCents: number;
  youCents: number;
  youPct: number;
  mtrlzdCents: number;
  status: string;
}

export interface PartnerReferral {
  userId: string;
  name: string;
  role: "brand" | "creator" | "publisher";
  joinedAt: string;
  /** Counted from here: the referral's own sign-up, or its brand's. */
  countsFrom: string;
  earnsUntil: string;
  /** Joined on a brand's invite, so counted from that brand. */
  viaBrand: string | null;
  earning: boolean;
}

export interface PartnerSalesReport {
  deal: { pct: number | null; until: string | null; accountActive: boolean; referralDays: number };
  totals: { sales: number; saleCents: number; youCents: number; pendingCents: number; paidCents: number };
  sales: PartnerSale[];
  referrals: PartnerReferral[];
}

const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const iso = (v: unknown) => new Date(v as string).toISOString();

/**
 * One sale as the partner sees it. The brand's share is worked out at the fee
 * in force now (the fee itself isn't stored per sale); MTRLZD's is whatever is
 * left, the same way computeSaleSplit leaves it.
 */
export function shapeSale(r: {
  id: string; created_at: unknown; sale_amount: unknown; commission_rate: unknown; commission_amount: unknown; status: string | null;
  video_title: string | null; product_name: string | null; brand_name: string | null; creator_name: string | null;
  creator_amount: unknown; publisher_amount: unknown; other_partners: unknown;
  via_creator: boolean | null; via_brand: boolean | null;
}, feePct: number): PartnerSale {
  const saleCents = cents(r.sale_amount);
  const feeCents = Math.round((saleCents * feePct) / 100);
  const creatorCents = cents(r.creator_amount);
  const publisherCents = cents(r.publisher_amount);
  const otherPartnersCents = cents(r.other_partners);
  const youCents = cents(r.commission_amount);
  return {
    id: r.id,
    at: iso(r.created_at),
    video: r.video_title ?? "Video",
    product: r.product_name,
    brand: r.brand_name,
    creator: r.creator_name,
    through: r.via_brand && r.via_creator ? "both" : r.via_brand ? "brand" : r.via_creator ? "creator" : null,
    saleCents,
    brandCents: saleCents - feeCents,
    creatorCents,
    publisherCents,
    otherPartnersCents,
    youCents,
    youPct: Number(r.commission_rate ?? 0),
    mtrlzdCents: feeCents - creatorCents - publisherCents - otherPartnersCents - youCents,
    status: r.status ?? "pending",
  };
}

/** A referral earns its partner until `days` after it (or its brand) joined. */
export function shapeReferral(r: {
  user_id: string; name: string | null; role: string | null; joined_at: unknown; counts_from: unknown; via_brand: string | null;
}, now: Date, days = partnerReferralDays()): PartnerReferral {
  const from = new Date(r.counts_from as string);
  const until = new Date(from.getTime() + days * DAY);
  const role = r.role === "brand" ? "brand" : r.role === "affiliate" ? "publisher" : "creator";
  return {
    userId: r.user_id,
    name: r.name || "Unnamed account",
    role,
    joinedAt: iso(r.joined_at),
    countsFrom: from.toISOString(),
    earnsUntil: until.toISOString(),
    viaBrand: r.via_brand,
    earning: now.getTime() < until.getTime(),
  };
}

/** Money that counts: refunded and rejected rows are listed but not added up. */
export function totalsOf(sales: PartnerSale[]): PartnerSalesReport["totals"] {
  const live = sales.filter((s) => s.status !== "reversed" && s.status !== "rejected");
  return {
    sales: live.length,
    saleCents: live.reduce((n, s) => n + s.saleCents, 0),
    youCents: live.reduce((n, s) => n + s.youCents, 0),
    pendingCents: live.filter((s) => s.status === "pending" || s.status === "approved").reduce((n, s) => n + s.youCents, 0),
    paidCents: live.filter((s) => s.status === "paid").reduce((n, s) => n + s.youCents, 0),
  };
}

/**
 * Everyone credited to this partner, the same way server/partners.ts credits
 * a sale: the first code each account joined with, named to the partner or
 * from one of its program invites, plus creators who joined on the invite of
 * a brand the partner brought in (counted from that brand).
 */
async function referralRows(partnerId: string) {
  const r = await db.execute(sql`
    with firsts as (
      select distinct on (r.user_id) r.user_id, r.redeemed_at, v.referrer_user_id, v.batch_id
      from voucher_redemptions r join vouchers v on v.id = r.voucher_id
      order by r.user_id, r.redeemed_at
    ),
    direct as (
      select f.user_id, f.redeemed_at from firsts f
      where f.user_id <> ${partnerId} and (
        f.referrer_user_id = ${partnerId}
        or (f.referrer_user_id is null and (f.batch_id = ${"program:" + partnerId} or f.batch_id like ${"program:" + partnerId + ":%"}))
      )
    ),
    via as (
      select f.user_id, f.redeemed_at, d.redeemed_at as brand_since, b.name as brand_name from firsts f
      join brands b on f.batch_id = 'invite:' || b.id
      join direct d on d.user_id = b.owner_id
      where f.referrer_user_id is null and f.user_id <> ${partnerId}
    )
    select d.user_id, coalesce(nullif(bo.name, ''), u.display_name, u.username) as name, u.role::text as role,
      d.redeemed_at as joined_at, d.redeemed_at as counts_from, null::text as via_brand
    from direct d join users u on u.id = d.user_id
    left join lateral (select name from brands where owner_id = d.user_id order by name limit 1) bo on true
    union all
    select x.user_id, coalesce(u.display_name, u.username), u.role::text, x.redeemed_at, x.brand_since, x.brand_name
    from via x join users u on u.id = x.user_id
    order by 4 desc
    limit 2000`);
  return r.rows as any[];
}

async function saleRows(partnerId: string) {
  const r = await db.execute(sql`
    select p.id, p.created_at, p.sale_amount, p.commission_rate, p.commission_amount, p.status::text as status,
      v.title as video_title, pr.name as product_name, coalesce(pb.name, vb.name) as brand_name,
      coalesce(cu.display_name, cu.username) as creator_name, v.creator_id, coalesce(pb.owner_id, vb.owner_id) as brand_owner_id,
      s.creator_amount, s.publisher_amount, s.other_partners
    from commission_transactions p
    join videos v on v.id = p.video_id
    left join users cu on cu.id = v.creator_id
    left join products pr on pr.id = p.product_id
    left join brands pb on pb.id = pr.brand_id
    left join lateral (
      select b.name, b.owner_id from video_brands x join brands b on b.id = x.brand_id where x.video_id = p.video_id limit 1
    ) vb on true
    left join lateral (
      -- The other rows written for the same sale: same order, or (no order id)
      -- the same video, amount and event within a few seconds.
      select
        coalesce(sum(o.commission_amount) filter (where o.kind = 'creator' or (o.kind is null and o.affiliate_id = v.creator_id)), 0) as creator_amount,
        coalesce(sum(o.commission_amount) filter (where o.kind = 'publisher' or (o.kind is null and o.affiliate_id <> v.creator_id)), 0) as publisher_amount,
        coalesce(sum(o.commission_amount) filter (where o.kind = 'partner'), 0) as other_partners
      from commission_transactions o
      where o.id <> p.id and o.affiliate_id <> p.affiliate_id and o.video_id = p.video_id and o.sale_amount = p.sale_amount
        and (
          (p.external_order_id is not null and o.external_order_id = p.external_order_id
            and o.store_connection_id is not distinct from p.store_connection_id)
          or (p.external_order_id is null and o.external_order_id is null
            and o.analytics_event_id is not distinct from p.analytics_event_id
            and abs(extract(epoch from (o.created_at - p.created_at))) < 10)
        )
    ) s on true
    where p.affiliate_id = ${partnerId} and p.kind = 'partner'
    order by p.created_at desc
    limit 1000`);
  return r.rows as any[];
}

export async function partnerSalesReport(partnerId: string, feePct: number, now = new Date()): Promise<PartnerSalesReport> {
  const [dealRow] = (await db.execute(sql`
    select ps.commission_pct, ps.commission_until,
      (exists (select 1 from brand_subscriptions s where s.user_id = u.id and s.status in ('active', 'trialing'))
        or (u.free_access and (u.free_access_until is null or u.free_access_until > ${now}))) as active
    from program_senders ps join users u on u.id = ps.user_id where ps.user_id = ${partnerId}`)).rows as any[];

  const refRows = await referralRows(partnerId);
  const referrals = refRows.map((r) => shapeReferral(r, now));
  const refIds = new Set(refRows.map((r) => r.user_id as string));

  const sales = (await saleRows(partnerId)).map((r) => shapeSale({
    ...r,
    via_creator: !!r.creator_id && refIds.has(r.creator_id),
    via_brand: !!r.brand_owner_id && refIds.has(r.brand_owner_id),
  }, feePct));

  return {
    deal: {
      // The % as it would apply now; null when there is no deal or it has ended.
      pct: dealRow ? activeDealPct(dealRow, now) : null,
      until: dealRow?.commission_until ? iso(dealRow.commission_until) : null,
      accountActive: !!dealRow?.active,
      referralDays: partnerReferralDays(),
    },
    totals: totalsOf(sales),
    sales,
    referrals,
  };
}
