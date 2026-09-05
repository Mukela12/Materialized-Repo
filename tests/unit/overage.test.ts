/**
 * Overage: the maths, and the job that turns it into money.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The previous overage path was deleted because the browser posted the amount —
 * "a route where the customer sets their own bill". This is the server-side
 * replacement, so the tests hold the promises that make it safe:
 *
 *   1. Amounts derive only from recorded usage and stored rates.
 *   2. Nothing is billed until a plan's billing_enabled is deliberately true —
 *      the first configured month is a dry run the client reviews.
 *   3. Subscribers are billed on their own renewal invoice; free-access
 *      accounts (card vaulted, no subscription) get a standalone auto-charged
 *      invoice — and never the other way round.
 */
import { describe, it, expect } from "vitest";
import { computeOverage, allowanceIsMetered } from "../../server/overage";
import { makeOverageJob } from "../../server/scheduledJobs";

const A = (over: Partial<Parameters<typeof computeOverage>[1]> = {}) => ({
  includedVideos: 10,
  includedViews: 50_000,
  overagePerVideoCents: 500,
  overagePer1000ViewsCents: 200,
  ...over,
});

describe("computeOverage", () => {
  it("charges nothing at or under the allowance", () => {
    expect(computeOverage({ videos: 10, views: 50_000 }, A()).totalCents).toBe(0);
    expect(computeOverage({ videos: 0, views: 0 }, A()).totalCents).toBe(0);
  });

  it("prices extra videos per unit", () => {
    const o = computeOverage({ videos: 13, views: 0 }, A());
    expect(o.videosOver).toBe(3);
    expect(o.videoOverageCents).toBe(1500);
  });

  it("prices views per STARTED thousand — 1,001 extra is two units", () => {
    const o = computeOverage({ videos: 0, views: 51_001 }, A());
    expect(o.viewsOver).toBe(1001);
    expect(o.viewOverageCents).toBe(400);
  });

  it("a null allowance is unlimited: that meter can never bill", () => {
    const o = computeOverage({ videos: 999, views: 9e9 }, A({ includedVideos: null, includedViews: null }));
    expect(o.totalCents).toBe(0);
    expect(allowanceIsMetered(A({ includedVideos: null, includedViews: null }))).toBe(false);
  });

  it("a null rate measures the excess but prices it at zero — the dry-run shape", () => {
    const o = computeOverage({ videos: 15, views: 0 }, A({ overagePerVideoCents: null }));
    expect(o.videosOver).toBe(5);
    expect(o.totalCents).toBe(0);
  });

  it("an allowance of zero means everything is overage — distinct from null", () => {
    const o = computeOverage({ videos: 2, views: 0 }, A({ includedVideos: 0 }));
    expect(o.videosOver).toBe(2);
    expect(o.videoOverageCents).toBe(1000);
  });
});

/** In-memory store + stripe, so the job runs for real. */
function harness(opts: {
  allowances?: any[];
  subs?: any[];
  free?: any[];
  usage?: Record<string, { videos: number; views: number }>;
  claimRejects?: boolean;
  stripeFails?: boolean;
} = {}) {
  const claimed: any[] = [];
  const billed: Array<[string, string]> = [];
  const failed: Array<[string, string]> = [];
  const stripeCalls: any[] = [];
  const standaloneCalls: any[] = [];
  const store = {
    getPlanAllowances: async () => opts.allowances ?? [{
      plan: "starter", includedVideos: 10, includedViews: 50_000,
      overagePerVideoCents: 500, overagePer1000ViewsCents: 200, billingEnabled: true,
    }],
    getSubscriptionsForOverage: async () => opts.subs ?? [{
      userId: "u1", plan: "starter", stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1",
    }],
    getFreeAccountsForOverage: async () => opts.free ?? [],
    countVideosInPeriod: async (uid: string) => opts.usage?.[uid]?.videos ?? 13,
    countBillableViewsInPeriod: async (uid: string) => opts.usage?.[uid]?.views ?? 0,
    claimOverageCharge: async (row: any) => {
      if (opts.claimRejects) return null;
      const rec = { ...row, id: "oc_" + (claimed.length + 1) };
      claimed.push(rec);
      return rec;
    },
    markOverageBilled: async (id: string, item: string) => { billed.push([id, item]); },
    markOverageFailed: async (id: string, err: string) => { failed.push([id, err]); },
  };
  const stripe = {
    createSubscriptionOverageItem: async (args: any) => {
      stripeCalls.push(args);
      if (opts.stripeFails) throw new Error("card country unsupported");
      return { id: "ii_" + stripeCalls.length };
    },
    createStandaloneOverageInvoice: async (args: any) => {
      standaloneCalls.push(args);
      if (opts.stripeFails) throw new Error("card declined");
      return { id: "in_" + standaloneCalls.length };
    },
  };
  const job = makeOverageJob(store as any, stripe as any, { now: () => new Date("2026-10-01T09:30:00Z") });
  return { job, claimed, billed, failed, stripeCalls, standaloneCalls };
}

