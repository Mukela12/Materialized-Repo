/**
 * Which plan a role must buy, and when to ask for it.
 *
 * ── The gap this closes ──────────────────────────────────────────────────────
 * A signup with no voucher gets no free period. The account therefore needs a
 * paid plan — and nothing said so, so the user paid the $29, arrived in the
 * portal, and found a product that looked available and was not. The client hit
 * it within an hour of her first real brand signup.
 *
 * ── The rule that matters most ───────────────────────────────────────────────
 * The plan is chosen SERVER-SIDE from the role. Taking it from the request is
 * how a Brand buys the $149 Creator tier and receives the full Brand feature
 * set, because entitlement keys off subscription status rather than tier.
 */
import { describe, it, expect } from "vitest";
import { planForRole, planAmountMajor, roleLabel, portalHome } from "../../server/subscriptionPlan";
import { isEntitled } from "../../server/entitlement";
import { owesSetupFee } from "../../server/setupFee";

describe("the client's pricing, per role", () => {
  it("creator is $149", () => {
    expect(planForRole("creator")).toBe("creator");
    expect(planAmountMajor("creator")).toBe(149);
  });

  it("brand is $249", () => {
    expect(planForRole("brand")).toBe("starter");
    expect(planAmountMajor("starter")).toBe(249);
  });

  it("publisher is $499", () => {
    expect(planForRole("affiliate")).toBe("pro");
    expect(planAmountMajor("pro")).toBe(499);
  });

  it("never sells a Brand the cheaper Creator tier", () => {
    expect(planForRole("brand")).not.toBe("creator");
    expect(planForRole("affiliate")).not.toBe("creator");
  });

  it("has no plan for an unknown role, rather than a default one", () => {
    expect(planForRole("something-else")).toBeNull();
    expect(planForRole(null)).toBeNull();
  });

  it("calls a Publisher a Publisher, and lands each role in its own portal", () => {
    expect(roleLabel("affiliate")).toBe("Publisher");
    expect(portalHome("affiliate")).toBe("/affiliate");
    expect(portalHome("brand")).toBe("/brand");
    expect(portalHome("creator")).toBe("/creator");
  });
});

/** The condition the endpoint reports as `needed`. */
const promptNeeded = (user: any, sub: any, now = new Date()) =>
  !isEntitled(user, sub, now) && !owesSetupFee(user) && !!planForRole(user.role);

describe("when the prompt appears", () => {
  const OCT31 = new Date("2026-11-01T05:00:00Z");
  const AUG = new Date("2026-08-19T12:00:00Z");
  const NOV = new Date("2026-11-15T12:00:00Z");

  it("appears for a no-voucher Brand who has settled the fee", () => {
    expect(promptNeeded({ role: "brand", setupFeePaid: true, freeAccess: false }, null, AUG)).toBe(true);
  });

  /** One bill at a time — the fee is owed first. */
  it("stays hidden while the setup fee is outstanding", () => {
    expect(promptNeeded({ role: "brand", setupFeePaid: false, freeAccess: false }, null, AUG)).toBe(false);
  });

  it("stays hidden for a festival account inside its free period", () => {
    const user = { role: "brand", setupFeePaid: true, freeAccess: true, freeAccessUntil: OCT31 };
    expect(promptNeeded(user, null, AUG)).toBe(false);
  });

  it("appears for that same account once the free period lapses", () => {
    const user = { role: "brand", setupFeePaid: true, freeAccess: true, freeAccessUntil: OCT31 };
    expect(promptNeeded(user, null, NOV)).toBe(true);
  });

  it("disappears once they subscribe", () => {
    const user = { role: "brand", setupFeePaid: true, freeAccess: false };
    expect(promptNeeded(user, { status: "active" }, AUG)).toBe(false);
  });

  it("never nags an admin", () => {
    expect(promptNeeded({ role: "brand", isAdmin: true, setupFeePaid: true }, null, AUG)).toBe(false);
  });

  it("a Creator with no voucher is asked too — free account is not free forever", () => {
    expect(promptNeeded({ role: "creator", setupFeePaid: false, freeAccess: false }, null, AUG)).toBe(true);
  });
});

describe("the endpoint decides the plan, not the caller", () => {
  const SRC = require("node:fs")
    .readFileSync(require("node:path").join(__dirname, "../../server/routes.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("subscription checkout takes the plan from the role", () => {
    const at = SRC.indexOf('app.post("/api/subscription/checkout"');
    expect(at).toBeGreaterThan(-1);
    const body = SRC.slice(at, at + 2200);
    expect(body).toContain("planForRole(user.role)");
    expect(body).not.toMatch(/const \{ plan \} = req\.body/);
  });

  it("uses the plain subscription checkout, so the $29 is not billed twice", () => {
    const at = SRC.indexOf('app.post("/api/subscription/checkout"');
    const body = SRC.slice(at, at + 2200);
    expect(body).toContain("createSubscriptionCheckout");
    expect(body).not.toContain("createTrialWithSetupFeeCheckout");
  });
});
