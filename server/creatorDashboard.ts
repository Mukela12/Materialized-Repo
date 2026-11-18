/**
 * The creator dashboard (client, 16 Nov 2026): averages for a period against
 * the period before, sales by where they came from, a chart, a row per video,
 * and Paid vs Upcoming payouts, in the currency the creator picks.
 *
 * WHAT EACH NUMBER IS COUNTED FROM
 *
 *   Views, clicks   analytics_events ('view', 'click') on the creator's videos.
 *                   Views are already one per viewer per video per day.
 *   View duration   video_watch_time (server/watchTime.ts): seconds watched
 *                   per viewing, over viewings that played at least a second.
 *   Reposts         Someone other than the creator first picking up one of
 *                   their videos, counted once per (account, video) at the
 *                   earliest of: a live embed seen on a site
 *                   (embed_deployments), a repost code issued on a campaign
 *                   (campaign_affiliates), a paid library licence
 *                   (video_license_purchases), or a published playlist
 *                   holding it (playlist_items). The account's role says
 *                   whether a brand or a Publisher reposted it.
 *   Sales           One row per real order, never one per commission row
 *                   (a sale writes up to four of those). See SALES below.
 *   Commission      commission_transactions earned by the creator (any kind),
 *                   less refunded and rejected rows.
 *   Payouts         The same commission rows plus brand subscription bonuses
 *                   (creator_bonuses), which the same Monday run pays.
 *
 * SALES, AND WHY NOTHING IS COUNTED TWICE. Every verified order writes one
 * platform_fee_accruals row (store webhook and in-video checkout alike), the
 * same rule the "This month" panel uses (server/dashboardStats.ts). So:
 *   a: attributed, not voided accruals on the creator's videos, plus
 *   o: paid in-video orders with NO accrual for their checkout session (the
 *      accrual write failed silently before migration 0017), plus
 *   c: sales recorded by hand through POST /api/sales, which write commission
 *      rows only and never carry an order id, so no accrual can exist for
 *      them. Their rows for one sale (creator, publisher, partners) are
 *      written together, so only the earliest of each group is taken.
 * The three cannot overlap: (a) and (o) are split by whether the accrual
 * exists, and (c) only takes rows with no order id, which (a) and (o) never
 * have. Store orders whose accrual is missing are not counted.
 *
 * WHERE A SALE CAME FROM: the publisher on the order (video_orders.affiliate_id
 * for in-video sales, else the sale's publisher commission row). None, or the
 * creator themself (a video's own link credits its creator), is the creator's
 * own audience; an account with the brand role is a brand repost; anyone else
 * is a Publisher.
 *
 * WHOSE NUMBERS (18 Nov 2026). The same counting serves brands and
 * Publishers too, each scoped to their own (see DashboardAudience):
 *   brand      the videos it uploaded, that feature its products or that its
 *              orders came from, with every repost's views; sales are only the
 *              brand's own orders; "commission" is the creator and Publisher
 *              commission written on those orders.
 *   publisher  only events, viewings (video_watch_time.affiliate_id) and
 *              sales credited to them, over the videos they reposted; their
 *              "reposts" are the videos they picked up in the period.
 *
 * CURRENCY. Amounts are converted at today's ECB reference rate (server/fx.ts),
 * not the rate on the day of each sale. If the chosen currency's rate cannot
 * be had, everything is shown in US dollars and marked approximate.
 */
import { sql, type SQL } from "drizzle-orm";
import { VIDEO_CATEGORY_OPTIONS } from "@shared/schema";
import {
  DASHBOARD_AUDIENCES,
  DASHBOARD_CURRENCIES,
  type CreatorDashboard,
  type DashboardAudience,
  type DashboardCurrency,
  type DashboardPayouts,
  type DashboardProduct,
  type DashboardViewSource,
  type DashboardSeriesPoint,
  type DashboardTotals,
  type DashboardVideoRow,
  type SaleSource,
  type SalesBySource,
} from "@shared/creatorDashboard";
import { getPlatformCurrency } from "./feeConfig";
import { usdRate } from "./fx";
import { commissionHoldDays, payableFrom } from "./commissionHold";

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Longest period the dashboard will answer for. */
export const MAX_PERIOD_DAYS = 400;

// ─── The query ────────────────────────────────────────────────────────────────

export interface DashboardQuery {
  from: Date;
  to: Date;
  category: string | null;
  currency: DashboardCurrency;
}

/**
 * ?from=ISO&to=ISO&category=&currency=usd. No dates means the last 30 days.
 * An end in the future is brought back to now, so a range ending today does
 * not compare against a longer previous period than it covers.
 */
export function parseDashboardQuery(
  q: Record<string, unknown>,
  now: Date = new Date(),
): { ok: true; value: DashboardQuery } | { ok: false; error: string } {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const fromRaw = str(q.from);
  const toRaw = str(q.to);
  let to = toRaw ? new Date(toRaw) : now;
  const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - 30 * DAY);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return { ok: false, error: "from and to must be dates" };
  if (to.getTime() > now.getTime()) to = now;
  if (from.getTime() >= to.getTime()) return { ok: false, error: "from must be before to" };
  if (to.getTime() - from.getTime() > MAX_PERIOD_DAYS * DAY) return { ok: false, error: `Pick a period of ${MAX_PERIOD_DAYS} days or less` };

  const cat = str(q.category).toLowerCase();
  let category: string | null = null;
  if (cat && cat !== "all") {
    if (!VIDEO_CATEGORY_OPTIONS.some((o) => o.value === cat)) return { ok: false, error: "Unknown category" };
    category = cat;
  }

  const cur = (str(q.currency) || "usd").toLowerCase();
  if (!(DASHBOARD_CURRENCIES as readonly string[]).includes(cur)) return { ok: false, error: "Unsupported currency" };
  return { ok: true, value: { from, to, category, currency: cur as DashboardCurrency } };
}

