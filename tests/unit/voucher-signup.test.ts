/**
 * Voucher sign-up (QA pass, 29 Sep 2026, run as a Brooklyn code holder).
 *
 *  1. A waive_setup_fee code waived nothing: the grant was read and dropped,
 *     so every Brooklyn brand code holder still owed the $29 after the trial.
 *  2. A used-up single-use code created the account anyway and then failed to
 *     redeem, leaving it email-verified with no trial and no benefit: locked
 *     behind the subscription and the fee from its first second.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { owesSetupFee } from "../../server/setupFee";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const auth = code("server/authRoutes.ts");

describe("a waive_setup_fee code waives the setup fee", () => {
  it("a waived account owes nothing; paid and waived are separate facts", () => {
    expect(owesSetupFee({ role: "brand", setupFeePaid: false, setupFeeWaived: true })).toBe(false);
    expect(owesSetupFee({ role: "brand", setupFeePaid: false, setupFeeWaived: false })).toBe(true);
    expect(owesSetupFee({ role: "affiliate", setupFeePaid: true })).toBe(false);
    expect(owesSetupFee({ role: "creator", setupFeePaid: false })).toBe(false);
  });

  it("sign-up records it from the voucher", () => {
    expect(auth).toMatch(/setupFeeWaived: voucherGrants\.waiveSetupFee,/);
  });

  it("the fee checkout and the trial checkout both honour it, and nothing in a request can set it", () => {
    const routes = code("server/routes.ts");
    expect(routes).toMatch(/if \(user\.setupFeePaid \|\| user\.setupFeeWaived\) return res\.json\(\{ alreadyPaid: true \}\);/);
    expect(routes).toMatch(/\{ userId, plan, offer: "trial" \},\s*!!user\.setupFeeWaived,/);
    expect(routes).not.toMatch(/setupFeeWaived:\s*req\.body/);
  });

  it("people who already redeemed such a code are backfilled", () => {
    expect(read("migrations/0039_setup_fee_waived.sql")).toMatch(/v\.grant_type = 'waive_setup_fee'/);
  });
});

describe("a used-up code is refused before an account exists", () => {
  it("the pre-check uses the real redemption count", () => {
    expect(auth).toMatch(/const used = voucher \? await storage\.countVoucherRedemptions\(voucher\.id\) : 0;\s*const check = checkRedeemable\(voucher, \{ role, redemptionCount: used \}\);/);
    expect(auth).not.toMatch(/redemptionCount: 0/);
  });

  it("losing the last seat to a race leaves a normal trial account, verified by email, not a locked one", () => {
    expect(auth).toMatch(/freeAccess: trialWithoutVoucher,\s*freeAccessUntil: trialWithoutVoucher \? trialUntil : null,\s*setupFeeWaived: false,\s*emailVerified: false,/);
    expect(auth).toMatch(/voucherLost = r\.reason \?\? "exhausted";\s*voucherToRedeem = null;/);
    // The 409 comes after the verification email, not before it.
    expect(auth.indexOf("if (voucherLost) {")).toBeGreaterThan(auth.indexOf("await sendVerificationEmail({"));
  });
});
