/**
 * The 30-day hold on commissions (client, 3 Nov 2026): recorded as pending at
 * the sale, approved once 30 days old, then paid on the next Monday run.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { commissionHoldDays, payableFrom } from "../../server/commissionHold";
import { makeCommissionHoldJob, DEFAULT_COMMISSION_HOLD_CRON } from "../../server/scheduledJobs";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

afterEach(() => { delete process.env.COMMISSION_HOLD_DAYS; });

describe("commission hold", () => {
  it("holds for 30 days unless COMMISSION_HOLD_DAYS says otherwise", () => {
    expect(commissionHoldDays()).toBe(30);
    process.env.COMMISSION_HOLD_DAYS = "14";
    expect(commissionHoldDays()).toBe(14);
    process.env.COMMISSION_HOLD_DAYS = "nonsense";
    expect(commissionHoldDays()).toBe(30);
  });

  it("a sale on 12 Nov is payable on 12 Dec", () => {
    expect(payableFrom("2026-11-12T14:05:00Z").toISOString()).toBe("2026-12-12T14:05:00.000Z");
  });

  it("only moves pending rows past the cutoff, compared as UTC", () => {
    const src = read("server/commissionHold.ts");
    expect(src).toMatch(/set status = 'approved'\s+where status = 'pending' and created_at <= \$\{cutoff\.toISOString\(\)\}::timestamp/);
  });

  it("runs daily before the Monday payout and reports how many it approved", async () => {
    expect(DEFAULT_COMMISSION_HOLD_CRON).toBe("0 8 * * *");
    const job = makeCommissionHoldJob(async () => 3);
    expect(await job.run()).toEqual({ status: "success", items: 3, detail: "3 commissions approved after the hold" });
    expect(read("server/index.ts")).toMatch(/makeCommissionHoldJob\(async \(now\) => \(await import\("\.\/commissionHold"\)\)\.approveHeldCommissions\(now\)\),\s+makePayoutJob/);
  });
});

describe("a partner's own brand invites", () => {
  it("credit the partner, from the creator's own join date", () => {
    const src = read("server/partners.ts");
    expect(src).toMatch(/if \(row\.owner_is_partner\) return \{ partnerId: row\.owner_id, since \};/);
    expect(read("server/partnerSales.ts")).toMatch(/f\.batch_id in \(select 'invite:' \|\| b\.id from brands b where b\.owner_id = \$\{partnerId\}\)/);
  });
});