// ─── Period maths ─────────────────────────────────────────────────────────────

/** The same length of time immediately before [from, to). */
export function previousWindow(from: Date, to: Date): { from: Date; to: Date } {
  const len = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - len), to: new Date(from.getTime()) };
}

/** Hourly for a day or two, daily otherwise. */
export function bucketUnit(from: Date, to: Date): "hour" | "day" {
  return to.getTime() - from.getTime() <= 2 * DAY ? "hour" : "day";
}

/** Bucket key for an instant, in UTC: "YYYY-MM-DD" or "YYYY-MM-DDTHH". */
export function bucketKey(at: Date, unit: "hour" | "day"): string {
  const iso = at.toISOString();
  return unit === "day" ? iso.slice(0, 10) : iso.slice(0, 13);
}

/** Every bucket from `from` up to (not including) `to`, in order. */
export function bucketKeys(from: Date, to: Date, unit: "hour" | "day"): string[] {
  const step = unit === "day" ? DAY : HOUR;
  const start = unit === "day"
    ? Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
    : Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), from.getUTCHours());
  const out: string[] = [];
  for (let t = start; t < to.getTime(); t += step) out.push(bucketKey(new Date(t), unit));
  return out;
}

// ─── Classification and money ─────────────────────────────────────────────────

/** Where a sale came from. See the file header. */
export function classifySaleSource(publisherId: string | null | undefined, creatorId: string, publisherRole: string | null | undefined): SaleSource {
  if (!publisherId || publisherId === creatorId) return "own";
  return publisherRole === "brand" ? "brand" : "publisher";
}

/** US dollars per one unit of each currency, lower-case keys. */
export type UsdRates = Record<string, number | undefined>;

/** Cents of `from` in `to`, or null when either rate is unknown. */
export function convertCents(cents: number, from: string, to: string, usdPer: UsdRates): number | null {
  const f = from.toLowerCase();
  const t = to.toLowerCase();
  if (f === t) return Math.round(cents);
  const rf = f === "usd" ? 1 : usdPer[f];
  const rt = t === "usd" ? 1 : usdPer[t];
  if (!rf || !rt) return null;
  return Math.round((cents * rf) / rt);
}

/** total / count, to one decimal place; 0 for nothing to divide by. */
export function perVideo(total: number, videoCount: number): number {
  return videoCount > 0 ? Math.round((total / videoCount) * 10) / 10 : 0;
}

// ─── Folding rows into numbers ────────────────────────────────────────────────

export interface VideoFacts {
  views: number;
  clicks: number;
  watchSessions: number;
  /** Viewings that reached 90% of the video. */
  watchCompleted: number;
  watchSeconds: number;
  watchVideoSeconds: number;
  repostsByBrand: number;
  repostsByPublisher: number;
  sales: SalesBySource;
  grossCents: number;
  commissionCents: number;
}

export function emptyFacts(): VideoFacts {
  return {
    views: 0, clicks: 0, watchSessions: 0, watchCompleted: 0, watchSeconds: 0, watchVideoSeconds: 0,
    repostsByBrand: 0, repostsByPublisher: 0,
    sales: { own: 0, publisher: 0, brand: 0, total: 0 }, grossCents: 0, commissionCents: 0,
  };
}

/** The raw rows for one period, as the queries return them. */
export interface WindowRows {
  events: { video_id: string; t: string; views: number; clicks: number }[];
  watch: { video_id: string; t: string; sessions: number; completed: number; seconds: number; video_seconds: number }[];
  reposts: { video_id: string; t: string; role: string | null; n: number }[];
  /** creator_id is the video's maker: a sale they brought in themself is "own". */
  sales: { k: string; video_id: string; t: string; cents: number; currency: string; publisher_id: string | null; role: string | null; creator_id?: string | null }[];
  commissions: { video_id: string; t: string; currency: string; cents: number }[];
}

export interface Folded {
  perVideo: Map<string, VideoFacts>;
  series: Map<string, DashboardSeriesPoint>;
  /** True when some amount could not be converted and was counted as is. */
  approximate: boolean;
}

/**
 * Add one period's rows up, per video and per bucket, in the target currency.
 * `creatorId` is the fallback maker for sale rows that do not name one.
 */
export function foldWindow(rows: WindowRows, creatorId: string, target: string, usdPer: UsdRates): Folded {
  const perVideo = new Map<string, VideoFacts>();
  const series = new Map<string, DashboardSeriesPoint>();
  let approximate = false;
  const v = (id: string) => {
    let f = perVideo.get(id);
    if (!f) { f = emptyFacts(); perVideo.set(id, f); }
    return f;
  };
  const s = (t: string) => {
    let p = series.get(t);
    if (!p) { p = { t, views: 0, clicks: 0, sales: 0, grossCents: 0 }; series.set(t, p); }
    return p;
  };
  const money = (cents: number, currency: string) => {
    const c = convertCents(Number(cents) || 0, currency || "usd", target, usdPer);
    if (c == null) { approximate = true; return Math.round(Number(cents) || 0); }
    return c;
  };

  for (const r of rows.events) {
    const f = v(r.video_id);
    f.views += Number(r.views) || 0;
    f.clicks += Number(r.clicks) || 0;
    const p = s(r.t);
    p.views += Number(r.views) || 0;
    p.clicks += Number(r.clicks) || 0;
  }
  for (const r of rows.watch) {
    const f = v(r.video_id);
    f.watchSessions += Number(r.sessions) || 0;
    f.watchCompleted += Number(r.completed) || 0;
    f.watchSeconds += Number(r.seconds) || 0;
    f.watchVideoSeconds += Number(r.video_seconds) || 0;
  }
  for (const r of rows.reposts) {
    const f = v(r.video_id);
    if (r.role === "brand") f.repostsByBrand += Number(r.n) || 0;
    else f.repostsByPublisher += Number(r.n) || 0;
  }
  const seen = new Set<string>();
  for (const r of rows.sales) {
    if (seen.has(r.k)) continue;
    seen.add(r.k);
    const f = v(r.video_id);
    const src = classifySaleSource(r.publisher_id, r.creator_id || creatorId, r.role);
    f.sales[src] += 1;
    f.sales.total += 1;
    const cents = money(r.cents, r.currency);
    f.grossCents += cents;
    const p = s(r.t);
    p.sales += 1;
    p.grossCents += cents;
  }
  for (const r of rows.commissions) {
    v(r.video_id).commissionCents += money(r.cents, r.currency);
  }
  return { perVideo, series, approximate };
}

