import { storage } from "./storage";

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
export async function isBrandInventoryDiscoverable(brandId: string): Promise<boolean> {
  const brand = await storage.getBrand(brandId);
  if (!brand) return false;

  // (a) Admin-granted window. Checked FIRST and independently of ownership: the
  // whole point is to switch on a brand that has accepted and paid the $29 but
  // has no subscription — and possibly no owner account yet. Compared at read
  // time, so the window self-expires with no scheduler.
  if (brand.inventoryAccessUntil && brand.inventoryAccessUntil.getTime() > Date.now()) {
    return true;
  }

  // (b) Active subscription. Unchanged.
  if (!brand.ownerId) return false;
  const sub = await storage.getBrandSubscription(brand.ownerId);
  return sub?.status === "active";
}
