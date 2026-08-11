/**
 * The creator's share of a subscription they brought in.
 *
 * The client: "Can we determine the 5% Bonus for Creators when their tagged
 * brands subscribe? This payout will need to be issued from MTRLZD Stripe of
 * course, separate to the Brand's independent affiliate program and payouts
 * agenda."
 *
 * ── What this is NOT ─────────────────────────────────────────────────────────
 * There is already a brand-conversion reward: one wallet token, $49, minted
 * once per brand when it first pays (server/wallet.ts). That is a token, it is
 * not withdrawable, and it fires exactly once. This is cash, it recurs, and it
 * rides the same rails as sale commissions — approved rows, batched by the
 * payout engine, transferred over Connect from the platform account. Both can
 * exist; whether they should is a commercial decision, recorded in the notes
 * for the client rather than silently made here.
 *
 * ── RECURRING, not one-off ───────────────────────────────────────────────────
 * "when their tagged brands subscribe" reads either way. It is implemented as
 * 5% of EVERY successful subscription payment, because that is what "separate
 * to the Brand's ... payouts agenda" implies — an agenda is ongoing — and
 * because it is the standard shape of a referral share. Changing it to
 * first-invoice-only is a one-line change at the call site, deliberately: the
 * decision lives with the client, not in the arithmetic.
 *
 * ── Why the amount is computed from Stripe's own number ──────────────────────
 * `amount_paid` on the invoice, never the plan's list price. A brand on a
 * discount, a proration, a partial credit or a currency the catalogue does not
 * know about must earn 5% OF WHAT WAS ACTUALLY PAID. Reading the list price
 * instead would pay a creator on money that never arrived.
 */
import { resolveBrandConversionAttribution, type BrandTagCandidate } from "./wallet";

/** 5%, as the client specified. */
export const CREATOR_SUBSCRIPTION_BONUS_PCT = 5;

export interface BonusInput {
  /** The user whose card was charged — the brand owner. */
  subscriberUserId: string;
  /** Stripe's own `invoice.amount_paid`, in cents. */
  amountPaidCents: number;
  /** Identifies this invoice, and is what makes a repeat delivery a no-op. */
  stripeInvoiceId: string;
  stripeSubscriptionId?: string | null;
  /** Percentage override, for an admin-adjusted rate. Defaults to 5. */
  ratePct?: number;
}

export type BonusRefusal =
  | { earned: false; reason: "no_payment" }
  | { earned: false; reason: "no_owned_brand" }
  | { earned: false; reason: "no_attribution" }
  | { earned: false; reason: "rounds_to_zero" }
  | { earned: false; reason: "already_recorded" };

export interface BonusEarned {
  earned: true;
  creatorId: string;
  brandId: string;
  attributedVideoId: string | null;
  attributionMethod: string;
  basisCents: number;
  ratePct: number;
  amountCents: number;
}

export type BonusResult = BonusEarned | BonusRefusal;

/**
 * The bonus on one payment, in cents.
 *
 * Rounds DOWN. A half-cent cannot be transferred, and rounding up would pay out
 * marginally more than 5% of what came in — across thousands of invoices that
 * is a slow, unexplained leak from the platform's own margin. Down is the
 * direction that can only ever under-pay by less than a cent, which is
 * recoverable and which nobody disputes.
 */
export function bonusCents(basisCents: number, ratePct: number = CREATOR_SUBSCRIPTION_BONUS_PCT): number {
  if (!Number.isFinite(basisCents) || basisCents <= 0) return 0;
  if (!Number.isFinite(ratePct) || ratePct <= 0) return 0;
  return Math.floor((basisCents * ratePct) / 100);
}

/** Everything the resolver needs about the subscriber's brands. */
export interface BonusStore {
  getBrandsByOwnerId(userId: string): Promise<Array<{ id: string }>>;
  getEarliestTaggingCreatorForBrand(
    brandId: string,
  ): Promise<{ creatorId: string; videoId: string; taggedAt: Date | null } | null>;
}

/**
 * Who earns what on this invoice.
 *
 * Attribution deliberately reuses resolveBrandConversionAttribution — the same
 * first-touch rule, the same total ordering, and critically the same SELF-MINT
 * GUARD. Without it a user could create a brand they own, tag it in their own
 * video, subscribe, and pay themselves 5% of their own subscription every month
 * forever. A second implementation of that rule is a second place for the guard
 * to be forgotten.
 */
export async function computeCreatorBonus(
  store: BonusStore,
  input: BonusInput,
): Promise<BonusResult> {
  const { subscriberUserId, amountPaidCents } = input;
  const ratePct = input.ratePct ?? CREATOR_SUBSCRIPTION_BONUS_PCT;

  if (!(amountPaidCents > 0)) return { earned: false, reason: "no_payment" };

  const ownedBrands = await store.getBrandsByOwnerId(subscriberUserId);
  if (ownedBrands.length === 0) return { earned: false, reason: "no_owned_brand" };

  // One candidate per owned brand, exactly as the token mint does — so a
  // subscriber owning three tagged brands still yields ONE bonus per invoice
  // rather than three.
  const candidates: BrandTagCandidate[] = [];
  for (const brand of ownedBrands) {
    const tag = await store.getEarliestTaggingCreatorForBrand(brand.id);
    if (!tag) continue;
    candidates.push({
      brandId: brand.id,
      creatorId: tag.creatorId,
      videoId: tag.videoId,
      taggedAt: tag.taggedAt,
      brandReferralId: null,
    });
  }

  const attribution = resolveBrandConversionAttribution({ subscriberUserId, candidates });
  if (!attribution) return { earned: false, reason: "no_attribution" };

  const amountCents = bonusCents(amountPaidCents, ratePct);
  // A payment so small that 5% is under a cent earns nothing rather than a zero
  // row: a zero-value payable is noise in every report it appears in.
  if (amountCents <= 0) return { earned: false, reason: "rounds_to_zero" };

  return {
    earned: true,
    creatorId: attribution.creatorId,
    brandId: attribution.brandId,
    attributedVideoId: attribution.videoId,
    attributionMethod: attribution.method,
    basisCents: amountPaidCents,
    ratePct,
    amountCents,
  };
}