/** part / whole as a percentage to one decimal place; 0 with nothing to divide by. */
export function rate(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

/** Totals and per-video averages over a set of videos. */
export function buildTotals(facts: VideoFacts[], videoCount: number): DashboardTotals {
  const sum = (pick: (f: VideoFacts) => number) => facts.reduce((n, f) => n + pick(f), 0);
  const views = sum((f) => f.views);
  const clicks = sum((f) => f.clicks);
  const watchSessions = sum((f) => f.watchSessions);
  const watchCompleted = sum((f) => f.watchCompleted);
  const watchSeconds = sum((f) => f.watchSeconds);
  const watchVideoSeconds = sum((f) => f.watchVideoSeconds);
  const repostsByBrand = sum((f) => f.repostsByBrand);
  const repostsByPublisher = sum((f) => f.repostsByPublisher);
  const sales: SalesBySource = {
    own: sum((f) => f.sales.own),
    publisher: sum((f) => f.sales.publisher),
    brand: sum((f) => f.sales.brand),
    total: sum((f) => f.sales.total),
  };
  const grossCents = sum((f) => f.grossCents);
  const reposts = repostsByBrand + repostsByPublisher;
  return {
    views,
    clicks,
    ctr: views > 0 ? Math.round((clicks / views) * 1000) / 10 : 0,
    watchSessions,
    watchSeconds,
    avgViewSeconds: watchSessions > 0 ? Math.round(watchSeconds / watchSessions) : 0,
    avgCompletionPct: watchVideoSeconds > 0 ? Math.min(100, Math.round((watchSeconds / watchVideoSeconds) * 100)) : 0,
    completionRate: rate(watchCompleted, watchSessions),
    // Capped: a sale can arrive without a tracked click (a store order from a
    // shared link), and "120% of clicks bought" would read as an error.
    conversionRate: Math.min(100, rate(sales.total, clicks)),
    reposts,
    repostsByBrand,
    repostsByPublisher,
    sales,
    grossCents,
    commissionCents: sum((f) => f.commissionCents),
    avg: {
      clicksPerVideo: perVideo(clicks, videoCount),
      repostsPerVideo: perVideo(reposts, videoCount),
      ownSalesPerVideo: perVideo(sales.own, videoCount),
      publisherSalesPerVideo: perVideo(sales.publisher, videoCount),
      brandSalesPerVideo: perVideo(sales.brand, videoCount),
      grossPerVideoCents: videoCount > 0 ? Math.round(grossCents / videoCount) : 0,
      orderValueCents: sales.total > 0 ? Math.round(grossCents / sales.total) : 0,
    },
  };
}

/**
 * Totals over the period's videos. Commission can also come from someone
 * else's video (a creator reposting as a Publisher): it counts in the
 * commission total, and nothing else from that video does.
 */
export function totalsForSet(perVideo: Map<string, VideoFacts>, ids: Set<string>, videoCount: number): DashboardTotals {
  const facts = Array.from(perVideo.entries()).map(([id, f]) => (ids.has(id) ? f : { ...emptyFacts(), commissionCents: f.commissionCents }));
  return buildTotals(facts, videoCount);
}

export interface DashboardVideo {
  id: string;
  title: string;
  thumbnail_url: string | null;
  creator_name?: string | null;
  categories: string | null;
  status: string | null;
  created_at: Date | string | null;
}

/** The first category on a video ("[\"travel\"]" is stored as JSON text). */
export function firstCategory(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && typeof arr[0] === "string" ? arr[0] : null;
  } catch {
    return null;
  }
}

/**
 * The videos the averages divide by: published by the end of the period, or
 * active in it (a draft can still be played through its embed).
 */
export function videosInPeriod(videos: DashboardVideo[], to: Date, active: Set<string>): DashboardVideo[] {
  return videos.filter((v) => {
    if (active.has(v.id)) return true;
    const created = v.created_at ? new Date(v.created_at).getTime() : 0;
    return v.status === "published" && created < to.getTime();
  });
}

export function videoRow(v: DashboardVideo, f: VideoFacts | undefined): DashboardVideoRow {
  const x = f ?? emptyFacts();
  return {
    videoId: v.id,
    title: v.title,
    thumbnailUrl: v.thumbnail_url ?? null,
    creatorName: v.creator_name ?? null,
    category: firstCategory(v.categories),
    views: x.views,
    clicks: x.clicks,
    ctr: x.views > 0 ? Math.round((x.clicks / x.views) * 1000) / 10 : 0,
    avgViewSeconds: x.watchSessions > 0 ? Math.round(x.watchSeconds / x.watchSessions) : 0,
    reposts: x.repostsByBrand + x.repostsByPublisher,
    sales: x.sales,
    grossCents: x.grossCents,
    commissionCents: x.commissionCents,
  };
}

/** Best sellers first, then most watched, then by title. */
export function sortVideoRows(rows: DashboardVideoRow[]): DashboardVideoRow[] {
  return [...rows].sort((a, b) =>
    b.grossCents - a.grossCents || b.sales.total - a.sales.total || b.views - a.views || a.title.localeCompare(b.title));
}

