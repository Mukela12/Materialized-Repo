/**
 * Partner commissions, creator bonuses, the brand pass offer and the welcome
 * email's pass counts (client, 24-26 Oct 2026).
 *
 * The rule that matters most: whatever the partners, bonuses and overrides
 * add up to, MTRLZD's 15% fee always keeps 3.9% for Stripe and 3.1% for
 * itself, so no more than 8% of a sale is ever paid out.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../server/db", () => ({ db: {} }));

import { computeSaleSplit, reserveOfFeePct } from "../../server/feeConfig";
import { activeDealPct, activeOverride, PARTNER_PCT } from "../../server/partners";
import { inviteCapPerBrand, isPayingBrand } from "../../server/inviteVoucher";
import { CONDITIONS, dueAt, merge, renderStep, unknownFields, checkStepEdit, type Facts } from "../../server/journeys";
import {
  SEAT_ROLE, checkRecipient, inviteVoucherFromTemplate, seatTypeOf, templateProblem, type TemplateVoucher,
} from "../../server/programInvites";

const DAY = 86_400_000;
const now = new Date("2026-11-01T12:00:00Z");

beforeEach(() => {
  delete process.env.PROCESSING_FEE_PCT;
  delete process.env.PLATFORM_FLOOR_PCT;
  delete process.env.MARKETPLACE_FEE_PCT;
  delete process.env.CREATOR_COMMISSION_PCT;
  delete process.env.PUBLISHER_COMMISSION_PCT;
  delete process.env.INVITE_VOUCHER_CAP;
  delete process.env.INVITE_VOUCHER_CAP_STARTER;
});

describe("the reserve", () => {
  it("is 3.9% for Stripe plus a 3.1% floor for MTRLZD by default", () => {
    expect(reserveOfFeePct()).toBe(7);
  });

  it("can be set per environment", () => {
    process.env.PROCESSING_FEE_PCT = "3";
    process.env.PLATFORM_FLOOR_PCT = "2";
    expect(reserveOfFeePct()).toBe(5);
  });

  it("caps payouts at 8% of a sale: publisher first, then the creator", () => {
    const s = computeSaleSplit(10_000, { hasPublisher: true, creatorPct: 8, publisherPct: 2 });
    expect(s.publisherCents).toBe(200);
    expect(s.creatorCents).toBe(600);
    expect(s.platformCents).toBe(700);
  });

  it("pays a partner in full when there is room", () => {
    const s = computeSaleSplit(10_000, { hasPublisher: false, creatorPct: 0, partners: [{ userId: "p1", pct: 2 }] });
    expect(s.partners).toEqual([{ userId: "p1", pct: 2, cents: 200 }]);
    expect(s.platformCents).toBe(1300);
  });

  it("trims partners first when a creator bonus and a publisher fill the payable room", () => {
    // 5% Paris bonus + 2% publisher = 7%, so 1% is left of the 8%.
    const s = computeSaleSplit(10_000, {
      hasPublisher: true, creatorPct: 5, publisherPct: 2, partners: [{ userId: "p1", pct: 2 }],
    });
    expect(s.creatorCents).toBe(500);
    expect(s.publisherCents).toBe(200);
    expect(s.partners[0]).toEqual({ userId: "p1", pct: 1, cents: 100 });
    expect(s.platformCents).toBe(700);
  });

  it("shares a short room between partners in proportion, rounding down", () => {
    const s = computeSaleSplit(9_999, {
      hasPublisher: true, creatorPct: 5, publisherPct: 2,
      partners: [{ userId: "a", pct: 2 }, { userId: "b", pct: 1 }],
    });
    expect(s.partners.map((p) => p.pct)).toEqual([0.66, 0.33]);
    const paid = s.creatorCents + s.publisherCents + s.partners.reduce((n, p) => n + p.cents, 0);
    expect(paid).toBeLessThanOrEqual(Math.round(9_999 * 0.08));
    expect(s.platformCents).toBeGreaterThanOrEqual(Math.round(9_999 * 0.07));
  });

  it("never pays out of a fee smaller than the reserve", () => {
    const s = computeSaleSplit(10_000, {
      hasPublisher: true, marketplaceFeePct: 5, creatorPct: 5, publisherPct: 2, partners: [{ userId: "p", pct: 2 }],
    });
    expect(s.creatorCents + s.publisherCents).toBe(0);
    expect(s.partners[0].cents).toBe(0);
    expect(s.platformCents).toBe(500);
  });
});

describe("partner deals", () => {
  it("is 1 to 3%, 2% by default", () => {
    expect(PARTNER_PCT).toEqual({ min: 1, max: 3, default: 2 });
  });

  it("counts only a deal with a % that hasn't ended", () => {
    expect(activeDealPct(undefined, now)).toBeNull();
    expect(activeDealPct({ commission_pct: null, commission_until: null }, now)).toBeNull();
    expect(activeDealPct({ commission_pct: "2.00", commission_until: null }, now)).toBe(2);
    expect(activeDealPct({ commission_pct: "2.00", commission_until: new Date(now.getTime() + DAY) }, now)).toBe(2);
    expect(activeDealPct({ commission_pct: "2.00", commission_until: new Date(now.getTime() - 1) }, now)).toBeNull();
  });

  it("never goes above 3%, whatever is stored", () => {
    expect(activeDealPct({ commission_pct: "9", commission_until: null }, now)).toBe(3);
  });
});

describe("creator bonus and other per-person rates", () => {
  it("applies until its end date, then falls back to the default", () => {
    const user = { commissionRateOverride: "5.00", commissionOverrideUntil: new Date(now.getTime() + DAY) };
    expect(activeOverride(user, now)).toBe("5.00");
    expect(activeOverride({ ...user, commissionOverrideUntil: new Date(now.getTime() - DAY) }, now)).toBeNull();
  });

  it("keeps an override with no end date, as before", () => {
    expect(activeOverride({ commissionRateOverride: "3.00", commissionOverrideUntil: null }, now)).toBe("3.00");
    expect(activeOverride({ commissionRateOverride: null }, now)).toBeNull();
  });
});

describe("the brand pass offer", () => {
  it("gives 10 creator passes to start and 100 on the paid plan", () => {
    expect(inviteCapPerBrand(false)).toBe(10);
    expect(inviteCapPerBrand(true)).toBe(100);
    expect(inviteCapPerBrand()).toBe(100);
  });

  it("reads both numbers from the environment", () => {
    process.env.INVITE_VOUCHER_CAP = "150";
    process.env.INVITE_VOUCHER_CAP_STARTER = "12";
    expect(inviteCapPerBrand(true)).toBe(150);
    expect(inviteCapPerBrand(false)).toBe(12);
  });

  it("counts a brand as paying only once its trial is over", () => {
    const sub = (daysAgo: number, status = "active") => ({ status, subscribedAt: new Date(now.getTime() - daysAgo * DAY) });
    expect(isPayingBrand(null, 30, now)).toBe(false);
    expect(isPayingBrand(sub(10), 30, now)).toBe(false);
    expect(isPayingBrand(sub(30), 30, now)).toBe(true);
    expect(isPayingBrand(sub(60, "past_due"), 30, now)).toBe(false);
  });
});

describe("pass counts in journey emails", () => {
  const body = "Hi {{FirstName}},\n\nWelcome.\n\nYou have {{CreatorPasses}} Creator Passes.\nAnd {{BrandPasses}} Brand Passes.\n\nSee you soon.";
  const person = (passes?: { creator: number; brand: number; publisher: number }) =>
    ({ displayName: "Ana Silva", companyName: null, role: "brand", passes });

  it("fills in the counts", () => {
    expect(merge(body, person({ creator: 10, brand: 40, publisher: 0 })))
      .toBe("Hi Ana,\n\nWelcome.\n\nYou have 10 Creator Passes.\nAnd 40 Brand Passes.\n\nSee you soon.");
  });

  it("leaves out a line whose count is 0, and a paragraph left empty", () => {
    expect(merge(body, person({ creator: 10, brand: 0, publisher: 0 })))
      .toBe("Hi Ana,\n\nWelcome.\n\nYou have 10 Creator Passes.\n\nSee you soon.");
    expect(merge(body, person({ creator: 0, brand: 0, publisher: 0 })))
      .toBe("Hi Ana,\n\nWelcome.\n\nSee you soon.");
  });

  it("treats someone with no passes at all as 0", () => {
    expect(merge(body, person())).toBe("Hi Ana,\n\nWelcome.\n\nSee you soon.");
  });

  it("puts the number in a subject rather than dropping it", () => {
    expect(merge("{{CreatorPasses}} passes for you", person({ creator: 0, brand: 0, publisher: 0 }), { subject: true }))
      .toBe("0 passes for you");
  });

  it("drops a list item with a count of 0 from the rendered email", () => {
    const r = renderStep({ subject: "Hi", body: "• {{CreatorPasses}} creator passes\n• {{PublisherPasses}} publisher passes", ctaLabel: null, ctaPath: null },
      person({ creator: 3, brand: 0, publisher: 0 }), "https://www.mtrlzd.com");
    expect(r.bodyHtml).toContain("3 creator passes");
    expect(r.bodyHtml).not.toContain("publisher");
  });

  it("accepts the new fields in the editor", () => {
    expect(unknownFields("{{CreatorPasses}} {{BrandPasses}} {{PublisherPasses}} {{Passes}}")).toEqual(["Passes"]);
  });

  it("has a 'not paying yet' condition for the 100-pass email", () => {
    const f = (paying: boolean): Facts => ({
      uploads: 0, brandTagged: false, products: 0, invitesSent: 0, invitesJoined: 0, inviteeUploads: 0,
      subscribed: true, paying, lastSeenAt: null,
    });
    expect(CONDITIONS.not_paying.test(f(false), now)).toBe(true);
    expect(CONDITIONS.not_paying.test(f(true), now)).toBe(false);
    expect("error" in checkStepEdit({ subject: "s", body: "b", day: -14, anchor: "trial_end", condition: "not_paying" })).toBe(false);
  });

  it("times 'trial end' from the paid plan's trial when there is one", () => {
    const createdAt = new Date("2026-10-01T00:00:00Z");
    const planTrialEndsAt = new Date("2026-11-20T00:00:00Z");
    expect(dueAt({ anchor: "trial_end", day: -14 }, { createdAt, freeAccessUntil: new Date("2026-10-15T00:00:00Z"), planTrialEndsAt }))
      .toEqual(new Date("2026-11-06T00:00:00Z"));
  });
});

describe("publisher invites", () => {
  const template: TemplateVoucher = {
    id: "t", code: "PUB-1", grantType: "free_access", roleRestriction: "affiliate", activeFrom: null, expiresAt: null,
    freeDays: 30, creatorPasses: 5, partner: "Agency X", revokedAt: null, creatorBonusPct: "5.00", creatorBonusMonths: 12,
  };
  const args = (type: "brand" | "creator" | "publisher") => ({
    code: "NEW-1", template: { ...template, roleRestriction: SEAT_ROLE[type] }, type,
    recipient: { name: "Jo", email: "jo@example.com", type }, sender: { id: "u1", name: "Agency X" }, programName: "Agency X",
  });

  it("reads publisher-ish words in a CSV", () => {
    for (const w of ["publisher", "Publishers", "magazine", "media", "affiliate"]) expect(seatTypeOf(w), w).toBe("publisher");
    expect(checkRecipient({ name: "Jo", email: "jo@example.com", type: "publisher" })).toEqual({
      ok: true, recipient: { name: "Jo", email: "jo@example.com", type: "publisher" },
    });
  });

  it("signs a publisher up as the affiliate role", () => {
    expect(SEAT_ROLE.publisher).toBe("affiliate");
    expect(templateProblem(template, "publisher", now)).toBeNull();
    expect(templateProblem({ ...template, roleRestriction: "creator" }, "publisher", now)).toMatch(/another kind of account/);
    const v = inviteVoucherFromTemplate(args("publisher"));
    expect(v.roleRestriction).toBe("affiliate");
    expect(v.batchId).toBe("program:u1:publisher");
    expect(v.creatorPasses).toBeNull();
    expect(v.creatorBonusPct).toBeNull();
  });

  it("carries the template's creator bonus to an influencer invite only", () => {
    expect(inviteVoucherFromTemplate(args("creator"))).toMatchObject({ creatorBonusPct: "5.00", creatorBonusMonths: 12 });
    expect(inviteVoucherFromTemplate(args("brand"))).toMatchObject({ creatorBonusPct: null, creatorPasses: 5 });
  });
});

describe("bulk commission (Admin > Users)", () => {
  it("sets a % for many people, until a last day", async () => {
    const { checkCommissionEdit } = await import("../../server/partners");
    const r = checkCommissionEdit({ userIds: ["a", "b", "a"], pct: "5", until: "2027-10-31" });
    expect(r).toEqual({ userIds: ["a", "b"], pct: "5.00", until: new Date("2027-11-01T00:00:00Z") });
  });

  it("clears with a blank %", async () => {
    const { checkCommissionEdit } = await import("../../server/partners");
    expect(checkCommissionEdit({ userIds: ["a"], pct: "" })).toEqual({ userIds: ["a"], pct: null, until: null });
  });

  it("refuses nobody, more than 8%, or a bad date", async () => {
    const { checkCommissionEdit } = await import("../../server/partners");
    expect(checkCommissionEdit({ userIds: [], pct: "5" })).toHaveProperty("error");
    expect(checkCommissionEdit({ userIds: ["a"], pct: "9" })).toHaveProperty("error");
    expect(checkCommissionEdit({ userIds: ["a"], pct: "5", until: "31/10/2027" })).toHaveProperty("error");
  });
});

describe("partner limits (client, 26 Oct 2026)", () => {
  it("earn on each referral for 90 days from when it joined", async () => {
    const { withinReferralWindow, partnerReferralDays } = await import("../../server/partners");
    delete process.env.PARTNER_REFERRAL_DAYS;
    expect(partnerReferralDays()).toBe(90);
    const joined = new Date(now.getTime() - 89 * DAY);
    expect(withinReferralWindow(joined, now)).toBe(true);
    expect(withinReferralWindow(new Date(now.getTime() - 90 * DAY), now)).toBe(false);
  });

  it("can be changed per environment", async () => {
    const { partnerReferralDays } = await import("../../server/partners");
    process.env.PARTNER_REFERRAL_DAYS = "120";
    expect(partnerReferralDays()).toBe(120);
    delete process.env.PARTNER_REFERRAL_DAYS;
  });

  it("only pay a partner whose own account is active", () => {
    const src = readFileSync(join(__dirname, "../../server/partners.ts"), "utf8");
    expect(src).toMatch(/s\.status in \('active', 'trialing'\)/);
    expect(src).toMatch(/u\.free_access and \(u\.free_access_until is null or u\.free_access_until > \$\{now\}\)/);
  });

  it("give Paris creators their extra 5% for 3 months", () => {
    const src = readFileSync(join(__dirname, "../../server/parisCampaign.ts"), "utf8");
    expect(src).toMatch(/creatorBonusMonths: 3,/);
  });
});
