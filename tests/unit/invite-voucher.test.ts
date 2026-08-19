/**
 * The voucher that makes a brand's invitation true.
 *
 * ── The gap this closes ──────────────────────────────────────────────────────
 * The invitation email promised "subscription-free use until 31 October" and
 * linked to a bare /register — no code. So a creator read the promise, signed
 * up, and met a $149 "choose your plan" prompt. Every brand using the invite
 * button sent that contradiction, in writing, to someone they were recruiting.
 *
 * The mismatch is the thing under test: the promise in the copy and the grant
 * in the voucher have to agree, and they are written in different files.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  inviteOfferEnd, inviteCapPerBrand, inviteBatchId, inviteVoucherFields,
} from "../../server/inviteVoucher";

const fields = () => inviteVoucherFields({
  code: "MTZ-TEST-TEST-TEST",
  brandId: "brand-1",
  brandName: "Vogue",
  creatorEmail: "creator@example.com",
  invitedByUserId: "user-1",
});

afterEach(() => {
  delete process.env.INVITE_OFFER_END;
  delete process.env.INVITE_VOUCHER_CAP;
});

describe("what an invitation grants", () => {
  it("is free access, so the promise in the email is true", () => {
    expect(fields().grantType).toBe("free_access");
  });

  /** A code that opened a Brand or Publisher seat would give away a paid tier. */
  it("is creator-only", () => {
    expect(fields().roleRestriction).toBe("creator");
  });

  it("is single-use — an invitation is for one named person", () => {
    expect(fields().maxRedemptions).toBe(1);
  });

  it("expires when the offer does, not never", () => {
    expect(fields().expiresAt).toBeInstanceOf(Date);
    expect(fields().expiresAt!.getTime()).toBe(new Date("2026-11-01T05:00:00Z").getTime());
  });

  it("carries the brand, so a creator who joins is attributable", () => {
    expect(fields().partner).toBe("Vogue");
    expect(fields().batchId).toBe(inviteBatchId("brand-1"));
    expect(fields().assignedTo).toBe("creator@example.com");
  });

  it("is usable immediately — an invitation nobody can act on is not an invitation", () => {
    expect(fields().activeFrom).toBeNull();
  });
});

describe("the offer end date", () => {
  it("defaults to the end of 31 October, everywhere", () => {
    // 05:00Z on 1 Nov: past midnight in New York as well as London.
    expect(inviteOfferEnd().toISOString()).toBe("2026-11-01T05:00:00.000Z");
  });

  it("can be moved without a deploy", () => {
    process.env.INVITE_OFFER_END = "2026-12-31T23:00:00Z";
    expect(inviteOfferEnd().toISOString()).toBe("2026-12-31T23:00:00.000Z");
  });

  it("ignores nonsense rather than minting vouchers that expire at NaN", () => {
    process.env.INVITE_OFFER_END = "not a date";
    expect(inviteOfferEnd().toISOString()).toBe("2026-11-01T05:00:00.000Z");
  });
});

describe("the cap", () => {
  it("is finite by default — free access is the product", () => {
    expect(inviteCapPerBrand()).toBe(100);
  });

  it("is configurable", () => {
    process.env.INVITE_VOUCHER_CAP = "25";
    expect(inviteCapPerBrand()).toBe(25);
  });

  it("refuses to be turned off by a bad value", () => {
    for (const bad of ["0", "-5", "abc", ""]) {
      process.env.INVITE_VOUCHER_CAP = bad;
      expect(inviteCapPerBrand()).toBe(100);
    }
  });
});

describe("the promise and the grant agree", () => {
  const read = (f: string) =>
    readFileSync(join(__dirname, "../../", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("the invitation link carries the code", () => {
    const routes = read("server/routes.ts");
    expect(routes).toContain("/register?code=${encodeURIComponent(voucherCode)}");
  });

  it("the signup form reads it back out of the link", () => {
    const reg = read("client/src/pages/register.tsx");
    expect(reg).toMatch(/params\.get\("code"\)/);
    expect(reg).toContain("accessCode: invitedCode");
  });

  it("the email repeats the code, because mail clients mangle links", () => {
    expect(read("server/emailService.ts")).toContain("opts.voucherCode");
  });

  /** The copy states a date; the voucher must expire on one. */
  it("the copy names a date rather than a duration", () => {
    const copy = read("client/src/pages/brand-creators.tsx");
    expect(copy).toContain("OFFER_ENDS");
    expect(copy).not.toMatch(/a month of subscription-free/);
  });
});