// ─── Top products and where views come from ───────────────────────────────────

export interface ProductRows {
  sales: { key: string; name: string | null; cents: number; currency: string }[];
  clicks: { key: string; name: string | null; n: number }[];
}

/**
 * The five products that sold most (then by sales value), with their clicks.
 * With no sales at all the list is simply ranked by clicks.
 */
export function topProducts(rows: ProductRows, convert: (cents: number, currency: string) => number, limit = 5): DashboardProduct[] {
  const by = new Map<string, DashboardProduct>();
  const get = (key: string, name: string | null) => {
    let p = by.get(key);
    if (!p) { p = { key, name: name || "Unnamed product", sales: 0, grossCents: 0, clicks: 0 }; by.set(key, p); }
    else if (name && p.name === "Unnamed product") p.name = name;
    return p;
  };
  for (const r of rows.sales) {
    const p = get(r.key, r.name);
    p.sales += 1;
    p.grossCents += convert(Number(r.cents) || 0, r.currency || "usd");
  }
  for (const r of rows.clicks) get(r.key, r.name).clicks += Number(r.n) || 0;
  return Array.from(by.values())
    .filter((p) => p.sales > 0 || p.clicks > 0)
    .sort((a, b) => b.sales - a.sales || b.grossCents - a.grossCents || b.clicks - a.clicks || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** The top entries of a views-by-label count, with each one's share of all views. */
export function topSources(rows: { label: string | null; n: number }[], totalViews: number, limit = 5): DashboardViewSource[] {
  const merged = new Map<string | null, number>();
  for (const r of rows) {
    const label = r.label && r.label.trim() ? r.label.trim() : null;
    merged.set(label, (merged.get(label) ?? 0) + (Number(r.n) || 0));
  }
  return Array.from(merged.entries())
    .map(([label, views]) => ({ label, views, sharePct: rate(views, totalViews) }))
    .filter((r) => r.views > 0)
    // Known places first among equals; "unknown" is the least useful line.
    .sort((a, b) => b.views - a.views || (a.label == null ? 1 : 0) - (b.label == null ? 1 : 0))
    .slice(0, limit);
}

// ─── Payouts ──────────────────────────────────────────────────────────────────

/** The first daily hold-release (08:00 UTC) at or after `at`. See DEFAULT_COMMISSION_HOLD_CRON. */
export function nextApprovalRun(at: Date): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 8));
  return d.getTime() >= at.getTime() ? d : new Date(d.getTime() + DAY);
}

/** The first Monday 09:00 UTC payout run at or after `at`. See DEFAULT_PAYOUT_CRON. */
export function nextPayoutRun(at: Date): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 9));
  let t = d.getTime() >= at.getTime() ? d.getTime() : d.getTime() + DAY;
  while (new Date(t).getUTCDay() !== 1) t += DAY;
  return new Date(t);
}

/**
 * When an unpaid amount should be paid: approved ones on the next Monday run;
 * held ones on the first Monday run after the hold ends and the daily job
 * approves them.
 */
export function expectedPayoutDate(status: string, createdAt: Date, now: Date, holdDays = commissionHoldDays()): Date {
  if (status === "approved") return nextPayoutRun(now);
  const payable = payableFrom(createdAt, holdDays);
  const approvedAt = nextApprovalRun(payable.getTime() > now.getTime() ? payable : now);
  return nextPayoutRun(approvedAt);
}

export interface PayoutRow {
  created_at: Date | string;
  status: string;
  cents: number;
  currency: string;
  bonus: boolean;
}

/**
 * Paid vs Upcoming, Airbnb style: what was earned in the period split into
 * already paid and still to come, plus every upcoming amount by date.
 */
export function buildPayouts(
  rows: PayoutRow[],
  window: { from: Date; to: Date },
  now: Date,
  convert: (cents: number, currency: string) => number,
  holdDays = commissionHoldDays(),
): DashboardPayouts {
  let paidCents = 0, upcomingCents = 0, bonusCents = 0, allUpcomingCents = 0;
  const byDate = new Map<string, { amountCents: number; items: number }>();
  for (const r of rows) {
    if (r.status !== "paid" && r.status !== "pending" && r.status !== "approved") continue;
    const at = new Date(r.created_at);
    const cents = convert(Number(r.cents) || 0, r.currency);
    const inPeriod = at.getTime() >= window.from.getTime() && at.getTime() < window.to.getTime();
    const upcoming = r.status !== "paid";
    if (inPeriod) {
      if (upcoming) upcomingCents += cents; else paidCents += cents;
      if (r.bonus) bonusCents += cents;
    }
    if (upcoming) {
      allUpcomingCents += cents;
      const date = expectedPayoutDate(r.status, at, now, holdDays).toISOString().slice(0, 10);
      const e = byDate.get(date) ?? { amountCents: 0, items: 0 };
      e.amountCents += cents;
      e.items += 1;
      byDate.set(date, e);
    }
  }
  const upcomingList = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, e]) => ({ date, ...e }));
  return {
    totalCents: paidCents + upcomingCents,
    paidCents,
    upcomingCents,
    bonusCents,
    allUpcomingCents,
    upcomingList,
    holdDays,
  };
}

// ─── Database ─────────────────────────────────────────────────────────────────

type Db = { execute: (q: SQL) => Promise<{ rows: unknown[] }> };

/** Whose dashboard: see DashboardAudience in shared/creatorDashboard.ts. */
export interface DashboardScope {
  audience: DashboardAudience;
  userId: string;
}

/** The category filter on a videos alias. The value is checked against the list first. */
function categorySql(alias: string, category: string | null): SQL {
  return category ? sql`and ${sql.raw(alias)}.categories like ${`%"${category}"%`}` : sql``;
}

