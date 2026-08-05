/**
 * Buying from inside the video.
 *
 * This is the path where the 15% is genuinely RETAINED rather than invoiced.
 * The platform creates the charge on the brand's connected account, Stripe
 * routes the brand their share and withholds our fee in the same movement, and
 * the brand stays merchant of record. Nothing is billed afterwards, so nothing
 * can go unpaid.
 *
 * ── The double-charge trap this module exists to avoid ───────────────────────
 * There are now TWO ways the platform gets its fee:
 *
 *   invoicing      the brand's own checkout took the money; we record what they
 *                  owe (platform_fee_accruals) and bill it later
 *   in-video       Stripe withheld the fee at the moment of the charge
 *
 * A sale that went through in-video checkout has ALREADY paid us. If it were
 * also written as an `accrued` row, the monthly invoice run would bill the brand
 * a second time for money we had already taken. So the accrual for an in-video
 * order is written as `paid` — it stays in the ledger for reporting, and the
 * invoice claim query, which only takes `status = 'accrued'`, cannot pick it up.
 *
 * ── What must never come from the client ─────────────────────────────────────
 * The price. It is read from the overlay row every time. A checkout that trusts
 * a client-supplied amount is a checkout where the shopper decides what to pay,
 * and it would be indistinguishable from a legitimate order afterwards.
 */
import { computeSaleSplit, type SaleSplit } from "./feeConfig";

export interface PurchasableProduct {
  overlayId: number;
  videoId: string;
  name: string;
  imageUrl: string | null;
  /** Authoritative amount, from the database. Never from the request. */
  priceCents: number | null;
  currency: string | null;
}

export interface SellerAccount {
  brandUserId: string;
  stripeAccountId: string | null;
  chargesEnabled: boolean;
}

export type CheckoutRefusal =
  | { ok: false; reason: "not_purchasable"; message: string }
  | { ok: false; reason: "brand_not_ready"; message: string }
  | { ok: false; reason: "amount_invalid"; message: string };

export interface CheckoutQuote {
  ok: true;
  amountCents: number;
  currency: string;
  applicationFeeCents: number;
  split: SaleSplit;
}

/**
 * Decide whether this product can be sold right now, and for how much.
 *
 * Pure, and deliberately refuses rather than guesses. Every refusal here is a
 * case where charging would produce a mess someone has to unpick by hand: a
 * £0 order, a charge to an account Stripe will reject, or a sale whose price
 * nobody actually set.
 */
export function quoteCheckout(
  product: PurchasableProduct,
  seller: SellerAccount,
  rates?: { marketplaceFeePct?: number; creatorPct?: number; publisherPct?: number },
  opts: { hasPublisher?: boolean } = {},
): CheckoutQuote | CheckoutRefusal {
  if (product.priceCents == null) {
    return {
      ok: false, reason: "not_purchasable",
      message: "This product has no price set, so it cannot be bought in-video.",
    };
  }
  if (!Number.isInteger(product.priceCents) || product.priceCents <= 0) {
    return {
      ok: false, reason: "amount_invalid",
      message: "Product price must be a positive whole number of cents.",
    };
  }
  // Stripe's floor. Below it the charge is rejected, so refuse clearly rather
  // than surfacing a Stripe error to a shopper mid-purchase.
  if (product.priceCents < 50) {
    return {
      ok: false, reason: "amount_invalid",
      message: "Product price is below the minimum chargeable amount.",
    };
  }
  if (!seller.stripeAccountId) {
    return {
      ok: false, reason: "brand_not_ready",
      message: "This brand has not connected a payout account yet.",
    };
  }
  if (!seller.chargesEnabled) {
    // Receiving payouts and accepting cards are separate Stripe capabilities.
    // An account can be perfectly healthy for one and unable to do the other.
    return {
      ok: false, reason: "brand_not_ready",
      message: "This brand's payment account is not yet approved to accept payments.",
    };
  }

  const split = computeSaleSplit(product.priceCents, {
    hasPublisher: !!opts.hasPublisher,
    marketplaceFeePct: rates?.marketplaceFeePct,
    creatorPct: rates?.creatorPct,
    publisherPct: rates?.publisherPct,
  });

  // The whole marketplace fee is withheld by Stripe. Creator and publisher
  // commissions are then paid OUT of it by the existing payout engine, exactly
  // as on the invoicing path — the split arithmetic is shared so the two routes
  // cannot disagree about what anyone earns.
  const applicationFeeCents = split.marketplaceFeeCents;

  // Defensive: Stripe rejects an application fee that meets or exceeds the
  // charge, and a misconfigured 100% fee would otherwise pay the brand nothing.
  if (applicationFeeCents >= product.priceCents) {
    return {
      ok: false, reason: "amount_invalid",
      message: "Marketplace fee is not less than the sale amount; check the fee configuration.",
    };
  }

  return {
    ok: true,
    amountCents: product.priceCents,
    currency: (product.currency || "usd").toLowerCase(),
    applicationFeeCents,
    split,
  };
}

/**
 * Turn the price a creator typed into a chargeable amount, or refuse.
 *
 * The overlay price field is free text and always has been — "49", "$49.00",
 * "£20", "from £20", "POA". Existing rows are full of it, and asking every
 * creator to re-enter prices in a new field would leave the feature unusable
 * until they did. So the text is parsed, STRICTLY.
 *
 * Strict is the whole point. A permissive parser that reads "from £20" as 2000
 * would sell a £200 coat for £20, and the order would look entirely legitimate
 * afterwards — nobody finds out until the brand reconciles. Anything that is not
 * unambiguously one number is refused, and refusing only means the product is
 * not buyable in-video; the card still renders and still links out.
 *
 * Returns null for anything it will not vouch for.
 */
export function parsePriceToCents(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;

  // Strip one leading currency symbol and surrounding space. Deliberately not
  // stripping trailing text: "20 or best offer" must NOT become 2000.
  const cleaned = raw.trim().replace(/^[$£€]\s?/, "").replace(/,/g, "");
  if (cleaned === "") return null;

  // The whole remaining string must be a plain number with at most 2 decimals.
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const cents = Math.round(parseFloat(cleaned) * 100);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  return cents;
}

/**
 * Idempotency key for a checkout attempt.
 *
 * Keyed on the shopper's session attempt rather than the product, because a
 * shopper who abandons and comes back genuinely wants a NEW session — unlike a
 * payout retry, where replaying the same key is the entire point.
 */
export function checkoutIdempotencyKey(videoId: string, overlayId: number, nonce: string): string {
  return `ivc_${videoId}_${overlayId}_${nonce}`;
}
