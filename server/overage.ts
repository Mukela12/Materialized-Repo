/**
 * Overage: what a subscriber owes beyond their plan's allowances.
 *
 * ── Where the numbers may come from ──────────────────────────────────────────
 * Usage comes from recorded events and rates come from plan_allowances rows —
 * never from the request. The previous overage path was removed precisely
 * because the browser posted the amount ("a route where the customer sets
 * their own bill"); this module is the replacement that note promised.
 *
 * ── The two meters ───────────────────────────────────────────────────────────
 * Videos: uploads created inside the billing month.
 * Views:  BILLABLE views only — rows carrying a viewerHash, which the partial
 *         unique index already dedupes to one per viewer per video per day.
 *         Pre-hash rows and unidentifiable viewers are excluded, deliberately
 *         in the customer's favour: a disputed bill costs more than the pennies
 *         of undercounting.
 *
 * ── Pricing ──────────────────────────────────────────────────────────────────
 * Views price per started thousand (ceil): 1,001 extra views is two units.
 * Started-unit billing is the convention people know from every metered bill,
 * and rounding down would make the first 999 extras free on every meter.
 *
 * A NULL allowance means unlimited: that meter can never produce overage, no
 * matter the rate. A NULL rate means the excess is measured but free — the
 * state the client reviews in a dry-run month before setting prices.
 */

export interface AllowanceConfig {
  includedVideos: number | null;
  includedViews: number | null;
  overagePerVideoCents: number | null;
  overagePer1000ViewsCents: number | null;
}

export interface Usage {
  videos: number;
  views: number;
}

export interface OverageBreakdown {
  videosOver: number;
  viewsOver: number;
  videoOverageCents: number;
  viewOverageCents: number;
  totalCents: number;
}

export function computeOverage(usage: Usage, allowance: AllowanceConfig): OverageBreakdown {
  const videosOver =
    allowance.includedVideos == null ? 0 : Math.max(0, usage.videos - allowance.includedVideos);
  const viewsOver =
    allowance.includedViews == null ? 0 : Math.max(0, usage.views - allowance.includedViews);

  const videoOverageCents =
    allowance.overagePerVideoCents == null ? 0 : videosOver * allowance.overagePerVideoCents;
  const viewOverageCents =
    allowance.overagePer1000ViewsCents == null
      ? 0
      : Math.ceil(viewsOver / 1000) * allowance.overagePer1000ViewsCents;

  return {
    videosOver,
    viewsOver,
    videoOverageCents,
    viewOverageCents,
    totalCents: videoOverageCents + viewOverageCents,
  };
}

/** True when this plan's config can ever produce a bill — used to skip work, not to gate safety. */
export function allowanceIsMetered(a: AllowanceConfig | null | undefined): boolean {
  if (!a) return false;
  return a.includedVideos != null || a.includedViews != null;
}
