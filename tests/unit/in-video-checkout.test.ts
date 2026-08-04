/**
 * Buying from inside the video — the path where the 15% is genuinely retained.
 *
 * Two properties matter more than anything else here, and both are ways to lose
 * real money rather than merely render something wrong:
 *
 *   1. THE PRICE COMES FROM THE DATABASE. This endpoint is public — the embed
 *      runs on the brand's own site with no session — so a client-supplied
 *      amount would let a shopper pay one cent for anything, and the resulting
 *      order would look completely legitimate afterwards.
 *
 *   2. THE FEE IS NOT COLLECTED TWICE. There are now two routes to the
 *      marketplace fee: invoice the brand later, or have Stripe withhold it at
 *      the charge. An in-video sale has already paid us. Recorded as `accrued`
 *      it would ALSO be invoiced next month — billing the brand a second time
 *      for money we already hold.
 */
import { describe, it, expect } from "vitest";
import { quoteCheckout, checkoutIdempotencyKey } from "../../server/inVideoCheckout";
import { buildAccrualRow } from "../../server/feeAccruals";
import { computeSaleSplit } from "../../server/feeConfig";

const product = (over: Partial<Parameters<typeof quoteCheckout>[0]> = {}) => ({
  overlayId: 1, videoId: "vid_1", name: "Silk Scarf",
  imageUrl: null, priceCents: 10000, currency: "usd", ...over,
});
const seller = (over: Partial<Parameters<typeof quoteCheckout>[1]> = {}) => ({
  brandUserId: "brand_1", stripeAccountId: "acct_1", chargesEnabled: true, ...over,
});
const RATES = { marketplaceFeePct: 15, creatorPct: 0, publisherPct: 2 };

describe("what the shopper is charged", () => {
  it("uses the stored price, and withholds the marketplace fee for the platform", () => {
    const q = quoteCheckout(product(), seller(), RATES, { hasPublisher: true });
    expect(q.ok).toBe(true);
    if (!q.ok) return;

    expect(q.amountCents).toBe(10000);           // from the database
    expect(q.applicationFeeCents).toBe(1500);    // 15%, withheld by Stripe
    expect(q.split.publisherCents).toBe(200);    // paid out of the fee, as before
    expect(q.split.platformCents).toBe(1300);
  });

  it("uses the same split arithmetic as the on-store path", () => {
    // The two routes must never disagree about what anyone earns.
    const q = quoteCheckout(product(), seller(), RATES, { hasPublisher: true });
    const direct = computeSaleSplit(10000, { hasPublisher: true, ...RATES });
    expect(q.ok && q.split).toEqual(direct);
  });

  it("lowercases the currency Stripe expects", () => {
    const q = quoteCheckout(product({ currency: "USD" }), seller(), RATES);
    expect(q.ok && q.currency).toBe("usd");
  });
});

describe("what it refuses to sell", () => {
  it("a product with no price", () => {
    const q = quoteCheckout(product({ priceCents: null }), seller(), RATES);
    expect(q.ok).toBe(false);
    expect(!q.ok && q.reason).toBe("not_purchasable");
  });

  it("a zero or negative price", () => {
    expect(quoteCheckout(product({ priceCents: 0 }), seller(), RATES).ok).toBe(false);
    expect(quoteCheckout(product({ priceCents: -500 }), seller(), RATES).ok).toBe(false);
  });

  it("a price below Stripe's floor, rather than surfacing a Stripe error mid-purchase", () => {
    const q = quoteCheckout(product({ priceCents: 25 }), seller(), RATES);
    expect(!q.ok && q.reason).toBe("amount_invalid");
  });

  it("a fractional price that could not be charged", () => {
    const q = quoteCheckout(product({ priceCents: 100.5 as any }), seller(), RATES);
    expect(!q.ok && q.reason).toBe("amount_invalid");
  });

  it("a brand with no connected account", () => {
    const q = quoteCheckout(product(), seller({ stripeAccountId: null }), RATES);
    expect(!q.ok && q.reason).toBe("brand_not_ready");
  });

  it("a brand that can receive payouts but cannot ACCEPT payments", () => {
    // Different Stripe capabilities. An account healthy for transfers can still
    // have card_payments unverified, and the charge would fail at the worst
    // possible moment — with the shopper's details already entered.
    const q = quoteCheckout(product(), seller({ chargesEnabled: false }), RATES);
    expect(!q.ok && q.reason).toBe("brand_not_ready");
  });

  it("a fee configured at or above the whole sale", () => {
    // Stripe rejects it, and it would pay the brand nothing.
    const q = quoteCheckout(product(), seller(), { marketplaceFeePct: 100, creatorPct: 0, publisherPct: 0 });
    expect(!q.ok && q.reason).toBe("amount_invalid");
  });
});

describe("not collecting the fee twice", () => {
  const split = computeSaleSplit(10000, { hasPublisher: true, ...RATES });
  const base = {
    storeConnectionId: "vid_1", brandUserId: "brand_1", externalOrderId: "cs_1",
    currency: "usd", saleAmount: "100.00", attributionState: "attributed" as const, split,
  };

  it("writes an in-video sale as PAID, so the invoice run cannot bill it again", () => {
    const row = buildAccrualRow({ ...base, alreadyCollected: true }, new Date());
    // The invoice claim query takes only status = 'accrued'.
    expect(row.status).toBe("paid");
  });

  it("still records the fee, because it is real revenue", () => {
    const row = buildAccrualRow({ ...base, alreadyCollected: true }, new Date());
    expect(row.marketplaceFeeCents).toBe(1500);
    expect(row.platformCents).toBe(1300);
  });

  it("writes an on-store sale as ACCRUED, because that one still has to be billed", () => {
    const row = buildAccrualRow(base, new Date());
    expect(row.status).toBe("accrued");
  });
});

describe("the checkout idempotency key", () => {
  it("is unique per attempt — a shopper returning wants a NEW session", () => {
    // Deliberately unlike the payout key, where replaying the same key is the
    // whole point. Reusing a key here would resurrect an abandoned session.
    expect(checkoutIdempotencyKey("v1", 1, "nonce-a"))
      .not.toBe(checkoutIdempotencyKey("v1", 1, "nonce-b"));
  });

  it("identifies the video and product it belongs to", () => {
    expect(checkoutIdempotencyKey("v1", 7, "n")).toBe("ivc_v1_7_n");
  });
});