/**
 * Bucket an instant into the period's UTC hour or day. Timestamps are stored
 * in the database session's wall time, so they are moved to UTC first (a
 * no-op in production, which runs in UTC).
 */
function bucketSql(col: SQL, unit: "hour" | "day"): SQL {
  const fmt = unit === "day" ? "YYYY-MM-DD" : 'YYYY-MM-DD"T"HH24';
  return sql`to_char(date_trunc(${unit}, (${col} at time zone current_setting('TimeZone')) at time zone 'UTC'), ${fmt})`;
}

/** The brand's own products. */
function brandProductsSql(me: string): SQL {
  return sql`select p.id from products p join brands b on b.id = p.brand_id where b.owner_id = ${me}`;
}

/**
 * Every pick-up of a video by an account: a live embed seen on a site, a
 * repost code issued on a campaign, a paid library licence, or a published
 * playlist holding it. Columns: who, video_id, at.
 */
function repostsSql(): SQL {
  return sql`
    select ed.affiliate_id as who, ed.video_id, ed.first_seen_at as at from embed_deployments ed
    union all
    select ca.affiliate_id, ca.video_id, ca.created_at from campaign_affiliates ca
    union all
    select lp.affiliate_id, g.video_id, coalesce(lp.purchased_at, lp.created_at)
    from video_license_purchases lp join global_video_library g on g.id = lp.global_listing_id
    where lp.status = 'paid'
    union all
    select pl.user_id, g.video_id, greatest(pi.added_at, coalesce(pl.published_at, pi.added_at))
    from playlist_items pi join playlists pl on pl.id = pi.playlist_id
    join global_video_library g on g.id = pi.listing_id
    where pl.status = 'published'`;
}

/**
 * The ids of the videos a dashboard covers.
 *   creator    the ones they made.
 *   brand      the ones they uploaded, that feature their products (detected
 *              or on a carousel card), or that one of their orders came from.
 *   publisher  the ones they reposted, or earned or sold through.
 */
function videoSetSql(s: DashboardScope): SQL {
  const me = s.userId;
  if (s.audience === "creator") return sql`select v0.id from videos v0 where v0.creator_id = ${me}`;
  if (s.audience === "brand") {
    return sql`
      select v0.id from videos v0 where v0.creator_id = ${me}
      union select vp.video_id from video_products vp where vp.product_id in (${brandProductsSql(me)})
      union select ov.video_id from video_product_overlays ov where ov.product_id in (${brandProductsSql(me)})
      union select a.video_id from platform_fee_accruals a where a.brand_user_id = ${me} and a.video_id is not null
      union select o.video_id from video_orders o where o.brand_user_id = ${me}`;
  }
  return sql`
    select r.video_id from (${repostsSql()}) r where r.who = ${me}
    union select o.video_id from video_orders o where o.affiliate_id = ${me}
    union select c.video_id from commission_transactions c where c.affiliate_id = ${me} and c.video_id is not null`;
}

async function loadVideos(db: Db, scope: DashboardScope, category: string | null): Promise<DashboardVideo[]> {
  // A Publisher's averages divide by the videos they had picked up by the end
  // of the period, so for them a video "starts" when they first reposted it.
  const started = scope.audience === "publisher"
    ? sql`coalesce((select min(r.at) from (${repostsSql()}) r where r.who = ${scope.userId} and r.video_id = v.id), v.created_at)`
    : sql`v.created_at`;
  const r = await db.execute(sql`
    select v.id, v.title, v.thumbnail_url, v.categories, v.status::text as status, ${started} as created_at,
      u.display_name as creator_name
    from videos v left join users u on u.id = v.creator_id
    where v.id in (${videoSetSql(scope)}) ${categorySql("v", category)}
    order by v.created_at desc
    limit 1000`);
  return r.rows as DashboardVideo[];
}

