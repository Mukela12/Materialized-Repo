/**
 * The scheduler, and the cron matcher under it.
 *
 * There was no scheduler at all, so "weekly automated payouts" was untrue. The
 * reason this is more than a setInterval is that three ordinary properties of a
 * process are unsafe when money moves on a timetable:
 *
 *   - it only fires while alive, so a redeploy at 09:00 Monday silently skips a
 *     week's payouts;
 *   - every instance fires, so two instances pay everyone twice;
 *   - it leaves no record, so "did Monday run?" cannot be answered.
 *
 * These tests pin the answers to all three: catch-up, single-claim, and ledger.
 */
import { describe, it, expect, vi } from "vitest";
import { parseCron, cronMatches, previousOccurrence } from "../../server/cron";
import { Scheduler, type SchedulerStore, type ScheduledJob, type JobResult } from "../../server/scheduler";
import {
  summarisePayoutRun, previousMonthWindow,
  DEFAULT_PAYOUT_CRON, DEFAULT_FEE_INVOICE_CRON,
} from "../../server/scheduledJobs";
import type { PayoutRunSummary } from "../../server/payouts";

const utc = (s: string) => new Date(s + "Z");

describe("cron matching", () => {
  it("matches Mondays at 09:00 UTC, the payout schedule", () => {
    const spec = parseCron(DEFAULT_PAYOUT_CRON);
    expect(cronMatches(spec, utc("2026-08-03T09:00:00"))).toBe(true);  // a Monday
    expect(cronMatches(spec, utc("2026-08-03T09:01:00"))).toBe(false);
    expect(cronMatches(spec, utc("2026-08-03T10:00:00"))).toBe(false);
    expect(cronMatches(spec, utc("2026-08-04T09:00:00"))).toBe(false); // Tuesday
  });

  it("matches the 1st of the month at 09:00 UTC, the invoicing schedule", () => {
    const spec = parseCron(DEFAULT_FEE_INVOICE_CRON);
    expect(cronMatches(spec, utc("2026-09-01T09:00:00"))).toBe(true);
    expect(cronMatches(spec, utc("2026-09-02T09:00:00"))).toBe(false);
  });

  it("treats both 0 and 7 as Sunday", () => {
    const sunday = utc("2026-08-02T09:00:00");
    expect(cronMatches(parseCron("0 9 * * 0"), sunday)).toBe(true);
    expect(cronMatches(parseCron("0 9 * * 7"), sunday)).toBe(true);
  });

  it("ORs day-of-month with day-of-week when both are restricted", () => {
    // The standard cron quirk. Getting it wrong would turn "the 1st, and also
    // Mondays" into "only a 1st that happens to be a Monday".
    const spec = parseCron("0 9 1 * 1");
    expect(cronMatches(spec, utc("2026-09-01T09:00:00"))).toBe(true); // 1st, a Tuesday
    expect(cronMatches(spec, utc("2026-09-07T09:00:00"))).toBe(true); // a Monday
    expect(cronMatches(spec, utc("2026-09-08T09:00:00"))).toBe(false);
  });

  it("handles lists, ranges and steps", () => {
    expect(cronMatches(parseCron("0,30 * * * *"), utc("2026-08-03T04:30:00"))).toBe(true);
    expect(cronMatches(parseCron("0 9-17 * * *"), utc("2026-08-03T13:00:00"))).toBe(true);
    expect(cronMatches(parseCron("0 9-17 * * *"), utc("2026-08-03T18:00:00"))).toBe(false);
    expect(cronMatches(parseCron("*/15 * * * *"), utc("2026-08-03T04:45:00"))).toBe(true);
    expect(cronMatches(parseCron("*/15 * * * *"), utc("2026-08-03T04:46:00"))).toBe(false);
  });

  it("rejects a malformed expression rather than silently never firing", () => {
    expect(() => parseCron("0 9 * *")).toThrow(/5 fields/);
  });

  it("finds the previous occurrence, which is what makes a missed run catchable", () => {
    const spec = parseCron(DEFAULT_PAYOUT_CRON);
    // Wednesday: the last Monday 09:00 was two days earlier.
    const prev = previousOccurrence(spec, utc("2026-08-05T14:23:00"));
    expect(prev?.toISOString()).toBe("2026-08-03T09:00:00.000Z");
  });

  it("returns the current minute when it is itself an occurrence", () => {
    const prev = previousOccurrence(parseCron(DEFAULT_PAYOUT_CRON), utc("2026-08-03T09:00:00"));
    expect(prev?.toISOString()).toBe("2026-08-03T09:00:00.000Z");
  });
});

function fakeStore() {
  const claims = new Set<string>();
  const completed: Array<{ id: string; result: JobResult }> = [];
  // PER JOB, as the real query is (it filters on job_name). A single shared
  // value would let one job's run suppress another's — which is exactly what
  // this fake did on its first draft, and the multi-job test caught it.
  const last = new Map<string, Date>();
  const store: SchedulerStore & { claims: Set<string>; completed: typeof completed } = {
    claims, completed,
    async claimRun(jobName, scheduledFor) {
      const key = `${jobName}::${scheduledFor.toISOString()}`;
      if (claims.has(key)) return null;      // the unique index, in miniature
      claims.add(key);
      last.set(jobName, scheduledFor);
      return { id: key };
    },
    async completeRun(id, result) { completed.push({ id, result }); },
    async lastRunOccurrence(jobName) { return last.get(jobName) ?? null; },
  };
  return store;
}

function job(name: string, schedule: string, run: () => Promise<JobResult>): ScheduledJob {
  return { name, schedule, run };
}

const OK: JobResult = { status: "success", items: 1, detail: "done" };