describe("the monthly job", () => {
  it("bills a metered, enabled plan onto the subscription", async () => {
    const h = harness();
    const r = await h.job.run();
    expect(r.status).toBe("success");
    expect(h.claimed).toHaveLength(1);
    expect(h.stripeCalls).toHaveLength(1);
    // The window is the PREVIOUS month, derived from the occurrence.
    expect(h.claimed[0].periodStart.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(h.stripeCalls[0].subscriptionId).toBe("sub_1");
    expect(h.stripeCalls[0].amountCents).toBe(1500);
    // Idempotency key derives from the claim, so a crash after claim cannot double-bill.
    expect(h.stripeCalls[0].idempotencyKey).toBe("overage:oc_1");
    expect(h.billed).toEqual([["oc_1", "ii_1"]]);
  });

  it("records without billing when billing_enabled is false — the dry run", async () => {
    const h = harness({ allowances: [{
      plan: "starter", includedVideos: 10, includedViews: 50_000,
      overagePerVideoCents: 500, overagePer1000ViewsCents: 200, billingEnabled: false,
    }] });
    const r = await h.job.run();
    expect(h.claimed).toHaveLength(1);
    expect(h.stripeCalls).toHaveLength(0);
    expect(r.detail).toContain("dry run");
  });

  it("never touches Stripe when the claim is lost — the re-run case", async () => {
    const h = harness({ claimRejects: true });
    await h.job.run();
    expect(h.stripeCalls).toHaveLength(0);
    expect(h.billed).toHaveLength(0);
  });

  it("skips entirely with no allowances configured — safe to deploy inert", async () => {
    const h = harness({ allowances: [] });
    const r = await h.job.run();
    expect(r.status).toBe("skipped");
    expect(h.claimed).toHaveLength(0);
  });

  it("skips subscribers inside their allowance", async () => {
    const h = harness({ usage: { u1: { videos: 5, views: 100 } } });
    const r = await h.job.run();
    expect(r.status).toBe("skipped");
    expect(h.claimed).toHaveLength(0);
  });

  it("a Stripe failure marks the row failed and the run failed — owed money must be loud", async () => {
    const h = harness({ stripeFails: true });
    const r = await h.job.run();
    expect(r.status).toBe("failed");
    expect(h.failed).toHaveLength(1);
    expect(h.failed[0][1]).toContain("card country unsupported");
  });

  it("a plan with no allowance row is untouched", async () => {
    const h = harness({ subs: [{ userId: "u2", plan: "pro", stripeSubscriptionId: "sub_2", stripeCustomerId: "cus_2" }] });
    const r = await h.job.run();
    expect(r.status).toBe("skipped");
  });
});

describe("free accounts, billed standalone", () => {
  /** A creator-role free account maps to the creator plan via planForRole. */
  const CREATOR_ALLOWANCE = {
    plan: "creator", includedVideos: 10, includedViews: 50_000,
    overagePerVideoCents: 500, overagePer1000ViewsCents: 200, billingEnabled: true,
  };

  it("bills through a standalone invoice, never a subscription item", async () => {
    const h = harness({
      allowances: [CREATOR_ALLOWANCE],
      subs: [],
      free: [{ userId: "f1", role: "creator", stripeCustomerId: "cus_f1" }],
      usage: { f1: { videos: 12, views: 0 } },
    });
    const r = await h.job.run();
    expect(r.status).toBe("success");
    expect(h.standaloneCalls).toHaveLength(1);
    expect(h.stripeCalls).toHaveLength(0);
    expect(h.standaloneCalls[0].customerId).toBe("cus_f1");
    expect(h.standaloneCalls[0].amountCents).toBe(1000);
    expect(h.standaloneCalls[0].idempotencyKey).toBe("overage:oc_1");
    expect(h.billed).toEqual([["oc_1", "in_1"]]);
    expect(r.detail).toContain("invoiced to card on file");
  });

  it("dry-runs like everyone else until billing_enabled", async () => {
    const h = harness({
      allowances: [{ ...CREATOR_ALLOWANCE, billingEnabled: false }],
      subs: [],
      free: [{ userId: "f1", role: "creator", stripeCustomerId: "cus_f1" }],
      usage: { f1: { videos: 12, views: 0 } },
    });
    const r = await h.job.run();
    expect(h.claimed).toHaveLength(1);
    expect(h.standaloneCalls).toHaveLength(0);
    expect(r.detail).toContain("dry run");
  });

  it("a subscriber still rides the subscription; the free path does not steal them", async () => {
    const h = harness({
      allowances: [{ plan: "starter", includedVideos: 10, includedViews: 50_000,
        overagePerVideoCents: 500, overagePer1000ViewsCents: 200, billingEnabled: true }],
      free: [],
    });
    await h.job.run();
    expect(h.stripeCalls).toHaveLength(1);
    expect(h.standaloneCalls).toHaveLength(0);
  });

  it("a declined card marks the row failed and the run failed", async () => {
    const h = harness({
      allowances: [CREATOR_ALLOWANCE],
      subs: [],
      free: [{ userId: "f1", role: "creator", stripeCustomerId: "cus_f1" }],
      usage: { f1: { videos: 12, views: 0 } },
      stripeFails: true,
    });
    const r = await h.job.run();
    expect(r.status).toBe("failed");
    expect(h.failed[0][1]).toContain("card declined");
  });

  it("an unknown role has no plan and is skipped, not billed against nothing", async () => {
    const h = harness({
      allowances: [CREATOR_ALLOWANCE],
      subs: [],
      free: [{ userId: "f2", role: "mystery", stripeCustomerId: "cus_f2" }],
      usage: { f2: { videos: 999, views: 0 } },
    });
    const r = await h.job.run();
    expect(r.status).toBe("skipped");
    expect(h.claimed).toHaveLength(0);
  });
});
