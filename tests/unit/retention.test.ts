/**
 * Retention: what may be deleted, and the several things that may not.
 *
 * ── Why the protections get more tests than the deletion ─────────────────────
 * This is the only job in the system that destroys something. Every other money
 * job can be re-run; a deleted file cannot be un-deleted, and a video embedded
 * on a magazine's page takes that page dark and stops the attribution that pays
 * the publisher. So the tests are weighted towards proving the things that must
 * survive survive — and towards the dry run, which is what actually ships.
 */
import { describe, it, expect } from "vitest";
import { judgeRetention, deletionEnabled, addDays, DEFAULT_GRACE_DAYS } from "../../server/retention";
import { makeRetentionJob } from "../../server/scheduledJobs";

const NOW = new Date("2026-09-09T04:00:00Z");
/** Lapsed well past any grace period. */
const LONG_LAPSED = new Date("2026-01-01T00:00:00Z");

const candidate = (over: Record<string, any> = {}) => ({
  videoId: "v1",
  userId: "u1",
  videoUrl: "https://res.cloudinary.com/demo/video/upload/v1/materialized/videos/abc.mp4",
  freeAccessEndedAt: LONG_LAPSED,
  embedCount: 0,
  licenseCount: 0,
  ...over,
});

describe("judgeRetention", () => {
  it("deletes a long-lapsed, unembedded, unlicensed video", () => {
    const v = judgeRetention(candidate(), NOW);
    expect(v.delete).toBe(true);
  });

  it("never deletes an embedded video, however long it has lapsed", () => {
    const v = judgeRetention(candidate({ embedCount: 1 }), NOW);
    expect(v.delete).toBe(false);
    expect(v.reason).toContain("embedded");
  });

  it("never deletes a licensed video, however long it has lapsed", () => {
    const v = judgeRetention(candidate({ licenseCount: 1 }), NOW);
    expect(v.delete).toBe(false);
    expect(v.reason).toContain("licensed");
  });

  it("keeps an account that never had a closed free window", () => {
    // Belt and braces behind the query, which already excludes subscribers.
    expect(judgeRetention(candidate({ freeAccessEndedAt: null }), NOW).delete).toBe(false);
  });

  it("keeps a video inside the grace period", () => {
    const lapsedYesterday = addDays(NOW, -1);
    expect(judgeRetention(candidate({ freeAccessEndedAt: lapsedYesterday }), NOW).delete).toBe(false);
  });

  it("the grace boundary is inclusive of the last protected day", () => {
    const exactlyAtGrace = addDays(NOW, -DEFAULT_GRACE_DAYS);
    // Eligible the instant grace elapses, not a day early.
    expect(judgeRetention(candidate({ freeAccessEndedAt: exactlyAtGrace }), NOW).delete).toBe(true);
    const oneSecondShort = new Date(exactlyAtGrace.getTime() + 1000);
    expect(judgeRetention(candidate({ freeAccessEndedAt: oneSecondShort }), NOW).delete).toBe(false);
  });

  it("protection outranks eligibility — an embedded video is kept for BEING embedded", () => {
    // Both true at once: long lapsed (eligible) and embedded (protected).
    const v = judgeRetention(candidate({ embedCount: 3 }), NOW);
    expect(v.delete).toBe(false);
    expect(v.reason).not.toContain("grace");
  });
});

describe("deletionEnabled", () => {
  it("is off unless the operator says exactly true", () => {
    expect(deletionEnabled({} as any)).toBe(false);
    expect(deletionEnabled({ RETENTION_DELETE_ENABLED: "false" } as any)).toBe(false);
    expect(deletionEnabled({ RETENTION_DELETE_ENABLED: "1" } as any)).toBe(false);
    expect(deletionEnabled({ RETENTION_DELETE_ENABLED: "true" } as any)).toBe(true);
  });
});

function harness(opts: { candidates?: any[]; enabled?: boolean; hostFails?: boolean } = {}) {
  const deletedFromHost: string[] = [];
  const stamped: string[] = [];
  const store = {
    getRetentionCandidates: async () => opts.candidates ?? [candidate()],
    markVideoMediaDeleted: async (id: string) => { stamped.push(id); },
  };
  const host = {
    deleteVideo: async (url: string) => {
      if (opts.hostFails) throw new Error("host unreachable");
      deletedFromHost.push(url);
    },
  };
  const job = makeRetentionJob(store as any, host as any, {
    now: () => NOW,
    enabled: () => opts.enabled ?? false,
  });
  return { job, deletedFromHost, stamped };
}

/**
 * The tests above run the job against a hand-written fake store, which is the
 * right shape for policy but proves nothing about the query that feeds it.
 *
 * It hid a real bug. Both the SQL and the MemStorage mirror counted licenses by
 * `video_id` — a column video_license_purchases does not have. Postgres threw;
 * MemStorage silently matched nothing and returned zero, and zero licenses is
 * the answer that PERMITS deletion. A license is bought against a global-library
 * listing, so the count has to travel through that listing.
 */
