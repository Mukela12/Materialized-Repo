/**
 * Partner commissions (client, 24-25 Oct 2026). Partners (agencies, influencer
 * platforms, Creative Advisors, event organisers) earn a % of the gross sales
 * of the creators and brands they brought in, for the term of their deal,
 * out of MTRLZD's marketplace fee:
 *
 *   - a creator's partner is whoever is credited on the code they joined with
 *     (an Advisor's own named code, or a partner's program invite);
 *   - a creator who joined on a BRAND's invite is credited to whoever brought
 *     that brand in ("the 10 creators per brand"), one level deep;
 *   - a brand's partner is whoever is credited on the code the brand joined with.
 *
 * The deal itself (%, 1-3, default 2; until when) lives on program_senders.
 * Each partner is paid once per sale, never on a sale of their own, and the
 * total never eats into the reserve (server/feeConfig.ts computeSaleSplit).
 *
 * Two limits (client, 26 Oct 2026):
 *   - a partner earns only while their own MTRLZD account is active (a plan,
 *     a trial or free access). "If they unsubscribe, their referrals remain on
 *     mtrlzd as independent users and the Partner's fee is absorbed by mtrlzd."
 *   - on each referral for 90 days from when it joined, counted from the
 *     account the partner brought in (a brand's creators count from the
 *     brand), "to encourage their continued brand referrals".
 */
import { sql } from "drizzle-orm";
import { db } from "./db";
import { resolveFeeConfig, userRateOr, type SplitRates } from "./feeConfig";

export const PARTNER_PCT = { min: 1, max: 3, default: 2 } as const;

