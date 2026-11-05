/**
 * Paying the Global Video Library listing fee by card.
 *
 * Until 5 Nov 2026 the listing could only be paid in tokens, and brands earn
 * none, so a brand could never list a video. The client then made the first
 * paid listing the key that opens the library for a brand, which made a card
 * route necessary rather than nice to have.
 *
 * The card is taken on Stripe's hosted Checkout page. A listing goes live only
 * when Stripe says the session is paid, from either of two places: the return
 * to the app (confirm) or the checkout.session.completed webhook, whichever
 * arrives first. Both run the same check below, so neither can publish a
 * listing the other would have refused.
 */
import type Stripe from "stripe";

export const LISTING_CHECKOUT_PURPOSE = "library_listing";

export interface ListingRef {
  id: string;
  creatorId: string;
  publishStatus?: string | null;
}

export type ListingCheckoutCheck =
  | { ok: true; paymentIntentId: string | null }
  | { ok: false; reason: string };

/**
 * Whether `session` is a paid checkout for exactly this listing, by its owner,
 * for the full fee. The metadata is ours (set when the session was created),
 * but the amount and the paid flag are Stripe's, so a session for some other
 * listing, user or amount never publishes this one.
 */
export function checkListingCheckout(
  session: Pick<Stripe.Checkout.Session, "mode" | "metadata" | "payment_status" | "amount_total" | "currency" | "payment_intent">,
  listing: ListingRef,
  expected: { amountCents: number; currency: string },
): ListingCheckoutCheck {
  if (session.mode !== "payment") return { ok: false, reason: "not a payment session" };
  if (session.metadata?.purpose !== LISTING_CHECKOUT_PURPOSE) return { ok: false, reason: "not a listing checkout" };
  if (session.metadata?.listingId !== listing.id) return { ok: false, reason: "session is for another listing" };
  if (session.metadata?.userId !== listing.creatorId) return { ok: false, reason: "session is for another user" };
  if (session.payment_status !== "paid") return { ok: false, reason: "payment not completed" };
  if (session.amount_total !== expected.amountCents) return { ok: false, reason: "amount does not match the fee" };
  if ((session.currency ?? "").toLowerCase() !== expected.currency.toLowerCase()) {
    return { ok: false, reason: "currency does not match the fee" };
  }
  const pi = session.payment_intent;
  return { ok: true, paymentIntentId: typeof pi === "string" ? pi : pi?.id ?? null };
}

/** Where Checkout sends the payer back to: the page they paid from. */
export function listingReturnPath(role: string | null | undefined): string {
  return role === "brand" ? "/brand/my-videos" : "/creator/my-videos";
}