describe("counting protection against real storage", () => {
  async function seed() {
    const { MemStorage } = await import("../../server/storage");
    const s: any = new MemStorage();
    const user = await s.createUser({
      username: "lapsed", email: "lapsed@example.com", password: "x", role: "creator",
    } as any);
    // Lapsed long ago and unpaid: eligible unless something protects it.
    await s.updateUser(user.id, { freeAccessUntil: LONG_LAPSED } as any);
    const video = await s.createVideo({
      creatorId: user.id, title: "Lookbook", videoUrl: "https://cdn.example/v.mp4",
    } as any);
    return { s, user, video };
  }

  it("a licensed video is protected, counted through its listing", async () => {
    const { s, user, video } = await seed();
    const listing = await s.createGlobalVideoListing({
      videoId: video.id, creatorId: user.id, licenseFee: "10.00",
    } as any);
    await s.createVideoLicensePurchase({
      globalListingId: listing.id, affiliateId: user.id, licenseFee: "10.00", commissionRate: "10.00",
    } as any);

    const [c] = await s.getRetentionCandidates();
    expect(c.licenseCount).toBe(1);
    expect(judgeRetention(c, NOW).delete).toBe(false);
  });

  it("an embedded video is protected", async () => {
    const { s, user, video } = await seed();
    await s.createEmbedDeployment({
      affiliateId: user.id, videoId: video.id, utmCode: "u", referrerDomain: "vogue.com",
    } as any);

    const [c] = await s.getRetentionCandidates();
    expect(c.embedCount).toBe(1);
    expect(judgeRetention(c, NOW).delete).toBe(false);
  });

  it("with neither, the same video is eligible — so the protections above are load-bearing", async () => {
    const { s } = await seed();
    const [c] = await s.getRetentionCandidates();
    expect(c.embedCount).toBe(0);
    expect(c.licenseCount).toBe(0);
    expect(judgeRetention(c, NOW).delete).toBe(true);
  });
});

describe("the daily sweep", () => {
  it("deletes nothing in a dry run, but names what it would take", async () => {
    const h = harness({ enabled: false });
    const r = await h.job.run();
    expect(h.deletedFromHost).toHaveLength(0);
    expect(h.stamped).toHaveLength(0);
    expect(r.detail).toContain("DRY RUN");
    expect(r.detail).toContain("v1");
  });

  it("deletes from the host and stamps the row when switched on", async () => {
    const h = harness({ enabled: true });
    const r = await h.job.run();
    expect(h.deletedFromHost).toHaveLength(1);
    expect(h.stamped).toEqual(["v1"]);
    expect(r.status).toBe("success");
    expect(r.items).toBe(1);
  });

  it("leaves the row unstamped when the host delete fails — the file still exists", async () => {
    // The next run must try again, so the record has to keep saying the file is there.
    const h = harness({ enabled: true, hostFails: true });
    const r = await h.job.run();
    expect(h.stamped).toHaveLength(0);
    expect(r.status).toBe("failed");
    expect(r.detail).toContain("host unreachable");
  });

  it("skips when nothing is eligible", async () => {
    const h = harness({ candidates: [candidate({ embedCount: 1 })], enabled: true });
    const r = await h.job.run();
    expect(r.status).toBe("skipped");
    expect(h.deletedFromHost).toHaveLength(0);
  });

  it("takes only the eligible ones out of a mixed batch", async () => {
    const h = harness({
      enabled: true,
      candidates: [
        candidate({ videoId: "doomed" }),
        candidate({ videoId: "embedded", embedCount: 2 }),
        candidate({ videoId: "licensed", licenseCount: 1 }),
        candidate({ videoId: "in-grace", freeAccessEndedAt: addDays(NOW, -3) }),
      ],
    });
    const r = await h.job.run();
    expect(h.stamped).toEqual(["doomed"]);
    expect(r.items).toBe(1);
    expect(r.detail).toContain("4 considered");
  });
});

describe("the media host routes deletion by URL", () => {
  async function host() {
    const { makeMediaHost } = await import("../../server/retentionHost");
    const calls: string[] = [];
    const h = makeMediaHost({
      deleteFromBunny: async (guid) => { calls.push(`bunny:${guid}`); },
      deleteFromCloudinary: async (pid) => { calls.push(`cloudinary:${pid}`); },
      parseCloudinary: (url) => url.includes("res.cloudinary.com")
        ? { publicId: "materialized/videos/abc" } : null,
    });
    return { h, calls };
  }

  it("a Bunny URL deletes through Bunny", async () => {
    const { h, calls } = await host();
    await h.deleteVideo("https://vz-x-1.b-cdn.net/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/play_720p.mp4");
    expect(calls).toEqual(["bunny:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"]);
  });

  it("a legacy Cloudinary URL deletes through Cloudinary", async () => {
    const { h, calls } = await host();
    await h.deleteVideo("https://res.cloudinary.com/demo/video/upload/v1/materialized/videos/abc.mp4");
    expect(calls).toEqual(["cloudinary:materialized/videos/abc"]);
  });

  it("a URL neither host owns throws — never silently 'deleted'", async () => {
    const { h, calls } = await host();
    await expect(h.deleteVideo("https://example.com/video.mp4")).rejects.toThrow("no host owns");
    expect(calls).toHaveLength(0);
  });
});
