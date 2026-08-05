/**
 * Vouchers.
 *
 * What they replace: one string in an environment variable, the same for
 * everyone, uncapped, never expiring, recording nothing, revocable only by
 * rotating it for everybody at once. It could not express the offer it was
 * needed for — 20 free creator accounts, tied to the brand who earned them.
 *
 * The two properties worth defending:
 *
 *   THE CAP HOLDS. "20 seats" has to mean 20 even when twenty people redeem at
 *   once. That guarantee lives in the database (advisory lock + unique index),
 *   not here — checkRedeemable takes the count as an argument precisely so it
 *   cannot pretend to enforce something it can't see.
 *
 *   A WRONG CODE SAYS SO. The old path silently created an ordinary account on
 *   a mismatch, so a creator handed a voucher would get a normal trial and never
 *   learn it hadn't worked — nor would the brand, until they asked why their
 *   people had no access.
 */
import { describe, it, expect } from "vitest";
import {
  checkRedeemable, generateVoucherCode, normaliseCode, grantsOf, seatsRemaining,
  type VoucherRecord,
} from "../../server/vouchers";

const voucher = (over: Partial<VoucherRecord> = {}): VoucherRecord => ({
  id: "v1", code: "MTZ-ABCD-EFGH-JKMN", grantType: "free_access",
  brandUserId: null, roleRestriction: null, maxRedemptions: 20,
  expiresAt: null, revokedAt: null, ...over,
});

const NOW = new Date("2026-08-05T12:00:00Z");

describe("redeeming a voucher", () => {
  it("accepts a healthy voucher", () => {
    const r = checkRedeemable(voucher(), { role: "creator", redemptionCount: 0, now: NOW });
    expect(r.ok).toBe(true);
  });

  it("accepts the LAST seat, but not one past it", () => {
    // Off-by-one here hands out a 21st free account.
    expect(checkRedeemable(voucher(), { role: "creator", redemptionCount: 19, now: NOW }).ok).toBe(true);
    expect(checkRedeemable(voucher(), { role: "creator", redemptionCount: 20, now: NOW }).ok).toBe(false);
  });

  it("refuses an unknown code, and says so", () => {
    const r = checkRedeemable(null, { role: "creator", redemptionCount: 0, now: NOW });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("not_found");
    expect(!r.ok && r.message).toMatch(/not recognised/i);
  });

  it("refuses a revoked voucher", () => {
    const r = checkRedeemable(voucher({ revokedAt: new Date("2026-08-01") }),
      { role: "creator", redemptionCount: 0, now: NOW });
    expect(!r.ok && r.reason).toBe("revoked");
  });

  it("refuses an expired voucher, judged at read time", () => {
    // No scheduler expires anything; the comparison does.
    const r = checkRedeemable(voucher({ expiresAt: new Date("2026-08-04T23:59:00Z") }),
      { role: "creator", redemptionCount: 0, now: NOW });
    expect(!r.ok && r.reason).toBe("expired");
  });

  it("treats the expiry instant itself as expired", () => {
    const r = checkRedeemable(voucher({ expiresAt: NOW }), { role: "creator", redemptionCount: 0, now: NOW });
    expect(!r.ok && r.reason).toBe("expired");
  });

  it("accepts a voucher that has not yet expired", () => {
    const r = checkRedeemable(voucher({ expiresAt: new Date("2026-09-01") }),
      { role: "creator", redemptionCount: 0, now: NOW });
    expect(r.ok).toBe(true);
  });

  it("refuses a creator-only voucher used on a brand signup", () => {
    // The GTM offer is creator seats; a brand redeeming one would consume a seat
    // and get the wrong thing.
    const r = checkRedeemable(voucher({ roleRestriction: "creator" }),
      { role: "brand", redemptionCount: 0, now: NOW });
    expect(!r.ok && r.reason).toBe("wrong_role");
    expect(!r.ok && r.message).toMatch(/creator account/i);
  });

  it("allows any role when unrestricted", () => {
    for (const role of ["creator", "brand", "affiliate"]) {
      expect(checkRedeemable(voucher(), { role, redemptionCount: 0, now: NOW }).ok).toBe(true);
    }
  });

  it("never exhausts an uncapped voucher", () => {
    const r = checkRedeemable(voucher({ maxRedemptions: null }),
      { role: "creator", redemptionCount: 9999, now: NOW });
    expect(r.ok).toBe(true);
  });

  it("checks revocation before exhaustion, so the clearer reason wins", () => {
    const r = checkRedeemable(voucher({ revokedAt: NOW, maxRedemptions: 1 }),
      { role: "creator", redemptionCount: 5, now: NOW });
    expect(!r.ok && r.reason).toBe("revoked");
  });
});

describe("what a voucher grants", () => {
  it("free access, for the GTM creator seats", () => {
    expect(grantsOf(voucher())).toEqual({ freeAccess: true, waiveSetupFee: false });
  });

  it("or a waived setup fee, which is not the same thing", () => {
    expect(grantsOf(voucher({ grantType: "waive_setup_fee" })))
      .toEqual({ freeAccess: false, waiveSetupFee: true });
  });
});

describe("seats remaining", () => {
  it("counts down, and floors at zero", () => {
    expect(seatsRemaining(voucher(), 0)).toBe(20);
    expect(seatsRemaining(voucher(), 13)).toBe(7);
    expect(seatsRemaining(voucher(), 20)).toBe(0);
    expect(seatsRemaining(voucher(), 25)).toBe(0); // never negative
  });

  it("is null for an uncapped voucher rather than a misleading number", () => {
    expect(seatsRemaining(voucher({ maxRedemptions: null }), 5)).toBeNull();
  });
});

describe("the code itself", () => {
  it("avoids characters that get misread aloud", () => {
    // A brand reads these to people. O/0, I/1/L are the classic mistypes.
    for (let i = 0; i < 200; i++) {
      expect(generateVoucherCode()).not.toMatch(/[O0I1LUV]/);
    }
  });

  it("is not guessable from another one", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateVoucherCode()));
    expect(seen.size).toBe(500); // no collisions, not sequential
  });

  it("is grouped for readability and carries a prefix", () => {
    expect(generateVoucherCode()).toMatch(/^MTZ-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });
});

describe("matching what a human types", () => {
  it("ignores case and spaces", () => {
    expect(normaliseCode(" mtz-abcd-efgh ")).toBe("MTZ-ABCD-EFGH");
    expect(normaliseCode("MTZ ABCD EFGH")).toBe("MTZABCDEFGH");
  });

  it("is stable, so the same typing always resolves the same way", () => {
    expect(normaliseCode("mtz-abcd")).toBe(normaliseCode("MTZ-ABCD"));
  });
});
