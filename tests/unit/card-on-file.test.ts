/**
 * Card on file as the price of voucher free access.
 *
 * ── The client's rule, verbatim ──────────────────────────────────────────────
 * "When the user enters a voucher for a subscription free period ... they must
 * still agree to be accountable for overage charges, and enter their card
 * information. That is the single requirement of having free access."
 *
 * ── The two boundaries that must hold ────────────────────────────────────────
 * Binding: a voucher account with no card is NOT entitled, however valid its
 * free period — hundreds of free festival accounts with unbillable usage is
 * the loss she described.
 * Not over-binding: the rule is stamped only at voucher redemption, so manual
 * comps, admins and every account predating it are untouched — and a live
 * subscription always satisfies it, because subscribing captured a card.
 */
import { describe, it, expect } from "vitest";
import { isEntitled, owesCardOnFile } from "../../server/entitlement";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const OCT31 = new Date("2026-11-01T05:00:00Z");
const AUG = new Date("2026-08-19T12:00:00Z");
const voucherCreator = (over: Record<string, unknown> = {}) => ({
  role: "creator", freeAccess: true, freeAccessUntil: OCT31,
  overageCardRequired: true, cardOnFile: false, setupFeePaid: false, ...over,
});

describe("who owes a card", () => {
  it("a voucher signup without one", () => {
    expect(owesCardOnFile(voucherCreator())).toBe(true);
  });

  it("nobody the rule was not stamped on — comps and pre-rule accounts", () => {
    expect(owesCardOnFile({ freeAccess: true, overageCardRequired: false, cardOnFile: false })).toBe(false);
    expect(owesCardOnFile({ freeAccess: true })).toBe(false);
  });

  it("never an admin", () => {
    expect(owesCardOnFile(voucherCreator({ isAdmin: true }))).toBe(false);
  });
});

describe("entitlement", () => {
  it("blocks voucher free access until the card is vaulted", () => {
    expect(isEntitled(voucherCreator(), null, AUG)).toBe(false);
    expect(isEntitled(voucherCreator({ cardOnFile: true }), null, AUG)).toBe(true);
  });

  it("a live subscription satisfies the rule by itself — subscribing IS a card", () => {
    expect(isEntitled(voucherCreator(), { status: "active" }, AUG)).toBe(true);
  });

  it("manual comps keep working with no card, exactly as before", () => {
    expect(isEntitled({ freeAccess: true, freeAccessUntil: null }, null, AUG)).toBe(true);
  });

  it("the card alone buys nothing once the free period lapses", () => {
    const NOV = new Date("2026-11-15T12:00:00Z");
    expect(isEntitled(voucherCreator({ cardOnFile: true }), null, NOV)).toBe(false);
  });
});

describe("the wiring", () => {
  const read = (f: string) =>
    readFileSync(join(__dirname, "../../", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("the requirement is stamped at voucher redemption only", () => {
    expect(read("server/authRoutes.ts")).toContain("overageCardRequired: voucherGrants.freeAccess");
  });

  it("the setup-mode webhook marks the account", () => {
    const wh = read("server/webhookHandlers.ts");
    const branch = wh.slice(wh.indexOf("session.mode === 'setup'"), wh.indexOf("The standalone admin setup fee") > -1 ? wh.indexOf("purpose === 'setup_fee'") : undefined);
    expect(branch).toContain("cardOnFile: true");
  });

  it("paid checkouts mark it too — a purchase proves a card", () => {
    const wh = read("server/webhookHandlers.ts");
    const marks = wh.match(/cardOnFile: true/g) ?? [];
    expect(marks.length).toBeGreaterThanOrEqual(3);
  });

  it("the plan prompt stands down while a card is owed — one ask at a time", () => {
    const routes = read("server/routes.ts");
    expect(routes).toMatch(/needed: !isEntitled\(user, sub\) && !feeOutstanding && !cardOutstanding/);
  });

  it("consent language sits on the button that vaults the card", () => {
    expect(read("client/src/components/CardOnFileBanner.tsx"))
      .toMatch(/you agree that\s*usage beyond your plan/);
  });
});
