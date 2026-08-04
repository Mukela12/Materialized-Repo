/**
 * What PATCH /api/videos/:id will accept.
 *
 * This route previously passed req.body straight into storage.updateVideo,
 * which does db.update(videos).set(data) with no whitelist and no parse. The
 * ownership check above it only established that the caller owns the video —
 * it said nothing about WHICH columns they could write. So a creator could set
 * any column on their own row, including creatorId, which hands the video to
 * another account, and totalRevenue, which fabricates their own earnings.
 *
 * These pin the allowlist. Every field here is one the UI genuinely sends;
 * anything else must be dropped before it reaches the database.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

/** Mirrors the schema in server/routes.ts. */
const videoPatchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  categories: z.string().max(2000).optional(),
  thumbnailUrl: z.string().max(2000).optional(),
  status: z.enum(["draft", "published"]).optional(),
  carouselSettings: z.string().max(20000).optional(),
});

describe("fields the UI legitimately sends still work", () => {
  it("accepts the VideoDetailSheet payload", () => {
    const r = videoPatchSchema.parse({
      title: "Summer Collection",
      description: "A look",
      categories: '["fashion"]',
      thumbnailUrl: "https://cdn.example/x.jpg",
    });
    expect(r.title).toBe("Summer Collection");
    expect(r.categories).toBe('["fashion"]');
  });

  it("accepts the VideoUploadModal publish payload", () => {
    const r = videoPatchSchema.parse({ status: "published", carouselSettings: "{}" });
    expect(r.status).toBe("published");
  });
});

describe("privilege escalation is dropped", () => {
  it("cannot reassign the video to another account", () => {
    const r = videoPatchSchema.parse({ title: "x", creatorId: "someone-elses-user-id" });
    expect("creatorId" in r).toBe(false);
  });

  it("cannot fabricate stats or revenue", () => {
    const r = videoPatchSchema.parse({
      title: "x", totalViews: 999999, totalClicks: 999999, totalRevenue: "999999.00",
    });
    for (const k of ["totalViews", "totalClicks", "totalRevenue"]) expect(k in r).toBe(false);
  });

  it("cannot escape trial accounting or retarget attribution", () => {
    const r = videoPatchSchema.parse({ title: "x", isTrial: false, utmCode: "stolen-code" });
    expect("isTrial" in r).toBe(false);
    expect("utmCode" in r).toBe(false);
  });

  it("cannot set a server-controlled status", () => {
    expect(videoPatchSchema.safeParse({ status: "processing" }).success).toBe(false);
    expect(videoPatchSchema.safeParse({ status: "archived" }).success).toBe(false);
  });
});

describe("input bounds", () => {
  it("rejects an empty title rather than blanking it", () => {
    expect(videoPatchSchema.safeParse({ title: "" }).success).toBe(false);
  });

  it("rejects absurd field lengths", () => {
    expect(videoPatchSchema.safeParse({ title: "x".repeat(301) }).success).toBe(false);
    expect(videoPatchSchema.safeParse({ carouselSettings: "x".repeat(20001) }).success).toBe(false);
  });

  it("an all-unknown body parses to nothing, so the route can 400 instead of a no-op UPDATE", () => {
    expect(Object.keys(videoPatchSchema.parse({ creatorId: "x", totalViews: 1 })).length).toBe(0);
  });
});
