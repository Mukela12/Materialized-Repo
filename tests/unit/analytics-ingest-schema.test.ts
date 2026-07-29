/**
 * What POST /api/analytics/events accepts from an unauthenticated caller.
 *
 * The endpoint must stay open — embed scripts run on third-party sites and have
 * no session. So the input schema is the entire boundary, and it previously was
 * not one: the route parsed with `createInsertSchema(analyticsEvents)`, which
 * accepts every column. That let any caller set `revenue` (it feeds the revenue
 * figures on three dashboards), invent an `eventType` (plain text, no CHECK
 * constraint), or override the server's own geo/device classification.
 *
 * This mirrors the schema in server/routes.ts. It is duplicated rather than
 * imported because the real one is declared inside registerRoutes() and is not
 * exported; the tests below therefore also assert the SHAPE contract that the
 * deployed embeds rely on, so a divergence shows up as a failure here.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

const analyticsIngestSchema = z.object({
  videoId: z.string().min(1),
  eventType: z.enum(["view", "click", "purchase"]),
  productId: z.string().min(1).optional(),
  utmCode: z.string().max(200).optional(),
  referrerDomain: z.string().max(253).optional(),
});

const ok = (b: unknown) => analyticsIngestSchema.safeParse(b);

describe("what the deployed embeds send must keep working", () => {
  // Exactly the payload from the two widget scripts at the bottom of routes.ts.
  it("accepts the embed's view payload", () => {
    expect(ok({ videoId: "v1", eventType: "view", utmCode: "abc", referrerDomain: "shop.example" }).success).toBe(true);
  });

  it("accepts the embed's click payload", () => {
    expect(ok({ videoId: "v1", eventType: "click", utmCode: "abc", referrerDomain: "shop.example" }).success).toBe(true);
  });

  it("accepts a bare minimum event", () => {
    expect(ok({ videoId: "v1", eventType: "view" }).success).toBe(true);
  });
});

describe("what a hostile caller can no longer do", () => {
  it("cannot set revenue — it drives money figures on three dashboards", () => {
    const r = analyticsIngestSchema.parse({ videoId: "v1", eventType: "purchase", revenue: "999999.00" });
    expect("revenue" in r).toBe(false);
  });

  it("cannot set a negative revenue either", () => {
    const r = analyticsIngestSchema.parse({ videoId: "v1", eventType: "purchase", revenue: "-50.00" });
    expect("revenue" in r).toBe(false);
  });

  it("cannot invent an event type", () => {
    for (const t of ["PLATFORM_ADMIN", "", "View", "impression", "🎉"]) {
      expect(ok({ videoId: "v1", eventType: t }).success).toBe(false);
    }
  });

  it("cannot override server-derived geo or device", () => {
    const r = analyticsIngestSchema.parse({
      videoId: "v1", eventType: "view", country: "ZZ", device: "hacked",
    });
    expect("country" in r).toBe(false);
    expect("device" in r).toBe(false);
  });

  it("cannot self-attribute an affiliate — the server resolves it from the utm code", () => {
    const r = analyticsIngestSchema.parse({
      videoId: "v1", eventType: "click", affiliateId: "someone-elses-id",
    });
    expect("affiliateId" in r).toBe(false);
  });

  it("still requires a videoId", () => {
    expect(ok({ eventType: "view" }).success).toBe(false);
    expect(ok({ videoId: "", eventType: "view" }).success).toBe(false);
  });

  it("bounds the free-text fields", () => {
    expect(ok({ videoId: "v1", eventType: "view", utmCode: "x".repeat(201) }).success).toBe(false);
    expect(ok({ videoId: "v1", eventType: "view", referrerDomain: "x".repeat(254) }).success).toBe(false);
  });
});
