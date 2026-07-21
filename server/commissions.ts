/**
 * Commission split persistence for VERIFIED sales.
 *
 * This is the single place commissions are created. Callers must have already
 * verified the sale is real — an authenticated brand/admin reconciliation endpoint
 * or a signed store webhook. It must NEVER be reachable from the public embed
 * analytics endpoint, where the sale amount is client-supplied and therefore
 * spoofable (see server/routes.ts, POST /api/analytics/events).
 */
import { computeSaleSplit, toCents, centsToAmount, type SaleSplit } from "./feeConfig";

export interface SaleAttribution {
  videoId: string;
  creatorId: string | null;
  /** Resolved affiliate for the sale's UTM (the reposting publisher), if any. */
  affiliateId: string | null;
  campaignAffiliateId: string | null;
  /** Admin per-repost publisher rate override (from the campaign affiliate). */
  resolvedCommissionRate: string | null;
  productId?: string | null;
  /** Store order id — persisted for idempotency + reconciliation. */
  externalOrderId?: string | null;
}

export interface RecordedCommissions {
  split: SaleSplit;
  creatorCommissionId?: string;
  publisherCommissionId?: string;
  /** True when the DB unique constraint rejected a duplicate (concurrent retry). */
  deduped?: boolean;
}

/** True for a Postgres unique-violation (SQLSTATE 23505) from a duplicate order row. */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as any)?.code ?? (err as any)?.cause?.code;
  return code === "23505";
}

/** Minimal storage surface — keeps this unit-testable without a database. */
export interface CommissionStore {
  createCommissionTransaction(tx: {
    affiliateId: string;
    analyticsEventId: string | null;
    videoId: string;
    productId: string | null;
    saleAmount: string;
    commissionRate: string;
    commissionAmount: string;
    campaignAffiliateId: string | null;
    externalOrderId?: string | null;
  }): Promise<{ id: string }>;
  getCampaignAffiliates(videoId: string): Promise<Array<{
    id: string;
    totalConversions?: number | null;
    totalRevenue?: string | null;
    totalEarnings?: string | null;
  }>>;
  updateCampaignAffiliateStats(id: string, stats: Record<string, unknown>): Promise<unknown>;
}

/**
 * Compute and persist the creator + publisher commission rows for a verified sale.
 * The video's creator always earns; a distinct attributed affiliate earns the
 * publisher share (with per-repost override). Brand (85%) and platform shares are
 * returned in `split` for reporting but are not affiliate payouts.
 */
export async function recordSaleCommissions(
  store: CommissionStore,
  saleRevenue: string,
  attribution: SaleAttribution,
  analyticsEventId: string | null = null,
  rates?: { marketplaceFeePct?: number; creatorPct?: number; publisherPct?: number },
): Promise<RecordedCommissions> {
  const { videoId, creatorId, affiliateId, campaignAffiliateId, resolvedCommissionRate } = attribution;
  const productId = attribution.productId ?? null;
  const externalOrderId = attribution.externalOrderId ?? null;
  const saleCents = toCents(saleRevenue);

  const publisherId = affiliateId && affiliateId !== creatorId ? affiliateId : null;
  const publisherOverridePct = publisherId && resolvedCommissionRate != null
    ? parseFloat(resolvedCommissionRate)
    : undefined;

  const split = computeSaleSplit(saleCents, {
    hasPublisher: !!publisherId,
    marketplaceFeePct: rates?.marketplaceFeePct,
    creatorPct: rates?.creatorPct,
    // A per-repost admin override wins; otherwise the resolved publisher default.
    publisherPct: publisherOverridePct ?? rates?.publisherPct,
  });

  const result: RecordedCommissions = { split };

  // Creator commission (video owner always earns their share). A concurrent retry of
  // the same store order trips the (external_order_id, affiliate_id) unique index; we
  // swallow that as an idempotent no-op rather than surfacing a 500.
  if (creatorId && split.creatorCents > 0) {
    try {
      const tx = await store.createCommissionTransaction({
        affiliateId: creatorId,
        analyticsEventId,
        videoId,
        productId,
        saleAmount: saleRevenue,
        commissionRate: split.effectiveRates.creatorPct.toFixed(2),
        commissionAmount: centsToAmount(split.creatorCents),
        campaignAffiliateId: null,
        externalOrderId,
      });
      result.creatorCommissionId = tx.id;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      result.deduped = true;
    }
  }

  // Publisher commission (only when a distinct publisher is attributed)
  if (publisherId && split.publisherCents > 0) {
    let publisherInserted = false;
    try {
      const tx = await store.createCommissionTransaction({
        affiliateId: publisherId,
        analyticsEventId,
        videoId,
        productId,
        saleAmount: saleRevenue,
        commissionRate: split.effectiveRates.publisherPct.toFixed(2),
        commissionAmount: centsToAmount(split.publisherCents),
        campaignAffiliateId,
        externalOrderId,
      });
      result.publisherCommissionId = tx.id;
      publisherInserted = true;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      result.deduped = true;
    }

    // Only bump campaign stats when we actually inserted a new publisher row, so a
    // deduped retry doesn't double-count conversions/revenue/earnings.
    if (publisherInserted && campaignAffiliateId) {
      const ca = (await store.getCampaignAffiliates(videoId)).find((c) => c.id === campaignAffiliateId);
      if (ca) {
        await store.updateCampaignAffiliateStats(campaignAffiliateId, {
          totalConversions: (ca.totalConversions || 0) + 1,
          totalRevenue: centsToAmount(toCents(ca.totalRevenue || "0") + saleCents),
          totalEarnings: centsToAmount(toCents(ca.totalEarnings || "0") + split.publisherCents),
        });
      }
    }
  }

  return result;
}
