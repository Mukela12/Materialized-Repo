/**
 * WHAT THE PLATFORM IS OWED, recorded per verified store order.
 *
 * The mirror image of server/commissions.ts. That module persists the money
 * going OUT — creator and publisher commissions. This one persists the money
 * coming IN: the marketplace fee the brand owes Materialized.
 *
 * ── Why this had to be written ───────────────────────────────────────────────
 * computeSaleSplit() has always returned `marketplaceFeeCents` and
 * `platformCents`. recordSaleCommissions() put them in its return value. The
 * store-order webhook echoed them back in the HTTP response. And that was the
 * end of them — nothing wrote them down. An audit of every table in the schema
 * found no fee, revenue, or receivable table of any kind, so there was literally
 * no row to invoice a brand from.
 *
 * ── This is a ledger, not a payment path ─────────────────────────────────────
 * A Stripe application fee only exists on a charge the PLATFORM creates. Brand
 * sales happen on the brand's own storefront and settle into the brand's own
 * Stripe account; Materialized is never in that payment path, so there is
 * nothing for Stripe to take a percentage of. No dashboard setting changes that.
 *
 * Recording what is owed and invoicing for it is the honest mechanism, and it
 * has a consequence worth stating plainly to anyone selling this: an invoice can
 * be disputed or go unpaid, whereas an application fee cannot. Do not add code
 * here that implies the money collects itself.
 *
 * ── Unattributed orders are recorded too ─────────────────────────────────────
 * They used to return early and write nothing, which made two very different
 * situations identical: a sale that had nothing to do with Materialized, and a
 * sale that a Materialized link DID drive but whose attribution broke. The
 * second is lost revenue. Both are now rows, distinguished by
 * `attributionState`, and only `attributed` rows carry a fee.
 */
import { computeSaleSplit, toCents, type SaleSplit } from "./feeConfig";

/** Why a sale did or did not earn the platform a fee. */
export type AttributionState =
  | "attributed"
  | "no_ref"
  | "ref_unresolved"
  | "video_missing";

export interface FeeAccrualInput {
  storeConnectionId: string;
  /** The brand that owes the fee — denormalised so an invoice outlives the connection. */
  brandUserId: string;
  externalOrderId: string;
  videoId?: string | null;
  currency: string;
  /** Gross order total, as the store reported it. */
  saleAmount: string;
  attributionState: AttributionState;
  /** Present only when attributionState is "attributed". */
  split?: SaleSplit;
}

export interface AccrualRow {
  storeConnectionId: string;
  brandUserId: string;
  externalOrderId: string;
  videoId: string | null;
  currency: string;
  saleCents: number;
  marketplaceFeeCents: number;
  creatorCents: number;
  publisherCents: number;
  platformCents: number;
  marketplaceFeePct: string;
  attributionState: AttributionState;
  occurredAt: Date;
}

/** Minimal storage surface — keeps this unit-testable without a database. */
export interface FeeAccrualStore {
  createPlatformFeeAccrual(row: AccrualRow): Promise<{ id: string }>;
  voidPlatformFeeAccrual(
    storeConnectionId: string,
    externalOrderId: string,
  ): Promise<{ voided: boolean; alreadyVoided: boolean; wasInvoiced: boolean }>;
}

export interface RecordedAccrual {
  id?: string;
  /** True when the unique index rejected a retry of the same order. */
  deduped?: boolean;
  feeCents: number;
}

/** True for a Postgres unique-violation (SQLSTATE 23505). Mirrors commissions.ts. */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as any)?.code ?? (err as any)?.cause?.code;
  return code === "23505";
}

/**
 * Turn a verified order into the accrual row for it.
 *
 * Pure, so the arithmetic and the zero-fee rule can be tested without a store.
 * A fee is charged ONLY for an attributed sale — billing a brand 15% of an order
 * Materialized had no part in would be indefensible, and billing them for one
 * whose attribution broke would be charging for something we cannot evidence.
 */
export function buildAccrualRow(input: FeeAccrualInput, now: Date): AccrualRow {
  const saleCents = Math.max(0, toCents(input.saleAmount));
  const attributed = input.attributionState === "attributed" && !!input.split;
  const split = attributed ? input.split! : null;

  return {
    storeConnectionId: input.storeConnectionId,
    brandUserId: input.brandUserId,
    externalOrderId: input.externalOrderId,
    videoId: input.videoId ?? null,
    currency: input.currency.toLowerCase(),
    saleCents,
    marketplaceFeeCents: split ? split.marketplaceFeeCents : 0,
    creatorCents: split ? split.creatorCents : 0,
    publisherCents: split ? split.publisherCents : 0,
    platformCents: split ? split.platformCents : 0,
    marketplaceFeePct: split ? split.effectiveRates.marketplaceFeePct.toFixed(2) : "0.00",
    attributionState: input.attributionState,
    occurredAt: now,
  };
}

/**
 * Persist the accrual for one verified order.
 *
 * NEVER THROWS ON A DUPLICATE. Stores retry webhooks, and the pre-existing
 * order-level guard checks commission_transactions — which has no row at all for
 * an unattributed order and therefore cannot protect this table. The unique
 * index on (store_connection_id, external_order_id) is the real guard, and a
 * violation is an idempotent no-op, exactly as in recordSaleCommissions.
 */
export async function recordFeeAccrual(
  store: FeeAccrualStore,
  input: FeeAccrualInput,
  now: Date = new Date(),
): Promise<RecordedAccrual> {
  const row = buildAccrualRow(input, now);
  try {
    const created = await store.createPlatformFeeAccrual(row);
    return { id: created.id, feeCents: row.marketplaceFeeCents };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return { deduped: true, feeCents: row.marketplaceFeeCents };
  }
}

/**
 * Void the accrual for a refunded order, so it is never invoiced.
 *
 * Voids rather than deletes: if the fee was already invoiced, the row is the
 * evidence that a credit is owed. `wasInvoiced` is surfaced so the caller can
 * say so out loud rather than silently leaving a brand billed for a refund.
 */
export async function voidFeeAccrual(
  store: FeeAccrualStore,
  storeConnectionId: string,
  externalOrderId: string,
) {
  return store.voidPlatformFeeAccrual(storeConnectionId, externalOrderId);
}

/**
 * Recompute the split for a sale, for callers that only have the raw numbers.
 * Thin wrapper so route code does not import feeConfig directly just for this.
 */
export function splitForAccrual(
  saleAmount: string,
  opts: { hasPublisher: boolean; marketplaceFeePct?: number; creatorPct?: number; publisherPct?: number },
): SaleSplit {
  return computeSaleSplit(toCents(saleAmount), opts);
}