async function loadWindow(
  db: Db, scope: DashboardScope, w: { from: Date; to: Date }, unit: "hour" | "day", category: string | null, platformCurrency: string,
): Promise<WindowRows> {
  const { from, to } = w;
  const me = scope.userId;
  const cat = categorySql("v", category);
  const set = videoSetSql(scope);

  // Which events count. A brand's clicks are on its own products (or on no
  // named product); a click on another brand's product in a shared video is not.
  const eventScope =
    scope.audience === "creator" ? sql`e.creator_id = ${me} and v.creator_id = ${me}`
    : scope.audience === "brand" ? sql`v.id in (${set}) and (e.event_type = 'view' or e.product_id is null or e.product_id in (${brandProductsSql(me)}))`
    : sql`e.affiliate_id = ${me}`;
  const events = db.execute(sql`
    select e.video_id, ${bucketSql(sql`e.created_at`, unit)} as t,
      count(*) filter (where e.event_type = 'view')::int as views,
      count(*) filter (where e.event_type = 'click')::int as clicks
    from analytics_events e join videos v on v.id = e.video_id
    where ${eventScope} and e.event_type in ('view', 'click')
      and e.created_at >= ${from} and e.created_at < ${to} ${cat}
    group by 1, 2`);

  const watchScope =
    scope.audience === "creator" ? sql`w.creator_id = ${me} and v.creator_id = ${me}`
    : scope.audience === "brand" ? sql`v.id in (${set})`
    : sql`w.affiliate_id = ${me}`;
  const watch = db.execute(sql`
    select w.video_id, ${bucketSql(sql`w.created_at`, unit)} as t,
      count(*) filter (where w.seconds_watched > 0)::int as sessions,
      count(*) filter (where w.seconds_watched > 0 and w.video_seconds > 0
        and w.seconds_watched >= 0.9 * w.video_seconds)::int as completed,
      coalesce(sum(w.seconds_watched), 0)::float8 as seconds,
      coalesce(sum(w.video_seconds) filter (where w.seconds_watched > 0), 0)::float8 as video_seconds
    from video_watch_time w join videos v on v.id = w.video_id
    where ${watchScope}
      and w.created_at >= ${from} and w.created_at < ${to} ${cat}
    group by 1, 2`);

  // Creators and brands: others picking up their videos. Publishers: the
  // videos they themselves picked up in the period.
  const repostScope = scope.audience === "publisher"
    ? sql`r.who = ${me}`
    : sql`v.id in (${set}) and r.who <> ${me}`;
  const reposts = db.execute(sql`
    with firsts as (
      select r.who, r.video_id, min(r.at) as at
      from (${repostsSql()}) r join videos v on v.id = r.video_id
      where ${repostScope} and r.at is not null ${cat}
      group by 1, 2
    )
    select f.video_id, ${bucketSql(sql`f.at`, unit)} as t, u.role::text as role, count(*)::int as n
    from firsts f left join users u on u.id = f.who
    where f.at >= ${from} and f.at < ${to}
    group by 1, 2, 3`);

  // One row per real order. See SALES in the file header. A brand takes only
  // its own orders; a Publisher only the ones they brought in.
  const isBrand = scope.audience === "brand";
  const sales = db.execute(sql`
    with mine as (select v.id, v.creator_id from videos v where v.id in (${set}) ${cat}),
    s as (
      select 'a:' || a.id as k, a.video_id, m.creator_id, a.occurred_at as at, a.sale_cents::float8 as cents, lower(a.currency) as currency,
        coalesce(
          (select o.affiliate_id from video_orders o
            where a.store_connection_id is null and o.stripe_checkout_session_id = a.external_order_id limit 1),
          (select c.affiliate_id from commission_transactions c
            where c.external_order_id = a.external_order_id
              and c.store_connection_id is not distinct from a.store_connection_id
              and (c.kind = 'publisher' or (c.kind is null and c.affiliate_id <> m.creator_id))
            limit 1)
        ) as publisher_id
      from platform_fee_accruals a join mine m on m.id = a.video_id
      where a.attribution_state = 'attributed' and a.status <> 'void'
        and a.occurred_at >= ${from} and a.occurred_at < ${to}
        ${isBrand ? sql`and a.brand_user_id = ${me}` : sql``}
      union all
      select 'o:' || o.id, o.video_id, m.creator_id, o.paid_at, o.amount_cents::float8, lower(o.currency), o.affiliate_id
      from video_orders o join mine m on m.id = o.video_id
      where o.status = 'paid'
        and o.paid_at >= ${from} and o.paid_at < ${to}
        ${isBrand ? sql`and o.brand_user_id = ${me}` : sql``}
        and not exists (
          select 1 from platform_fee_accruals a
          where a.store_connection_id is null and a.external_order_id = o.stripe_checkout_session_id)
      union all
      select 'c:' || c.id, c.video_id, m.creator_id, c.created_at, round(c.sale_amount * 100)::float8, ${platformCurrency},
        (select p.affiliate_id from commission_transactions p
          where p.external_order_id is null and p.video_id = c.video_id and p.sale_amount = c.sale_amount
            and p.analytics_event_id is not distinct from c.analytics_event_id
            and abs(extract(epoch from (p.created_at - c.created_at))) < 10
            and (p.kind = 'publisher' or (p.kind is null and p.affiliate_id <> m.creator_id))
          limit 1)
      from commission_transactions c join mine m on m.id = c.video_id
      where c.external_order_id is null
        and c.status not in ('reversed', 'rejected')
        and c.created_at >= ${from} and c.created_at < ${to}
        ${isBrand ? sql`and c.product_id in (${brandProductsSql(me)})` : sql``}
        and not exists (
          select 1 from commission_transactions e
          where e.external_order_id is null and e.id <> c.id and e.video_id = c.video_id
            and e.sale_amount = c.sale_amount
            and e.analytics_event_id is not distinct from c.analytics_event_id
            and abs(extract(epoch from (e.created_at - c.created_at))) < 10
            and (e.created_at < c.created_at or (e.created_at = c.created_at and e.id < c.id)))
    )
    select s.k, s.video_id, s.creator_id, ${bucketSql(sql`s.at`, unit)} as t, s.cents, s.currency, s.publisher_id, u.role::text as role
    from s left join users u on u.id = s.publisher_id
    ${scope.audience === "publisher" ? sql`where s.publisher_id = ${me}` : sql``}`);

  // Creators and Publishers: what they earned. Brands: the creator and
  // Publisher commission written on the brand's own orders (in-video orders,
  // store orders by their accrual, and sales recorded by hand for its
  // products). Partner commission is not the brand's to see.
  const commissions = isBrand
    ? db.execute(sql`
        select c.video_id, ${bucketSql(sql`c.created_at`, unit)} as t,
          coalesce(lower(o.currency), ${platformCurrency}) as currency,
          round(sum(c.commission_amount) * 100)::float8 as cents
        from commission_transactions c
        join videos v on v.id = c.video_id
        left join video_orders o on c.store_connection_id is null and c.external_order_id is not null
          and o.stripe_checkout_session_id = c.external_order_id
        where c.status not in ('reversed', 'rejected') and (c.kind is null or c.kind in ('creator', 'publisher'))
          and c.created_at >= ${from} and c.created_at < ${to} ${cat}
          and (
            o.brand_user_id = ${me}
            or (c.external_order_id is not null and exists (
              select 1 from platform_fee_accruals a
              where a.brand_user_id = ${me} and a.external_order_id = c.external_order_id
                and a.store_connection_id is not distinct from c.store_connection_id))
            or (c.external_order_id is null and c.product_id in (${brandProductsSql(me)}))
          )
        group by 1, 2, 3`)
    : db.execute(sql`
        select c.video_id, ${bucketSql(sql`c.created_at`, unit)} as t,
          coalesce(lower(o.currency), ${platformCurrency}) as currency,
          round(sum(c.commission_amount) * 100)::float8 as cents
        from commission_transactions c
        join videos v on v.id = c.video_id
        left join video_orders o on c.store_connection_id is null and c.external_order_id is not null
          and o.stripe_checkout_session_id = c.external_order_id
        where c.affiliate_id = ${me} and c.status not in ('reversed', 'rejected')
          and c.created_at >= ${from} and c.created_at < ${to} ${cat}
        group by 1, 2, 3`);

  const [e, wt, rp, sl, cm] = await Promise.all([events, watch, reposts, sales, commissions]);
  return {
    events: e.rows as WindowRows["events"],
    watch: wt.rows as WindowRows["watch"],
    reposts: rp.rows as WindowRows["reposts"],
    sales: sl.rows as WindowRows["sales"],
    commissions: cm.rows as WindowRows["commissions"],
  };
}

