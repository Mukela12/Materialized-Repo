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
  mintCodes, MAX_BATCH, canonicalCode, type VoucherRecord,
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

/**
 * Minting a batch.
 *
 * The client's real case, in her words: hand a partner 80 codes to give to
 * their brands and media contacts. The first version of this system could only
 * express that as ONE code redeemable 80 times — which cannot say who used it,
 * cannot be revoked for one recipient, and once forwarded is forwarded to
 * everybody. These tests pin the properties that make 80 codes different from
 * one code used 80 times.
 */
describe("minting a batch", () => {
  const never = async () => false;

  it("mints exactly as many codes as asked for", async () => {
    const codes = await mintCodes(80, never);
    expect(codes).toHaveLength(80);
  });

  it("mints codes that are all different — the point of a batch", async () => {
    const codes = await mintCodes(80, never);
    expect(new Set(codes).size).toBe(80);
  });

  it("does not reuse a code that is already in the database", async () => {
    const existing = "MTZ-AAAA-BBBB-CCCC";
    let first = true;
    // A generator that would hand back the existing code once.
    const generate = () => (first ? ((first = false), existing) : generateVoucherCode());
    const codes = await mintCodes(1, async (c) => c === existing, generate);
    expect(codes[0]).not.toBe(existing);
  });

  it("does not hand back the same code twice within one batch", async () => {
    // `exists` queries the DATABASE, which cannot see codes minted moments ago
    // in this same loop. Without in-batch tracking a repeating generator gets
    // through here and fails later, at insert, part-way through the batch.
    const canned = ["MTZ-1111-1111-1111", "MTZ-1111-1111-1111", "MTZ-2222-2222-2222"];
    let i = 0;
    const codes = await mintCodes(2, never, () => canned[i++] ?? generateVoucherCode());
    expect(new Set(codes).size).toBe(2);
  });

  it("gives up rather than looping forever when every code collides", async () => {
    await expect(mintCodes(1, async () => true)).rejects.toThrow(/unique/i);
  });

  it("caps a batch, so a typo cannot mint a hundred thousand codes", async () => {
    expect(await mintCodes(999_999, never)).toHaveLength(MAX_BATCH);
  });

  it("treats junk quantities as one, never as zero", async () => {
    for (const q of [0, -5, NaN, 0.4]) {
      expect(await mintCodes(q as number, never)).toHaveLength(1);
    }
  });

  it("normalises what it returns, so stored codes match what a human types", async () => {
    const codes = await mintCodes(3, never);
    for (const c of codes) expect(c).toBe(normaliseCode(c));
  });
});

/**
 * Matching a code the way a human actually types it.
 *
 * Codes are minted as MTZ-CSCQ-SGPW-QYDA and matching stripped whitespace only.
 * "MTZCSCQSGPWQYDA" — the same code, typed without its dashes, which is what
 * anyone copying it off a phone does — was rejected with "That voucher code was
 * not recognised", the identical message an invented code gets.
 *
 * The client hit this in front of a client, on a demo call already rescheduled
 * twice, with 160 codes in circulation. The failure was invisible from the
 * message: nothing said the code was right and only the punctuation wrong.
 */
describe("matching a code as typed", () => {
  const MINTED = "MTZ-CSCQ-SGPW-QYDA";

  it("matches the code without its dashes — the case that broke the demo", () => {
    expect(canonicalCode("MTZCSCQSGPWQYDA")).toBe(canonicalCode(MINTED));
  });

  it("still matches the code exactly as printed", () => {
    expect(canonicalCode(MINTED)).toBe(canonicalCode(MINTED));
  });

  it("matches regardless of case, spacing or stray punctuation", () => {
    for (const typed of [
      "mtz-cscq-sgpw-qyda",
      "MTZ CSCQ SGPW QYDA",
      "  MTZ-CSCQ-SGPW-QYDA  ",
      "MTZ.CSCQ.SGPW.QYDA",
      "MTZ_CSCQ_SGPW_QYDA",
      "mtzcscqsgpwqyda",
    ]) {
      expect(canonicalCode(typed), `"${typed}" should match`).toBe(canonicalCode(MINTED));
    }
  });

  it("still refuses a genuinely different code", () => {
    // The client's actual typo: one character dropped from CSCQ. A code that is
    // wrong must stay wrong — this fix is about punctuation, not fuzziness.
    expect(canonicalCode("MTZCSQSGPWQYDA")).not.toBe(canonicalCode(MINTED));
    expect(canonicalCode("MTZ-XXXX-YYYY-ZZZZ")).not.toBe(canonicalCode(MINTED));
  });

  it("leaves the STORED form alone, so printed codes keep their dashes", () => {
    // normaliseCode is what gets written to the row. If it started stripping
    // dashes, every newly minted code would print as an unreadable run of
    // fifteen characters.
    expect(normaliseCode(MINTED)).toBe(MINTED);
    expect(normaliseCode(MINTED)).toContain("-");
  });
});
