/**
 * The 5% creator bonus on a tagged brand's subscription.
 *
 * The client: "Can we determine the 5% Bonus for Creators when their tagged
 * brands subscribe? This payout will need to be issued from MTRLZD Stripe of
 * course, separate to the Brand's independent affiliate program."
 *
 * ── What these tests are defending ───────────────────────────────────────────
 * This is real money leaving the platform account on a schedule, so the
 * failures worth writing down are the ones that pay somebody who should not be
 * paid, or pay them repeatedly:
 *
 *   - a user who owns a brand, tags it in their own video and subscribes,
 *     paying themselves 5% of their own bill every month forever;
 *   - a subscriber owning several tagged brands earning one bonus per brand
 *     against a single invoice;
 *   - the bonus computed from the plan's list price rather than what was
 *     actually paid, so a discounted or part-paid invoice over-pays.
 */
import { describe, it, expect } from "vitest";
import {
  bonusCents, computeCreatorBonus, CREATOR_SUBSCRIPTION_BONUS_PCT,
  type BonusStore,
} from "../../server/creatorBonus";

const CREATOR = "creator-1";
const SUBSCRIBER = "brand-owner-1";

function store(over: Partial<BonusStore> = {}): BonusStore {
  return {
    getBrandsByOwnerId: async () => [{ id: "brand-a" }],
    getEarliestTaggingCreatorForBrand: async () => ({
      creatorId: CREATOR, videoId: "video-1", taggedAt: new Date("2026-01-01"),
    }),
    ...over,
  };
}

const input = (over: Partial<Parameters<typeof computeCreatorBonus>[1]> = {}) => ({
  subscriberUserId: SUBSCRIBER,
  amountPaidCents: 24900,
  stripeInvoiceId: "in_1",
  ...over,
});

describe("the rate", () => {
  it("is 5%, as specified", () => {
    expect(CREATOR_SUBSCRIPTION_BONUS_PCT).toBe(5);
  });

  it("takes 5% of the amount actually paid", () => {
    expect(bonusCents(24900)).toBe(1245); // $249 -> $12.45
    expect(bonusCents(14900)).toBe(745);  // $149 -> $7.45
    expect(bonusCents(49900)).toBe(2495); // $499 -> $24.95
  });

  it("rounds DOWN, never up", () => {
    // Up would pay marginally more than 5% of what came in — across thousands
    // of invoices, an unexplained leak from the platform's own margin. Down can
    // only under-pay by less than a cent.
    expect(bonusCents(1999)).toBe(99);   // 99.95 -> 99
    expect(bonusCents(19)).toBe(0);      // 0.95  -> 0
    expect(bonusCents(21)).toBe(1);      // 1.05  -> 1
  });

  it("never returns something negative or absurd", () => {
    for (const v of [0, -1, -100000, NaN, Infinity]) {
      expect(bonusCents(v as number)).toBe(0);
    }
    for (const r of [0, -5, NaN]) {
      expect(bonusCents(24900, r as number)).toBe(0);
    }
  });

  it("honours an admin-adjusted rate", () => {
    expect(bonusCents(24900, 10)).toBe(2490);
  });
});

describe("who earns it", () => {
  it("pays the creator who first tagged the brand", async () => {
    const r = await computeCreatorBonus(store(), input());
    expect(r.earned).toBe(true);
    if (!r.earned) return;
    expect(r.creatorId).toBe(CREATOR);
    expect(r.brandId).toBe("brand-a");
    expect(r.amountCents).toBe(1245);
    expect(r.basisCents).toBe(24900);
    expect(r.attributedVideoId).toBe("video-1");
  });

  it("REFUSES to pay someone 5% of their own subscription", async () => {
    // A user can create a brand they own, tag it in their own video and
    // subscribe. Without the self-mint guard that is a standing order from the
    // platform to themselves, every month, forever.
    const selfTagged = store({
      getEarliestTaggingCreatorForBrand: async () => ({
        creatorId: SUBSCRIBER, videoId: "video-1", taggedAt: new Date(),
      }),
    });
    const r = await computeCreatorBonus(selfTagged, input());
    expect(r.earned).toBe(false);
    expect((r as any).reason).toBe("no_attribution");
  });

  it("pays ONE bonus when the subscriber owns several tagged brands", async () => {
    // Three owned brands against one $249 invoice must not become 3 x $12.45.
    const many = store({
      getBrandsByOwnerId: async () => [{ id: "b1" }, { id: "b2" }, { id: "b3" }],
      getEarliestTaggingCreatorForBrand: async (id) => ({
        creatorId: `creator-${id}`, videoId: `video-${id}`, taggedAt: new Date("2026-01-0" + id.slice(-1)),
      }),
    });
    const r = await computeCreatorBonus(many, input());
    expect(r.earned).toBe(true);
    if (!r.earned) return;
    expect(r.amountCents).toBe(1245); // one bonus, not three
  });

  it("earns nothing when nobody tagged the brand", async () => {
    const untagged = store({ getEarliestTaggingCreatorForBrand: async () => null });
    expect((await computeCreatorBonus(untagged, input())).earned).toBe(false);
  });

  it("earns nothing when the subscriber owns no brand", async () => {
    const none = store({ getBrandsByOwnerId: async () => [] });
    const r = await computeCreatorBonus(none, input());
    expect((r as any).reason).toBe("no_owned_brand");
  });
});

describe("what it is a percentage OF", () => {
  it("uses what was paid, not the plan's list price", async () => {
    // A discounted, prorated or part-paid invoice must earn 5% of the money
    // that actually arrived. Reading the catalogue price instead would pay a
    // creator on revenue the platform never received.
    const discounted = await computeCreatorBonus(store(), input({ amountPaidCents: 4900 }));
    expect(discounted.earned).toBe(true);
    if (!discounted.earned) return;
    expect(discounted.amountCents).toBe(245); // 5% of $49, not of $249
  });

  it("earns nothing on a zero or failed payment", async () => {
    for (const cents of [0, -100]) {
      const r = await computeCreatorBonus(store(), input({ amountPaidCents: cents }));
      expect(r.earned).toBe(false);
      expect((r as any).reason).toBe("no_payment");
    }
  });

  it("earns nothing rather than a zero row on a trivial payment", async () => {
    // A zero-value payable is noise in every report it lands in.
    const r = await computeCreatorBonus(store(), input({ amountPaidCents: 19 }));
    expect(r.earned).toBe(false);
    expect((r as any).reason).toBe("rounds_to_zero");
  });
});

describe("it recurs", () => {
  it("earns again on the next invoice for the same subscription", async () => {
    // Deliberate: 5% of every payment, not only the first. The one-per-brand
    // cap belongs to the $49 token, which is a different reward.
    const first = await computeCreatorBonus(store(), input({ stripeInvoiceId: "in_1" }));
    const second = await computeCreatorBonus(store(), input({ stripeInvoiceId: "in_2" }));
    expect(first.earned).toBe(true);
    expect(second.earned).toBe(true);
    if (!first.earned || !second.earned) return;
    expect(second.amountCents).toBe(first.amountCents);
  });
});
