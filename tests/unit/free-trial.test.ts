/**
 * The 14-day trial: every non-voucher signup starts one, no card, no fee at
 * the door. The client's CapCut-style onboarding, decided 25 Sep 2026
 * alongside "mtrzld will absorb the overage charges ... through to December
 * 31st 2026."
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRIAL_DAYS, OVERAGE_ABSORPTION_UNTIL, isEntitled } from "../../server/entitlement";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

describe("the trial policy constants", () => {
  it("is 14 days, as announced on the hero", () => {
    expect(TRIAL_DAYS).toBe(14);
  });

  it("absorption runs through 31 Dec 2026 in every timezone", () => {
    expect(OVERAGE_ABSORPTION_UNTIL.toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });
});

describe("a trial account's lifecycle", () => {
  const signupDay = new Date("2026-10-01T12:00:00Z");
  const trialUser = {
    role: "brand" as const,
    freeAccess: true,
    freeAccessUntil: new Date(signupDay.getTime() + TRIAL_DAYS * 86_400_000),
    overageCardRequired: true,
    cardOnFile: false,
    setupFeePaid: false,
  };

  it("day 1: full access — no card, no fee, no subscription", () => {
    expect(isEntitled(trialUser, null, signupDay)).toBe(true);
  });

  it("day 15: access ends and the deferred obligations return", () => {
    const day15 = new Date(signupDay.getTime() + 15 * 86_400_000);
    expect(isEntitled(trialUser, null, day15)).toBe(false);
  });

  it("a subscription taken during the trial carries the account past the lapse", () => {
    const day20 = new Date(signupDay.getTime() + 20 * 86_400_000);
    expect(isEntitled({ ...trialUser, setupFeePaid: true }, { status: "active" }, day20)).toBe(true);
  });
});

describe("the wiring, read at the source", () => {
  it("signup grants the trial to every non-voucher account", () => {
    const src = read("server/authRoutes.ts");
    expect(src).toContain("let startsOnTrial = !voucherGrants.freeAccess");
    expect(src).toMatch(/TRIAL_DAYS \* 24 \* 60 \* 60 \* 1000/);
    expect(src).toContain("freeAccess: voucherGrants.freeAccess || startsOnTrial");
  });

  it("the fee banner stands down while a free window is active", () => {
    const src = read("server/routes.ts");
    expect(src).toContain("outstanding: owesSetupFee(user) && !hasFreeAccess(user)");
  });

  it("the hero announces the trial and the missing card requirement", () => {
    const src = read("client/src/pages/landing.tsx");
    expect(src).toContain("Start Your Free 14-Day Trial");
    expect(src).toContain("No credit card required");
  });
});

describe("the payout nudge", () => {
  const routes = read("server/routes.ts");
  const handler = routes.slice(routes.indexOf('app.get("/api/payouts/nudge"'), routes.indexOf('app.get("/api/payouts/nudge"') + 2000);

  it("targets the earning roles and nobody else", () => {
    expect(handler).toContain('user.role === "creator" || user.role === "affiliate"');
  });

  it("stands down while a fee or card banner is up — one ask at a time", () => {
    expect(handler).toContain("!feeOutstanding && !cardOutstanding");
  });

  it("disappears once the webhook marks onboarding complete", () => {
    expect(handler).toContain("!user.stripeConnectOnboarded");
  });

  it("the banner is dismissible and soft — a nudge, not an obligation", () => {
    const banner = read("client/src/components/PayoutNudgeBanner.tsx");
    expect(banner).toContain("sessionStorage");
    expect(banner).toContain("banner-payout-nudge");
    expect(banner).not.toContain("border-amber"); // the obligation colour is reserved for obligations
  });
});

describe("the tag-a-brand exception — the client's only exception to free onboarding", () => {
  it("a tagged brand's email is findable in storage, case- and space-insensitively", async () => {
    const { MemStorage } = await import("../../server/storage");
    const st: any = new MemStorage();
    const creator = await st.createUser({ username: "c", email: "c@x.com", password: "x", role: "creator" } as any);
    await st.createBrandOutreach({
      creatorId: creator.id, brandName: "Maison Demo",
      prContactName: "Amelie", prContactEmail: "PR@MaisonDemo.com ",
    } as any);
    expect(await st.findBrandOutreachByContactEmail("pr@maisondemo.com")).toBeTruthy();
    expect(await st.findBrandOutreachByContactEmail("someone-else@x.com")).toBeUndefined();
  });

  it("signup denies the trial to a tagged brand and nobody else", () => {
    const src = read("server/authRoutes.ts");
    const block = src.slice(src.indexOf("let startsOnTrial"), src.indexOf("const trialUntil"));
    expect(block).toContain('role === "brand"');
    expect(block).toContain("findBrandOutreachByContactEmail(email)");
    expect(block).toContain("startsOnTrial = false");
  });
});

describe("the outreach email's video preview", () => {
  it("shows a clickable poster frame when the video has a thumbnail", async () => {
    const { renderBrandOutreachEmailHtml } = await import("../../server/emailService");
    const html = renderBrandOutreachEmailHtml({
      prContactName: "Amelie Laurent", prContactEmail: "pr@x.com",
      creatorDisplayName: "Miro", creatorInstagramHandle: "@miro",
      brandName: "Maison", videoTitle: "Paris Edit",
      videoPreviewUrl: "https://www.mtrlzd.com/embed/abc",
      videoThumbnailUrl: "https://vz-x.b-cdn.net/g/thumbnail.jpg",
      authorizeUrl: "https://www.mtrlzd.com/brand-authorize/t",
    });
    expect(html).toContain('src="https://vz-x.b-cdn.net/g/thumbnail.jpg"');
    expect(html).toContain("Watch Paris Edit");
    // The poster IS the link — a brand taps the image, not just the button.
    expect(html).toMatch(/<a href="https:\/\/www\.mtrlzd\.com\/embed\/abc"[^>]*>\s*<img/);
  });

  it("falls back to the text preview link when no thumbnail exists", async () => {
    const { renderBrandOutreachEmailHtml } = await import("../../server/emailService");
    const html = renderBrandOutreachEmailHtml({
      prContactName: "A", prContactEmail: "p@x.com", creatorDisplayName: "M",
      brandName: "B", videoTitle: "V",
      videoPreviewUrl: "https://x/embed/abc", videoThumbnailUrl: null,
      authorizeUrl: "https://x/a",
    });
    expect(html).toContain("Preview the campaign");
    expect(html).not.toContain("&#9654;"); // no watch button without a poster
  });
});
