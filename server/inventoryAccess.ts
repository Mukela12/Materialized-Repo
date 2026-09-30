import { storage } from "./storage";
import { hasFreeAccess, owesCardOnFile, type EntitlementUser } from "./entitlement";

/**
 * Is a brand's INVENTORY discoverable to other users?
 *
 * Client rule (28 Jul 2026): "their inventory is discoverable while tag a brand
 * is selected from the drop-down list" — i.e. any brand can be TAGGED whether or
 * not it subscribes (that is the acquisition funnel: tag -> $29 setup + 30-day
 * trial -> subscribe), but its products only become available to creators once
 * the brand is subscribed. Subscribing is what makes a brand's videos shoppable.
 *
 * 'active' covers Stripe's `trialing` too (see mapStripeStatus), so a brand in
 * its 30-day trial is discoverable — which is the point of the trial.
 *
 * This gates DISCOVERY only. Already-published videos are unaffected: the public
 * embed renders stored video_product_overlays rows, never a live product query,
 * so a lapsed subscription cannot retroactively break a creator's live video or
 * their tracked sales.
 */
/**
 * The decision itself, with no database: three independent grants.
 *
 * (c) was missing (found 30 Sep 2026, before the client's Brooklyn test).
 * Voucher brands and every new brand on the 14-day trial get their access
 * from a free window on the account, not a Stripe subscription, so none of
 * them had a discoverable catalog: creators could not see their products and
 * the AI scan skipped them. The free window now counts, through the same
 * hasFreeAccess the rest of the app uses, so the catalog opens and lapses on
 * exactly the dates the account does. Admin-owned brands (the platform's own
 * demo catalog) count as well, as they do everywhere else.
 */
export function inventoryDiscoverable(
  brand: { ownerId?: string | null; inventoryAccessUntil?: Date | null } | null | undefined,
  owner: (EntitlementUser & { isAdmin?: boolean | null; role?: string | null }) | null | undefined,
  subscriptionStatus: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!brand) return false;

  // (a) Admin-granted window. Checked FIRST and independently of ownership: the
  // whole point is to switch on a brand that has accepted and paid the $29 but
  // has no subscription — and possibly no owner account yet. Compared at read
  // time, so the window self-expires with no scheduler.
  if (brand.inventoryAccessUntil && brand.inventoryAccessUntil.getTime() > now.getTime()) return true;

  if (!brand.ownerId) return false;
  // (b) Active subscription. Unchanged.
  if (subscriptionStatus === "active") return true;
  // (c) The owner's free window (voucher or trial), or an admin owner. Brand
  // accounts only: every signup gets a trial window, and a creator who makes
  // a brand of their own through the API is not a brand on the platform. And
  // on the same terms as the account itself: once the card-on-file rule wakes
  // (2027), a voucher brand without a card loses both together.
  if (!owner) return false;
  if (owner.isAdmin) return true;
  return owner.role === "brand" && hasFreeAccess(owner, now) && !owesCardOnFile(owner, now);
}

export async function isBrandInventoryDiscoverable(brandId: string): Promise<boolean> {
  const brand = await storage.getBrand(brandId);
  if (!brand) return false;
  if (inventoryDiscoverable(brand, null, null)) return true;
  if (!brand.ownerId) return false;
  const [sub, owner] = await Promise.all([
    storage.getBrandSubscription(brand.ownerId),
    storage.getUser(brand.ownerId),
  ]);
  return inventoryDiscoverable(brand, owner, sub?.status);
}