/**
 * Products behind the period's sales and clicks. In-video orders name their
 * product through the carousel card bought from; hand-recorded sales carry a
 * product id. Sales on a brand's own store carry no product, so they are not
 * in this list. Clicks count only where the player sent the product.
 */
async function loadProducts(db: Db, scope: DashboardScope, w: { from: Date; to: Date }, category: string | null, platformCurrency: string): Promise<ProductRows> {
  const me = scope.userId;
  const cat = categorySql("v", category);
  const orderScope =
    scope.audience === "brand" ? sql`and o.brand_user_id = ${me}`
    : scope.audience === "publisher" ? sql`and o.affiliate_id = ${me}`
    : sql``;
  // Hand-recorded sales: one per sale (the earliest row of its group), or for
  // a Publisher their own row of it.
  const handScope =
    scope.audience === "publisher" ? sql`and c.affiliate_id = ${me}`
    : sql`${scope.audience === "brand" ? sql`and c.product_id in (${brandProductsSql(me)})` : sql``}
      and not exists (
        select 1 from commission_transactions e
        where e.external_order_id is null and e.id <> c.id and e.video_id = c.video_id
          and e.sale_amount = c.sale_amount
          and e.analytics_event_id is not distinct from c.analytics_event_id
          and abs(extract(epoch from (e.created_at - c.created_at))) < 10
          and (e.created_at < c.created_at or (e.created_at = c.created_at and e.id < c.id)))`;
  const sales = db.execute(sql`
    with mine as (select v.id from videos v where v.id in (${videoSetSql(scope)}) ${cat})
    select coalesce(ov.product_id, 'card:' || ov.id::text) as key, coalesce(pr.name, ov.name) as name,
      o.amount_cents::float8 as cents, lower(o.currency) as currency
    from video_orders o
    join video_product_overlays ov on ov.id = o.overlay_id
    left join products pr on pr.id = ov.product_id
    where o.video_id in (select id from mine) and o.status = 'paid'
      and o.paid_at >= ${w.from} and o.paid_at < ${w.to} ${orderScope}
    union all
    select c.product_id, pr.name, round(c.sale_amount * 100)::float8, ${platformCurrency}
    from commission_transactions c
    join products pr on pr.id = c.product_id
    where c.video_id in (select id from mine) and c.external_order_id is null
      and c.status not in ('reversed', 'rejected')
      and c.created_at >= ${w.from} and c.created_at < ${w.to}
      ${handScope}`);
  const clickScope =
    scope.audience === "creator" ? sql`e.creator_id = ${me} and v.creator_id = ${me}`
    : scope.audience === "brand" ? sql`e.product_id in (${brandProductsSql(me)})`
    : sql`e.affiliate_id = ${me}`;
  const clicks = db.execute(sql`
    select e.product_id as key, pr.name, count(*)::int as n
    from analytics_events e
    join videos v on v.id = e.video_id
    join products pr on pr.id = e.product_id
    where ${clickScope} and e.event_type = 'click'
      and e.created_at >= ${w.from} and e.created_at < ${w.to} ${cat}
    group by 1, 2`);
  const [s, c] = await Promise.all([sales, clicks]);
  return { sales: s.rows as ProductRows["sales"], clicks: c.rows as ProductRows["clicks"] };
}

/** Views in the period by referrer domain and by country. */
async function loadViewSources(db: Db, scope: DashboardScope, w: { from: Date; to: Date }, category: string | null) {
  const me = scope.userId;
  const cat = categorySql("v", category);
  const viewScope =
    scope.audience === "creator" ? sql`e.creator_id = ${me} and v.creator_id = ${me}`
    : scope.audience === "brand" ? sql`v.id in (${videoSetSql(scope)})`
    : sql`e.affiliate_id = ${me}`;
  const by = (col: SQL) => db.execute(sql`
    select ${col} as label, count(*)::int as n
    from analytics_events e join videos v on v.id = e.video_id
    where ${viewScope} and e.event_type = 'view'
      and e.created_at >= ${w.from} and e.created_at < ${w.to} ${cat}
    group by 1 order by 2 desc limit 20`);
  const [r, c] = await Promise.all([by(sql`e.referrer_domain`), by(sql`e.country`)]);
  return { referrers: r.rows as { label: string | null; n: number }[], countries: c.rows as { label: string | null; n: number }[] };
}

/** Everything unpaid, plus what was paid out of the period's earnings. */
async function loadPayoutRows(db: Db, me: string, w: { from: Date; to: Date }, platformCurrency: string): Promise<PayoutRow[]> {
  const r = await db.execute(sql`
    select c.created_at, c.status::text as status, round(c.commission_amount * 100)::float8 as cents,
      coalesce(lower(o.currency), ${platformCurrency}) as currency, false as bonus
    from commission_transactions c
    left join video_orders o on c.store_connection_id is null and c.external_order_id is not null
      and o.stripe_checkout_session_id = c.external_order_id
    where c.affiliate_id = ${me}
      and (c.status in ('pending', 'approved') or (c.status = 'paid' and c.created_at >= ${w.from} and c.created_at < ${w.to}))
    union all
    select b.created_at, b.status::text, b.amount_cents::float8, ${platformCurrency}, true
    from creator_bonuses b
    where b.creator_id = ${me}
      and (b.status in ('pending', 'approved') or (b.status = 'paid' and b.created_at >= ${w.from} and b.created_at < ${w.to}))`);
  return r.rows as PayoutRow[];
}

