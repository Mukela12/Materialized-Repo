/**
 * A rolling free period: N days from signup, not a calendar date.
 *
 * ── The client's spec, verbatim ──────────────────────────────────────────────
 * "Influencers, free-pass (no admin setup, 30-days subscription free) valid
 * 30-days when they create the account, and the offer valid for influencer
 * signups (using this voucher code) up until October 31."
 *
 * Two clocks in one sentence: the CODE redeems until 31 October, and each
 * SIGNUP gets its own 30 days. The system only had the first shape —
 * freeAccessUntil was copied from the voucher's expiry — so a code expiring
 * 31 Oct would free a 5 September signup for eight weeks and a 30 October
 * signup for one day, and neither for the promised thirty.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (f: string) =>
  readFileSync(join(__dirname, "../../", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the rolling window is computed at signup", () => {
  const auth = read("server/authRoutes.ts");

  it("freeDays wins over the voucher expiry", () => {
    expect(auth).toMatch(/check\.voucher\.freeDays != null\s*\?\s*new Date\(Date\.now\(\) \+ check\.voucher\.freeDays \* 24 \* 60 \* 60 \* 1000\)/);
  });

  it("a voucher without freeDays keeps the festival behaviour", () => {
    expect(auth).toMatch(/:\s*\(check\.voucher\.expiresAt \?\? null\)/);
  });
});

describe("freeDays survives the lookup", () => {
  /**
   * getVoucherByCode maps fields EXPLICITLY — its own comment explains that an
   * omitted field fails silently. A dropped freeDays reads as null, which is
   * the fixed-date behaviour: everyone free until 31 Oct instead of 30 days
   * each. Nobody complains about getting more free time, so it would surface
   * as a revenue hole in December.
   */
  it("is mapped in getVoucherByCode", () => {
    const storage = read("server/storage.ts");
    // The LAST implementation is DatabaseStorage's — MemStorage's comes first
    // and returns the stored row whole, so it needs no explicit mapping.
    const fn = storage.slice(storage.lastIndexOf("async getVoucherByCode"));
    expect(fn.slice(0, 1400)).toContain("freeDays: row.freeDays ?? null");
  });

  it("is part of the VoucherRecord contract", () => {
    expect(read("server/vouchers.ts")).toMatch(/freeDays: number \| null;/);
  });

  it("is persisted by createVoucher", () => {
    const storage = read("server/storage.ts");
    expect(storage).toContain("freeDays: v.freeDays ?? null");
  });
});

describe("the mint bounds it", () => {
  const routes = read("server/routes.ts");

  it("accepts 1-365 whole days, or null", () => {
    expect(routes).toMatch(/!Number\.isInteger\(days\) \|\| days < 1 \|\| days > 365/);
  });

  it("passes it through to the voucher", () => {
    expect(routes).toContain("freeDays: days,");
  });
});
