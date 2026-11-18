/**
 * The creator dashboard (client, 16 Nov 2026). Built by
 * server/creatorDashboard.ts; shared so the client reads the same shape.
 *
 * Money is in integer cents of `currency`. "Per video" averages divide by
 * `videoCount`: the creator's videos in the chosen category that were
 * published by the end of the period or had any activity in it.
 */

/**
 * Whose numbers (client, 18 Nov 2026). Every audience sees only its own:
 *   creator    their own videos, with everything every repost of them did.
 *   brand      videos the brand uploaded or that feature its products, with
 *              everything every repost did; sales are the brand's own orders;
 *              commission is what those orders pay creators and Publishers.
 *   publisher  only what their own reposts did: views, viewings, clicks and
 *              sales on their pages, and their own commission and payouts.
 */
export const DASHBOARD_AUDIENCES = ["creator", "brand", "publisher"] as const;
export type DashboardAudience = (typeof DASHBOARD_AUDIENCES)[number];

export const DASHBOARD_CURRENCIES = ["usd", "eur", "gbp"] as const;
export type DashboardCurrency = (typeof DASHBOARD_CURRENCIES)[number];

export type SaleSource = "own" | "publisher" | "brand";

export interface SalesBySource {
  /** No one else's repost: the creator's own audience (or their own link). */
  own: number;
  /** Through a Publisher's repost (an account with the publisher role). */
  publisher: number;
  /** Through a brand's repost of the video. */
  brand: number;
  total: number;
}

export interface DashboardTotals {
  views: number;
  clicks: number;
  /** Clicks per view, as a percentage. */
  ctr: number;
  /** Viewings that played at least a second. */
  watchSessions: number;
  watchSeconds: number;
  /** watchSeconds / watchSessions, rounded to the second. 0 with no viewings. */
  avgViewSeconds: number;
  /** Average share of the video watched, 0 to 100. */
  avgCompletionPct: number;
  /** Share of viewings that reached 90% of the video, 0 to 100. */
  completionRate: number;
  /** Sales per click, as a percentage (0 to 100). */
  conversionRate: number;
  /** New reposts in the period: a brand or Publisher first picking up one of the videos. */
  reposts: number;
  repostsByBrand: number;
  repostsByPublisher: number;
  sales: SalesBySource;
  grossCents: number;
  /**
   * Creators and Publishers: commission they earned in the period, before
   * payout. Brands: commission their orders pay creators and Publishers.
   */
  commissionCents: number;
  avg: {
    clicksPerVideo: number;
    repostsPerVideo: number;
    ownSalesPerVideo: number;
    publisherSalesPerVideo: number;
    brandSalesPerVideo: number;
    grossPerVideoCents: number;
    /** Gross per sale (average order value). */
    orderValueCents: number;
  };
}

export interface DashboardSeriesPoint {
  /** Bucket start, "YYYY-MM-DD" by day or "YYYY-MM-DDTHH" by hour (UTC). */
  t: string;
  views: number;
  clicks: number;
  sales: number;
  grossCents: number;
}

export interface DashboardVideoRow {
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  /** Who made the video (shown to brands and Publishers). */
  creatorName: string | null;
  /** First category on the video, or null. */
  category: string | null;
  views: number;
  clicks: number;
  ctr: number;
  avgViewSeconds: number;
  reposts: number;
  sales: SalesBySource;
  grossCents: number;
  commissionCents: number;
}

export interface DashboardPayouts {
  /** Earned in the period (all categories): paidCents + upcomingCents. */
  totalCents: number;
  paidCents: number;
  upcomingCents: number;
  /** Of totalCents, the part from brand subscription bonuses. */
  bonusCents: number;
  /** Everything still to be paid, whenever it was earned. */
  allUpcomingCents: number;
  /** Still to be paid, by expected payout date (the Monday run after the hold). */
  upcomingList: { date: string; amountCents: number; items: number }[];
  holdDays: number;
}

export interface DashboardProduct {
  key: string;
  name: string;
  sales: number;
  grossCents: number;
  clicks: number;
}

export interface DashboardViewSource {
  /** A referrer domain or an ISO country code; null when unknown or direct. */
  label: string | null;
  views: number;
  /** Share of all views in the period, 0 to 100. */
  sharePct: number;
}

export interface CreatorDashboard {
  audience: DashboardAudience;
  period: {
    from: string;
    to: string;
    previousFrom: string;
    previousTo: string;
    bucket: "hour" | "day";
  };
  currency: DashboardCurrency;
  /** Amounts in other currencies were converted at this ECB reference date. */
  fx: { date: string | null; approximate: boolean };
  category: string | null;
  videoCount: number;
  current: DashboardTotals;
  previous: DashboardTotals;
  series: DashboardSeriesPoint[];
  videos: DashboardVideoRow[];
  /** Paid vs Upcoming. null for brands, who are not paid commission. */
  payouts: DashboardPayouts | null;
  /** Top 5 products by sales, then sales value, then clicks (current period). */
  topProducts: DashboardProduct[];
  /** Where the period's views came from: top 5 sites and countries. */
  viewSources: { totalViews: number; referrers: DashboardViewSource[]; countries: DashboardViewSource[] };
}

/**
 * Change against the previous period, as a whole percentage. null when there
 * is nothing to compare with (the previous period was zero).
 */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

/** "1m 05s", "42s", "1h 02m". */
export function formatWatchDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(r).padStart(2, "0")}s`;
}