/** How long a partner earns on one referral. */
export function partnerReferralDays(): number {
  const n = Number(process.env.PARTNER_REFERRAL_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 90;
}

/** Whether a referral that joined at `since` still earns its partner at `now`. */
export function withinReferralWindow(since: Date | string, now: Date, days = partnerReferralDays()): boolean {
  return now.getTime() < new Date(since).getTime() + days * 86_400_000;
}

/** A partner's % if their deal is active at `now`, else null. */
export function activeDealPct(deal: { commission_pct: string | number | null; commission_until: string | Date | null } | undefined, now: Date): number | null {
  if (!deal || deal.commission_pct == null) return null;
  const pct = Number(deal.commission_pct);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  if (deal.commission_until && new Date(deal.commission_until).getTime() <= now.getTime()) return null;
  return Math.min(PARTNER_PCT.max, pct);
}

/** A per-person override (creator bonus or publisher rate), if it hasn't ended. */
export function activeOverride(user: { commissionRateOverride?: string | number | null; commissionOverrideUntil?: Date | string | null } | null | undefined, now: Date): string | number | null {
  if (!user || user.commissionRateOverride == null) return null;
  if (user.commissionOverrideUntil && new Date(user.commissionOverrideUntil).getTime() <= now.getTime()) return null;
  return user.commissionRateOverride;
}

/**
 * Who brought this account in, and when the account they referred joined:
 * the partner credited on the code it joined with. A creator invited by a
 * brand is credited to whoever brought the brand in, from the brand's date.
 */
async function creditedPartner(userId: string, depth = 0): Promise<{ partnerId: string; since: Date } | null> {
  const r = await db.execute(sql`
    select v.referrer_user_id, v.batch_id, r.redeemed_at from voucher_redemptions r join vouchers v on v.id = r.voucher_id
    where r.user_id = ${userId} order by r.redeemed_at limit 1`);
  const row = r.rows[0] as { referrer_user_id: string | null; batch_id: string | null; redeemed_at: string | Date } | undefined;
  if (!row) return null;
  const since = new Date(row.redeemed_at);
  if (row.referrer_user_id) return { partnerId: row.referrer_user_id, since };
  const batch = row.batch_id ?? "";
  if (batch.startsWith("program:")) {
    const id = batch.split(":")[1];
    return id ? { partnerId: id, since } : null;
  }
  // Invited by a brand: credit whoever brought the brand in (one level only).
  if (batch.startsWith("invite:") && depth === 0) {
    const b = await db.execute(sql`select owner_id from brands where id = ${batch.slice("invite:".length)}`);
    const owner = (b.rows[0] as { owner_id: string | null } | undefined)?.owner_id;
    return owner ? creditedPartner(owner, 1) : null;
  }
  return null;
}

/**
 * The partners paid on a sale, with their %. Distinct, active deals only, and
 * never the creator, the publisher or the brand themselves.
 */
export async function partnersForSale(args: {
  creatorId: string | null; brandOwnerId: string | null; publisherId: string | null; now?: Date;
}): Promise<Array<{ userId: string; pct: number }>> {
  const now = args.now ?? new Date();
  const ids = new Set<string>();
  for (const who of [args.creatorId, args.brandOwnerId]) {
    if (!who) continue;
    const c = await creditedPartner(who);
    if (!c || !withinReferralWindow(c.since, now)) continue;
    const p = c.partnerId;
    if (p !== args.creatorId && p !== args.brandOwnerId && p !== args.publisherId) ids.add(p);
  }
  if (ids.size === 0) return [];
  const list = Array.from(ids);
  // Only partners whose own account is active: a plan (or its trial), or free access.
  const deals = await db.execute(sql`
    select ps.user_id, ps.commission_pct, ps.commission_until from program_senders ps
    join users u on u.id = ps.user_id
    where ps.user_id in (${sql.join(list.map((id) => sql`${id}`), sql`, `)})
      and (
        exists (select 1 from brand_subscriptions s where s.user_id = u.id and s.status in ('active', 'trialing'))
        or (u.free_access and (u.free_access_until is null or u.free_access_until > ${now}))
      )`);
  const out: Array<{ userId: string; pct: number }> = [];
  for (const d of deals.rows as Array<{ user_id: string; commission_pct: string | null; commission_until: string | null }>) {
    const pct = activeDealPct(d, now);
    if (pct) out.push({ userId: d.user_id, pct });
  }
  return out;
}

/**
 * Every rate for one sale, the same way on every path (in-video checkout,
 * store webhooks, recorded sales): the admin's fee settings, each person's
 * override if it hasn't ended, and the partners.
 */
export async function saleRates(args: {
  settings: Parameters<typeof resolveFeeConfig>[0];
  creator: { id: string; commissionRateOverride?: string | null; commissionOverrideUntil?: Date | string | null } | null;
  publisher: { id: string; commissionRateOverride?: string | null; commissionOverrideUntil?: Date | string | null } | null;
  brandOwnerId: string | null;
  marketplaceFeePct?: number;
  now?: Date;
}): Promise<Required<Pick<SplitRates, "marketplaceFeePct" | "creatorPct" | "publisherPct" | "partners">>> {
  const now = args.now ?? new Date();
  const cfg = resolveFeeConfig(args.settings);
  return {
    marketplaceFeePct: args.marketplaceFeePct ?? cfg.marketplaceFeePct,
    creatorPct: userRateOr(activeOverride(args.creator, now), cfg.creatorPct),
    publisherPct: userRateOr(activeOverride(args.publisher, now), cfg.publisherPct),
    partners: await partnersForSale({
      creatorId: args.creator?.id ?? null, brandOwnerId: args.brandOwnerId, publisherId: args.publisher?.id ?? null, now,
    }),
  };
}

/** The most anyone can earn on a sale: the 15% fee less the 7% reserve. */
export const MAX_PERSON_PCT = 8;

/**
 * An admin's bulk commission change, checked: who, what % (null clears it)
 * and until when (the last day, so it ends the morning after; null = no end).
 */
export function checkCommissionEdit(b: Record<string, unknown>): { error: string } | { userIds: string[]; pct: string | null; until: Date | null } {
  const userIds = Array.isArray(b.userIds) ? Array.from(new Set(b.userIds.filter((x): x is string => typeof x === "string" && x.length > 0))) : [];
  if (userIds.length === 0) return { error: "Choose at least one person" };
  if (userIds.length > 1000) return { error: "Up to 1,000 people at a time" };
  const raw = b.pct == null ? "" : String(b.pct).trim();
  if (raw === "") return { userIds, pct: null, until: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_PERSON_PCT) {
    return { error: `Commission is 0 to ${MAX_PERSON_PCT}%. 7% of the 15% always stays for Stripe and MTRLZD` };
  }
  const day = b.until == null ? "" : String(b.until).trim();
  let until: Date | null = null;
  if (day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "That end date doesn't look right" };
    until = new Date(`${day}T00:00:00Z`);
    if (Number.isNaN(until.getTime())) return { error: "That end date doesn't look right" };
    until.setUTCDate(until.getUTCDate() + 1);
  }
  return { userIds, pct: n.toFixed(2), until };
}
