/**
 * Voucher days (29 Sep 2026).
 *
 * The admin form sent "2026-11-27" through new Date(), which is midnight UTC:
 * the Brooklyn codes shown as expiring 27 Nov would have stopped at 7pm New
 * York time on 26 Nov. A day now means that whole day; see
 * shared/voucherDates.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseVoucherDate, voucherDayToInstant, voucherInstantToDay } from "../../shared/voucherDates";
import { checkRedeemable, type VoucherRecord } from "../../server/vouchers";
import { inviteOfferEndLabel } from "../../server/inviteVoucher";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const voucher = (over: Partial<VoucherRecord> = {}): VoucherRecord => ({
  id: "v1", code: "MTZ-ABCD-EFGH-JKMN", grantType: "free_access",
  brandUserId: null, roleRestriction: null, maxRedemptions: 1,
  activeFrom: null, expiresAt: null, revokedAt: null, ...over,
});
const redeemAt = (v: VoucherRecord, iso: string) =>
  checkRedeemable(v, { role: "creator", redemptionCount: 0, now: new Date(iso) });

describe("a day becomes an instant", () => {
  it("an expiry day ends at 05:00 UTC the next morning", () => {
    expect(voucherDayToInstant("2026-11-27", "end").toISOString()).toBe("2026-11-28T05:00:00.000Z");
    expect(voucherDayToInstant("2026-12-31", "end").toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });

  it("a start day begins at 05:00 UTC that morning", () => {
    expect(voucherDayToInstant("2026-09-28", "start").toISOString()).toBe("2026-09-28T05:00:00.000Z");
  });

  it("keeps the three cases apart: absent, cleared, set", () => {
    expect(parseVoucherDate(undefined, "end")).toBeUndefined();
    expect(parseVoucherDate(null, "end")).toBeNull();
    expect(parseVoucherDate("", "end")).toBeNull();
    expect(parseVoucherDate("2026-11-27", "end")).toEqual(new Date("2026-11-28T05:00:00Z"));
    expect(parseVoucherDate(42, "end")).toEqual({ error: "must be a date string or null" });
    expect(parseVoucherDate("not a date", "end")).toEqual({ error: "must be a valid date" });
  });

  it("takes a full instant from a script as given", () => {
    expect(parseVoucherDate("2026-11-01T05:00:00Z", "end")).toEqual(new Date("2026-11-01T05:00:00Z"));
  });
});

describe("the Brooklyn codes work all of 27 Nov in New York", () => {
  const v = voucher({
    activeFrom: parseVoucherDate("2026-09-28", "start") as Date,
    expiresAt: parseVoucherDate("2026-11-27", "end") as Date,
  });

  it("still work on Thanksgiving evening, when the old midnight-UTC expiry had cut them off", () => {
    expect(redeemAt(v, "2026-11-27T00:30:00Z").ok).toBe(true); // 7:30pm EST, 26 Nov
  });

  it("work until 11:59pm on the 27th in New York (8:59pm in Los Angeles)", () => {
    expect(redeemAt(v, "2026-11-28T04:59:00Z").ok).toBe(true);
  });

  it("stop once the 27th is over in New York", () => {
    expect(redeemAt(v, "2026-11-28T05:00:00Z")).toMatchObject({ ok: false, reason: "expired" });
  });

  it("do not open the evening before the start day", () => {
    expect(redeemAt(v, "2026-09-28T00:30:00Z")).toMatchObject({ ok: false, reason: "not_yet_active" });
    expect(redeemAt(v, "2026-09-28T05:00:00Z").ok).toBe(true);
  });

  it("a summer last day is whole too (EDT)", () => {
    const summer = voucher({ expiresAt: parseVoucherDate("2026-10-10", "end") as Date });
    expect(redeemAt(summer, "2026-10-11T03:59:00Z").ok).toBe(true); // 11:59pm EDT on the 10th
  });
});

describe("the admin shows the day it was given", () => {
  it("round-trips every day of a year, both edges", () => {
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 86_400_000) {
      const day = new Date(t).toISOString().slice(0, 10);
      expect(voucherInstantToDay(voucherDayToInstant(day, "end"), "end")).toBe(day);
      expect(voucherInstantToDay(voucherDayToInstant(day, "start"), "start")).toBe(day);
    }
  });

  it("agrees with the invitation copy about rows the scripts wrote", () => {
    const end = new Date("2026-11-01T05:00:00Z");
    expect(voucherInstantToDay(end, "end")).toBe("2026-10-31");
    expect(inviteOfferEndLabel(end)).toBe("31 October");
  });

  it("the migrated form rows show the same day as before", () => {
    // 0036 moves 2026-11-27T00:00Z to 2026-11-28T05:00Z; the admin said 27 Nov then and now.
    const migrated = new Date(new Date("2026-11-27T00:00:00Z").getTime() + (24 + 5) * 3_600_000);
    expect(voucherInstantToDay(migrated, "end")).toBe("2026-11-27");
  });
});

describe("every entry point uses the rule", () => {
  it("both admin routes parse days with it", () => {
    const routes = code("server/routes.ts");
    expect(routes).toMatch(/parseVoucherDate\(expiresAt \?\? null, "end"\)/);
    expect(routes).toMatch(/parseVoucherDate\(req\.body\?\.activeFrom \?\? null, "start"\)/);
    expect(routes).toMatch(/parseVoucherDate\(req\.body\?\.expiresAt, "end"\)/);
    expect(routes).toMatch(/parseVoucherDate\(req\.body\?\.activeFrom, "start"\)/);
    expect(routes).not.toMatch(/new Date\(expiresAt\)|new Date\(req\.body\.activeFrom\)/);
  });

  it("the admin screen shows days with it, not the raw UTC date", () => {
    const ui = code("client/src/components/VoucherManager.tsx");
    expect(ui).not.toMatch(/(expiresAt|activeFrom)\??\.slice\(0, 10\)/);
    expect(ui.match(/voucherInstantToDay\(/g)?.length).toBe(4);
  });

  it("the migration moves only the midnight-UTC rows the old form wrote", () => {
    const sql = read("migrations/0036_voucher_day_edges.sql");
    expect(sql).toMatch(/SET expires_at = expires_at \+ interval '1 day 5 hours'\s+WHERE expires_at IS NOT NULL\s+AND expires_at::time = '00:00:00';/);
    expect(sql).toMatch(/SET active_from = active_from \+ interval '5 hours'\s+WHERE active_from IS NOT NULL\s+AND active_from::time = '00:00:00';/);
  });
});
