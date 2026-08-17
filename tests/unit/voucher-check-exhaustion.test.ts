/**
 * The pre-signup check must count redemptions, not assume zero.
 *
 * ── The bug this exists for ──────────────────────────────────────────────────
 * POST /api/vouchers/check called checkRedeemable with `redemptionCount: 0`
 * hardcoded. That made "exhausted" the one refusal the check could never
 * return: a single-use code that had already been taken answered
 *
 *     { valid: true, message: "Voucher accepted — ..." }
 *
 * and the person only discovered otherwise at the end of the signup form.
 *
 * No seat was ever wrongly granted — storage.redeemVoucher counts inside the
 * transaction under an advisory lock, and that is the guarantee. This was the
 * pre-check disagreeing with it, which is a papercut everywhere and a real
 * problem with 216 single-use codes going out to two festivals: the second
 * person to try a passed-around code is told it is fine.
 *
 * Two tests, because the bug had two halves. The first covers the counting
 * itself; the second reads the route source, since the defect was entirely in
 * what the call site passed and no unit test reaches an Express handler.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemStorage } from "../../server/storage";
import { checkRedeemable } from "../../server/vouchers";

const voucherArgs = (over: Record<string, any> = {}) => ({
  code: "MTZ-ABCD-EFGH-JKMN",
  label: null,
  grantType: "free_access" as const,
  brandUserId: null,
  roleRestriction: null,
  maxRedemptions: 1,
  expiresAt: null,
  createdBy: null,
  batchId: null,
  assignedTo: null,
  activeFrom: null,
  ...over,
});

describe("counting a single voucher's redemptions", () => {
  it("is zero for a code nobody has taken", async () => {
    const s = new MemStorage();
    const v = await s.createVoucher(voucherArgs());
    expect(await s.countVoucherRedemptions(v.id)).toBe(0);
  });

  it("rises as the code is taken", async () => {
    const s = new MemStorage();
    const v = await s.createVoucher(voucherArgs({ maxRedemptions: 2 }));
    await s.redeemVoucher(v.id, "user-1", 2);
    expect(await s.countVoucherRedemptions(v.id)).toBe(1);
    await s.redeemVoucher(v.id, "user-2", 2);
    expect(await s.countVoucherRedemptions(v.id)).toBe(2);
  });

  it("counts only the voucher asked about", async () => {
    const s = new MemStorage();
    const a = await s.createVoucher(voucherArgs({ code: "MTZ-AAAA-AAAA-AAAA" }));
    const b = await s.createVoucher(voucherArgs({ code: "MTZ-BBBB-BBBB-BBBB" }));
    await s.redeemVoucher(a.id, "user-1", 1);
    expect(await s.countVoucherRedemptions(a.id)).toBe(1);
    expect(await s.countVoucherRedemptions(b.id)).toBe(0);
  });

  /** The end-to-end shape of the bug, assembled from the same two parts. */
  it("a spent single-use code reads as exhausted once the real count is used", async () => {
    const s = new MemStorage();
    const created = await s.createVoucher(voucherArgs({ maxRedemptions: 1 }));
    await s.redeemVoucher(created.id, "user-1", 1);

    const voucher = await s.getVoucherByCode("MTZ-ABCD-EFGH-JKMN");
    const count = await s.countVoucherRedemptions(created.id);

    const withRealCount = checkRedeemable(voucher, { role: "creator", redemptionCount: count });
    expect(withRealCount.ok).toBe(false);
    expect(!withRealCount.ok && withRealCount.reason).toBe("exhausted");

    // And the shape of the old bug, kept as the contrast: the same spent code
    // passed with a hardcoded zero, which is what the endpoint used to do.
    const withHardcodedZero = checkRedeemable(voucher, { role: "creator", redemptionCount: 0 });
    expect(withHardcodedZero.ok).toBe(true);
  });
});

describe("the /api/vouchers/check route", () => {
  const SRC = readFileSync(join(__dirname, "../../server/routes.ts"), "utf8");

  /** The handler body for POST /api/vouchers/check. */
  function handler(): string {
    const start = SRC.indexOf('app.post("/api/vouchers/check"');
    expect(start).toBeGreaterThan(-1);
    // Far enough to cover the handler without reaching the next route.
    return SRC.slice(start, start + 2000);
  }

  it("passes a counted value to checkRedeemable, not a literal zero", () => {
    const body = handler();
    const call = body.slice(body.indexOf("checkRedeemable("));
    expect(call).not.toMatch(/redemptionCount:\s*0\b/);
    expect(call).toMatch(/redemptionCount/);
  });

  it("asks storage for that count", () => {
    expect(handler()).toContain("countVoucherRedemptions");
  });
});
