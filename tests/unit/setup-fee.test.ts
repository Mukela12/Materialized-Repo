/**
 * The one-time admin setup fee.
 *
 * The client's rule, verbatim: "No user, except for Creators, gets an entirely
 * free account, there is always the one-time Admin Fee."
 *
 * The fee previously existed only as a line item inside a subscription checkout,
 * so the accounts that most needed to pay it — voucher holders, whose entire
 * offer is "no subscription until the date" — never reached a checkout and never
 * paid. 202 of the 216 festival codes are for Brands and Publishers.
 *
 * Both directions matter here and they fail differently. Charging a Creator is
 * loud: they complain. Failing to charge a Brand is silent, which is how the
 * original gap survived.
 */
import { describe, it, expect } from "vitest";
import { owesSetupFee, oweableRole, setupFeeAudience } from "../../server/setupFee";
import { isEntitled } from "../../server/entitlement";

const AUG = new Date("2026-08-19T12:00:00Z");
const NOV = new Date("2026-11-15T12:00:00Z");
const OCT31 = new Date("2026-11-01T05:00:00Z");

describe("who owes the fee", () => {
  it("Creators never do", () => {
    expect(oweableRole("creator")).toBe(false);
    expect(owesSetupFee({ role: "creator", setupFeePaid: false })).toBe(false);
  });

  it("Brands and Publishers always do", () => {
    expect(owesSetupFee({ role: "brand", setupFeePaid: false })).toBe(true);
    expect(owesSetupFee({ role: "affiliate", setupFeePaid: false })).toBe(true);
  });

  it("stops owing once settled", () => {
    expect(owesSetupFee({ role: "brand", setupFeePaid: true })).toBe(false);
    expect(owesSetupFee({ role: "affiliate", setupFeePaid: true })).toBe(false);
  });

  it("admins are never held behind it", () => {
    expect(owesSetupFee({ role: "brand", setupFeePaid: false, isAdmin: true })).toBe(false);
  });

  it("calls a Publisher a Publisher, not an affiliate", () => {
    expect(setupFeeAudience("affiliate")).toBe("Publisher");
    expect(setupFeeAudience("brand")).toBe("Brand");
  });
});

describe("the fee gates access, and a voucher does not cover it", () => {
  /** The exact festival case: free subscription, fee still outstanding. */
  it("a voucher Brand with the fee unpaid has no access", () => {
    const user = { role: "brand", freeAccess: true, freeAccessUntil: OCT31, setupFeePaid: false };
    expect(isEntitled(user, null, AUG)).toBe(false);
  });

  it("and gets access the moment the fee is settled", () => {
    const user = { role: "brand", freeAccess: true, freeAccessUntil: OCT31, setupFeePaid: true };
    expect(isEntitled(user, null, AUG)).toBe(true);
  });

  it("a voucher Creator needs nothing — free account, no fee", () => {
    const user = { role: "creator", freeAccess: true, freeAccessUntil: OCT31, setupFeePaid: false };
    expect(isEntitled(user, null, AUG)).toBe(true);
  });

  it("paying the fee does not by itself survive the free period lapsing", () => {
    const user = { role: "brand", freeAccess: true, freeAccessUntil: OCT31, setupFeePaid: true };
    expect(isEntitled(user, null, AUG)).toBe(true);
    expect(isEntitled(user, null, NOV)).toBe(false);
    expect(isEntitled(user, { status: "active" }, NOV)).toBe(true);
  });

  it("an unpaid fee blocks even an active subscription", () => {
    // Cannot arise through checkout — the subscription path settles the fee —
    // but the rule is "never entirely free", so the precondition holds either way.
    const user = { role: "brand", setupFeePaid: false };
    expect(isEntitled(user, { status: "active" }, AUG)).toBe(false);
  });
});

describe("the wiring that collects it", () => {
  const read = (f: string) =>
    require("node:fs").readFileSync(require("node:path").join(__dirname, "../../", f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("there is a standalone checkout for it", () => {
    const routes = read("server/routes.ts");
    expect(routes).toContain('app.post("/api/setup-fee/checkout"');
    expect(routes).toContain('purpose: "setup_fee"');
  });

  it("the webhook keys on purpose, not on payment mode alone", () => {
    const wh = read("server/webhookHandlers.ts");
    expect(wh).toMatch(/session\.mode === 'payment' && session\.metadata\?\.purpose === 'setup_fee'/);
    expect(wh).toMatch(/setupFeePaid: true/);
  });

  it("it refuses to settle on an unpaid session", () => {
    expect(read("server/webhookHandlers.ts")).toMatch(/payment_status !== 'paid'/);
  });

  it("a completed subscription checkout also settles it", () => {
    const wh = read("server/webhookHandlers.ts");
    const subPath = wh.slice(wh.indexOf("no user found for customer"));
    expect(subPath).toMatch(/setupFeePaid: true/);
  });
});