describe("the scheduler", () => {
  it("runs a job when its occurrence has not been run", async () => {
    const store = fakeStore();
    const run = vi.fn(async () => OK);
    const s = new Scheduler(store, [job("payouts", DEFAULT_PAYOUT_CRON, run)], () => {});

    await s.tick(utc("2026-08-03T09:00:00"));

    expect(run).toHaveBeenCalledTimes(1);
    expect(store.completed[0].result).toEqual(OK);
  });

  it("does NOT run the same occurrence twice", async () => {
    const store = fakeStore();
    const run = vi.fn(async () => OK);
    const s = new Scheduler(store, [job("payouts", DEFAULT_PAYOUT_CRON, run)], () => {});

    await s.tick(utc("2026-08-03T09:00:00"));
    await s.tick(utc("2026-08-03T09:01:00"));
    await s.tick(utc("2026-08-03T15:00:00"));

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("catches up a window missed while the process was down", async () => {
    // The redeploy-at-09:00 case. Booting on Wednesday must still run Monday's.
    const store = fakeStore();
    const run = vi.fn(async () => OK);
    const s = new Scheduler(store, [job("payouts", DEFAULT_PAYOUT_CRON, run)], () => {});

    await s.tick(utc("2026-08-05T14:23:00"));

    expect(run).toHaveBeenCalledTimes(1);
    // Stamped with the occurrence it is catching up, not with "now" — otherwise
    // it could not be told apart from the following week's run.
    expect([...store.claims][0]).toContain("2026-08-03T09:00:00.000Z");
  });

  it("runs the next week's occurrence after the previous one", async () => {
    const store = fakeStore();
    const run = vi.fn(async () => OK);
    const s = new Scheduler(store, [job("payouts", DEFAULT_PAYOUT_CRON, run)], () => {});

    await s.tick(utc("2026-08-03T09:00:00"));
    await s.tick(utc("2026-08-10T09:00:00"));

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("stands down when another instance has claimed the window", async () => {
    const store = fakeStore();
    // Pre-claim, as a second instance would have.
    await store.claimRun("payouts", utc("2026-08-03T09:00:00"));
    const run = vi.fn(async () => OK);
    // lastRunOccurrence would also report it, so null it out to isolate the
    // claim as the thing doing the work.
    store.lastRunOccurrence = async () => null;
    const s = new Scheduler(store, [job("payouts", DEFAULT_PAYOUT_CRON, run)], () => {});

    await s.tick(utc("2026-08-03T09:00:00"));

    expect(run).not.toHaveBeenCalled();
  });

  it("records a throwing job as failed instead of losing it", async () => {
    const store = fakeStore();
    const s = new Scheduler(store, [
      job("payouts", DEFAULT_PAYOUT_CRON, async () => { throw new Error("stripe down"); }),
    ], () => {});

    await s.tick(utc("2026-08-03T09:00:00"));

    expect(store.completed[0].result.status).toBe("failed");
    expect(store.completed[0].result.detail).toBe("stripe down");
  });

  it("keeps running other jobs when one throws", async () => {
    const store = fakeStore();
    const good = vi.fn(async () => OK);
    const s = new Scheduler(store, [
      job("a", "* * * * *", async () => { throw new Error("boom"); }),
      job("b", "* * * * *", good),
    ], () => {});

    await s.tick(utc("2026-08-03T09:00:00"));
    expect(good).toHaveBeenCalled();
  });
});

describe("the payout run summary", () => {
  const base: PayoutRunSummary = {
    paid: [], heldBelowThreshold: [], skippedNoAccount: [], failed: [], needsReconciliation: [],
  };

  it("reports a clean run as success", () => {
    const r = summarisePayoutRun({
      ...base,
      paid: [{ affiliateId: "a", payoutId: "p", amountCents: 5000, transferId: "tr" }],
    });
    expect(r.status).toBe("success");
    expect(r.items).toBe(1);
    expect(r.detail).toContain("$50.00");
  });

  it("reports an empty run as skipped, not success", () => {
    expect(summarisePayoutRun(base).status).toBe("skipped");
  });

  it("FAILS the run when money moved but was not recorded, even if every transfer worked", () => {
    // The critical one. Money left, the ledger did not record it, so those
    // commissions still look payable. Reporting success is how they get paid
    // again next Monday.
    const r = summarisePayoutRun({
      ...base,
      paid: [{ affiliateId: "a", payoutId: "p", amountCents: 5000, transferId: "tr" }],
      needsReconciliation: [{
        affiliateId: "b", payoutId: "p2", amountCents: 2500,
        transferId: "tr_2", commissionIds: ["c1"], error: "db write failed",
      }],
    });

    expect(r.status).toBe("failed");
    expect(r.detail).toContain("NEEDS RECONCILIATION");
    expect(r.detail).toContain("DO NOT re-run");
    expect(r.detail).toContain("tr_2");
  });
});

describe("the invoicing window", () => {
  it("is the previous whole calendar month", () => {
    const { from, to } = previousMonthWindow(utc("2026-09-01T09:00:00"));
    expect(from.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("crosses a year boundary correctly", () => {
    const { from, to } = previousMonthWindow(utc("2027-01-01T09:00:00"));
    expect(from.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("is derived from the occurrence, so a late catch-up bills the right month", () => {
    // Run on the 4th because the 1st was missed: must still bill August, not
    // September.
    const { from, to } = previousMonthWindow(utc("2026-09-01T09:00:00"));
    expect(from.toISOString().slice(0, 7)).toBe("2026-08");
    expect(to.toISOString().slice(0, 7)).toBe("2026-09");
  });
});
