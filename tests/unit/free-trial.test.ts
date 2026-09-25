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
    expect(src).toContain("const startsOnTrial = !voucherGrants.freeAccess");
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
