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
  /**
   * Store connection the order belongs to. Store order ids are only unique WITHIN a store,
   * so this scopes the (external_order_id, affiliate_id, store_connection_id) dedup index and
   * lets refunds target the right store. Optional/nullable for legacy /internal callers.
   */
  storeConnectionId?: string | null;
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

/** A commission row as returned when looking rows up for a clawback. */
export interface CommissionRow {
  id: string;
  affiliateId: string;
  videoId: string;
  saleAmount: string;
  commissionAmount: string;
  status: string | null;
  campaignAffiliateId: string | null;
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
    storeConnectionId?: string | null;
  }): Promise<{ id: string }>;
  getCampaignAffiliates(videoId: string): Promise<Array<{
    id: string;
    totalConversions?: number | null;
    totalRevenue?: string | null;
    totalEarnings?: string | null;
  }>>;
  updateCampaignAffiliateStats(id: string, stats: Record<string, unknown>): Promise<unknown>;
}

/** Storage surface for reversing commissions when a store order is refunded. */
export interface ClawbackStore {
  getCommissionsByExternalOrder(externalOrderId: string, storeConnectionId?: string | null): Promise<CommissionRow[]>;
  updateCommissionTransactionStatus(id: string, status: string): Promise<unknown>;
  getCampaignAffiliates(videoId: string): Promise<Array<{
    id: string;
    totalConversions?: number | null;
    totalRevenue?: string | null;
    totalEarnings?: string | null;
  }>>;
  updateCampaignAffiliateStats(id: string, stats: Record<string, unknown>): Promise<unknown>;
}

export interface ClawbackResult {
  /** Number of rows flipped to "reversed" by THIS call (0 on a retry / unknown order). */
  reversed: number;
  /** True when every row for the order was already reversed (retried refund webhook). */
  alreadyReversed: boolean;
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
  const storeConnectionId = attribution.storeConnectionId ?? null;
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
        storeConnectionId,
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
        storeConnectionId,
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

/**
 * Reverse (claw back) the commission rows for a refunded store order.
 *
 * Mirrors recordSaleCommissions: it finds the up-to-two rows written for the order
 * (creator + publisher, sharing externalOrderId) and flips each to "reversed" so the
 * affiliate earnings ledger stops counting the sale and the payout engine — which only
 * ever pays "approved" rows — skips them from now on.
 *
 * Idempotent by design: it only acts on rows that are not already "reversed". A retried
 * refund webhook (stores retry) finds everything already reversed and returns a no-op.
 * The campaign-affiliate stat decrement is likewise applied ONCE, only for rows this call
 * actually reverses, so a double-delivery can't over-decrement.
 *
 * The "paid" edge case (money already left via a Stripe transfer): v1 policy is to still
 * flip paid → reversed so the ledger is correct and the amount is recoverable/visible in
 * admin, WITHOUT attempting an automatic Stripe reversal here. The clawback never crashes
 * on a paid row.
 */
export async function clawbackSaleCommissions(
  store: ClawbackStore,
  externalOrderId: string,
  storeConnectionId?: string | null,
): Promise<ClawbackResult> {
  // Scope the lookup to the store when known — store order ids collide across stores, so an
  // unscoped lookup could reverse a different store's identically-numbered order. Legacy
  // callers (and pre-migration NULL-store rows) keep the order-id-only behavior.
  const rows = await store.getCommissionsByExternalOrder(externalOrderId, storeConnectionId);
  if (rows.length === 0) {
    // Unknown / unattributed order — nothing was ever recorded. Ack, don't error.
    return { reversed: 0, alreadyReversed: false };
  }

  const toReverse = rows.filter((r) => r.status !== "reversed");
  if (toReverse.length === 0) {
    // Every row already clawed back — retried refund webhook is a no-op.
    return { reversed: 0, alreadyReversed: true };
  }

  let reversed = 0;
  for (const row of toReverse) {
    await store.updateCommissionTransactionStatus(row.id, "reversed");
    reversed++;

    // Reverse the campaign-affiliate rollup symmetric to the increment in
    // recordSaleCommissions — only for the publisher (campaign-attributed) row, and only
    // for rows we actually flipped, so a re-delivered refund can't decrement twice.
    if (row.campaignAffiliateId) {
      const ca = (await store.getCampaignAffiliates(row.videoId)).find(
        (c) => c.id === row.campaignAffiliateId,
      );
      if (ca) {
        const revenueCents = Math.max(0, toCents(ca.totalRevenue || "0") - toCents(row.saleAmount || "0"));
        const earningsCents = Math.max(0, toCents(ca.totalEarnings || "0") - toCents(row.commissionAmount || "0"));
        await store.updateCampaignAffiliateStats(row.campaignAffiliateId, {
          totalConversions: Math.max(0, (ca.totalConversions || 0) - 1),
          totalRevenue: centsToAmount(revenueCents),
          totalEarnings: centsToAmount(earningsCents),
        });
      }
    }
  }

  return { reversed, alreadyReversed: false };
}