/** Today's rate for every currency involved, and the target to show in. */
async function ratesFor(currencies: Set<string>, wanted: DashboardCurrency): Promise<{ usdPer: UsdRates; target: DashboardCurrency; date: string | null; approximate: boolean }> {
  const usdPer: UsdRates = { usd: 1 };
  let date: string | null = null;
  let approximate = false;
  await Promise.all(Array.from(new Set(Array.from(currencies).concat(wanted))).map(async (c) => {
    const cur = c.toLowerCase();
    if (cur === "usd") return;
    const r = await usdRate(cur);
    if (r) { usdPer[cur] = r.rate; date = date && r.date && date > r.date ? date : (r.date ?? date); }
  }));
  let target = wanted;
  if (!usdPer[wanted]) { target = "usd"; approximate = wanted !== "usd"; }
  return { usdPer, target, date, approximate };
}

/**
 * Which dashboard an account gets when it does not say: brands the brand
 * one, Publishers (role "affiliate") theirs, everyone else the creator one.
 * Any account may ask for any of the three; each only ever shows its own.
 */
export function audienceFor(requested: unknown, role: string | null | undefined): DashboardAudience | null {
  if (typeof requested === "string" && requested.trim()) {
    const a = requested.trim().toLowerCase();
    return (DASHBOARD_AUDIENCES as readonly string[]).includes(a) ? (a as DashboardAudience) : null;
  }
  return role === "brand" ? "brand" : role === "affiliate" ? "publisher" : "creator";
}

// ─── The whole dashboard ──────────────────────────────────────────────────────

export async function performanceDashboard(scope: DashboardScope, q: DashboardQuery, now: Date = new Date()): Promise<CreatorDashboard> {
  const { db } = await import("./db");
  const d = db as unknown as Db;
  const platformCurrency = getPlatformCurrency();
  const cur = { from: q.from, to: q.to };
  const prev = previousWindow(q.from, q.to);
  const unit = bucketUnit(q.from, q.to);
  const paid = scope.audience !== "brand";

  const [videos, rowsCur, rowsPrev, payoutRows, productRows, sourceRows] = await Promise.all([
    loadVideos(d, scope, q.category),
    loadWindow(d, scope, cur, unit, q.category, platformCurrency),
    loadWindow(d, scope, prev, unit, q.category, platformCurrency),
    paid ? loadPayoutRows(d, scope.userId, cur, platformCurrency) : Promise.resolve([] as PayoutRow[]),
    loadProducts(d, scope, cur, q.category, platformCurrency),
    loadViewSources(d, scope, cur, q.category),
  ]);

  const currencies = new Set<string>();
  for (const r of [...rowsCur.sales, ...rowsPrev.sales, ...rowsCur.commissions, ...rowsPrev.commissions, ...payoutRows, ...productRows.sales]) {
    if (r.currency) currencies.add(String(r.currency).toLowerCase());
  }
  const fx = await ratesFor(currencies, q.currency);

  // The fallback maker for sale rows: only a creator is the maker of every video.
  const owner = scope.audience === "creator" ? scope.userId : "";
  const foldedCur = foldWindow(rowsCur, owner, fx.target, fx.usdPer);
  const foldedPrev = foldWindow(rowsPrev, owner, fx.target, fx.usdPer);

  const totalsFor = (folded: Folded, to: Date) => {
    const set = videosInPeriod(videos, to, new Set(folded.perVideo.keys()));
    return { set, totals: totalsForSet(folded.perVideo, new Set(set.map((v) => v.id)), set.length) };
  };
  const current = totalsFor(foldedCur, cur.to);
  const previous = totalsFor(foldedPrev, prev.to);

  let payoutApprox = false;
  const convert = (cents: number, currency: string) => {
    const c = convertCents(cents, currency || "usd", fx.target, fx.usdPer);
    if (c == null) { payoutApprox = true; return Math.round(cents); }
    return c;
  };
  const payouts = paid ? buildPayouts(payoutRows, cur, now, convert) : null;
  const products = topProducts(productRows, convert);
  const totalViews = current.totals.views;

  const series = bucketKeys(cur.from, cur.to, unit).map((t) => foldedCur.series.get(t) ?? { t, views: 0, clicks: 0, sales: 0, grossCents: 0 });

  return {
    audience: scope.audience,
    period: {
      from: cur.from.toISOString(),
      to: cur.to.toISOString(),
      previousFrom: prev.from.toISOString(),
      previousTo: prev.to.toISOString(),
      bucket: unit,
    },
    currency: fx.target,
    fx: { date: fx.date, approximate: fx.approximate || foldedCur.approximate || foldedPrev.approximate || payoutApprox },
    category: q.category,
    videoCount: current.set.length,
    current: current.totals,
    previous: previous.totals,
    series,
    videos: sortVideoRows(current.set.map((v) => videoRow(v, foldedCur.perVideo.get(v.id)))),
    payouts,
    topProducts: products,
    viewSources: {
      totalViews,
      referrers: topSources(sourceRows.referrers, totalViews),
      countries: topSources(sourceRows.countries, totalViews),
    },
  };
}

/** The creator's own dashboard (the original, 16 Nov 2026). */
export function creatorDashboard(creatorId: string, q: DashboardQuery, now: Date = new Date()): Promise<CreatorDashboard> {
  return performanceDashboard({ audience: "creator", userId: creatorId }, q, now);
}
