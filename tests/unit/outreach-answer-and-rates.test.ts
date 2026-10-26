/**
 * 23 Oct 2026: a creator hears back when the brand they asked answers (yes or
 * no, and brands can now say no), and two places that ignored the platform's
 * commission rules now follow them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { outreachAnswerEmail } from "../../server/emailService";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const base = { to: "ana@example.com", creatorName: "Ana Costa", brandName: "Maison", videoTitle: "Spring look", note: "", dashboardUrl: "https://www.mtrlzd.com/creator/my-videos" };

describe("the creator hears the brand's answer", () => {
  it("a yes says so, by name", () => {
    const e = outreachAnswerEmail({ ...base, accepted: true });
    expect(e.subject).toBe("Maison said yes to your video");
    expect(e.html).toMatch(/Hi Ana,/);
    expect(e.html).toMatch(/Spring look/);
  });

  it("a no carries the brand's note, escaped", () => {
    const e = outreachAnswerEmail({ ...base, accepted: false, note: "<b>Not this season</b>" });
    expect(e.subject).toBe("Maison has passed on your request");
    expect(e.html).toContain("&lt;b&gt;Not this season&lt;/b&gt;");
    expect(e.html).not.toContain("<b>Not this season</b>");
  });

  it("a brand name can't inject markup", () => {
    expect(outreachAnswerEmail({ ...base, brandName: "<img src=x>", accepted: true }).html).not.toContain("<img src=x>");
  });

  it("brands can decline, once, and the creator is told either way", () => {
    const routes = read("server/routes.ts");
    expect(routes).toMatch(/app\.post\("\/api\/brand-outreach\/decline\/:token"/);
    expect(routes).toMatch(/notifyCreatorOfAnswer\(req, outreach, creator, true\)/);
    expect(routes).toMatch(/notifyCreatorOfAnswer\(req, outreach, creator, false, note\)/);
    expect(routes).toMatch(/outreach\.status === "declined"\) \{\s*return res\.status\(410\)/);
    expect(read("client/src/pages/brand-authorize.tsx")).toMatch(/\/api\/brand-outreach\/decline\//);
  });
});

describe("commission rules apply everywhere", () => {
  it("in-video sales use the admin's settings and each person's override", () => {
    const wh = read("server/webhookHandlers.ts");
    // One place works out every rate (server/partners.ts saleRates): the
    // admin's settings, each person's override while it lasts, the partners.
    expect(wh).toMatch(/saleRates\(\{\s*settings: await storage\.getPlatformSettings\(\)/);
    expect(wh).toMatch(/creator: creatorUser/);
    expect(read("server/partners.ts")).toMatch(/creatorPct: userRateOr\(activeOverride\(args\.creator, now\), cfg\.creatorPct\)/);
    expect(wh).toMatch(/null,\s*rates,\s*\);/);
    expect(wh).toMatch(/\.\.\.rates,\s*\}\),/);
  });

  it("a publisher can't choose their own rate when licensing a video", () => {
    const routes = read("server/routes.ts");
    const start = routes.indexOf('app.post("/api/library/:id/purchase"');
    const body = routes.slice(start, routes.indexOf("\n  app.", start + 10));
    expect(body).not.toMatch(/req\.body/);
    expect(body).toMatch(/userRateOr\(activeOverride\(user, new Date\(\)\), cfg\.publisherPct\)/);
  });
});
