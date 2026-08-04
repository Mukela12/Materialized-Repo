/**
 * The two ways payouts used to pay somebody twice.
 *
 * Both had to be closed before payouts could run unattended. A human pressing a
 * button notices "it said failed but the money left"; a Monday-morning cron does
 * not, and simply pays again the following week.
 *
 * 1. THE IDEMPOTENCY KEY WAS EPHEMERAL. The transfer was keyed on the payout row
 *    id, which is minted fresh on every run, so a retry presented a NEW key and
 *    Stripe genuinely sent the money a second time. The key is now derived from
 *    the commission set being settled.
 *
 * 2. A BOOKKEEPING FAILURE AFTER A SUCCESSFUL TRANSFER MARKED THE PAYOUT FAILED.
 *    The commissions stayed `approved`, so the next run paid them again on top
 *    of money that had already landed. `failed` now means, and only means, that
 *    no money moved; the money-left-but-unrecorded case is reported separately.
 */
import { describe, it, expect, vi } from "vitest";
import { executePayouts, idempotencyKeyFor, type PayoutExecDeps } from "../../server/payouts";

function deps(over: Partial<PayoutExecDeps> = {}): PayoutExecDeps & { transfers: any[] } {
  const transfers: any[] = [];
  let payoutSeq = 0;
  const base: PayoutExecDeps = {
    getApprovedCommissions: async () => [
      { id: "c1", affiliateId: "aff_1", commissionAmount: "30.00", status: "approved" },
      { id: "c2", affiliateId: "aff_1", commissionAmount: "20.00", status: "approved" },
    ],
    getConnectAccount: async () => ({ accountId: "acct_1", onboarded: true }),
    createPayout: async () => ({ id: `payout_${++payoutSeq}` }),
    updatePayoutStatus: async () => {},
    markCommissionsPaid: async () => {},
    transfer: async (amountCents, dest, idempotencyKey, metadata) => {
      transfers.push({ amountCents, dest, idempotencyKey, metadata });
      return { id: `tr_${transfers.length}` };
    },
    ...over,
  };
  return Object.assign(base, { transfers });
}

describe("the transfer idempotency key", () => {
  it("is derived from the commissions, not from the payout row", () => {
    // The payout row id changes on every run; the debt does not.
    const key = idempotencyKeyFor("aff_1", ["c1", "c2"]);
    expect(key).toMatch(/^payout_[0-9a-f]{40}$/);
    expect(key).not.toContain("payout_1");
  });

  it("is identical across two runs of the same debt", () => {
    // This is what makes Stripe return the original transfer instead of sending
    // the money again.
    expect(idempotencyKeyFor("aff_1", ["c1", "c2"]))
      .toBe(idempotencyKeyFor("aff_1", ["c1", "c2"]));
  });

  it("ignores the order the commissions arrive in", () => {
    expect(idempotencyKeyFor("aff_1", ["c2", "c1"]))
      .toBe(idempotencyKeyFor("aff_1", ["c1", "c2"]));
  });

  it("differs for a different debt, so a genuinely new payout is not suppressed", () => {
    expect(idempotencyKeyFor("aff_1", ["c1", "c2"]))
      .not.toBe(idempotencyKeyFor("aff_1", ["c1", "c2", "c3"]));
    expect(idempotencyKeyFor("aff_1", ["c1"]))
      .not.toBe(idempotencyKeyFor("aff_2", ["c1"]));
  });

  it("is the key actually handed to Stripe", async () => {
    const d = deps();
    await executePayouts(d);
    expect(d.transfers[0].idempotencyKey).toBe(idempotencyKeyFor("aff_1", ["c1", "c2"]));
  });
});

describe("when the transfer itself fails", () => {
  it("reports failed and leaves the commissions payable — no money moved", async () => {
    const markPaid = vi.fn(async () => {});
    const summary = await executePayouts(deps({
      transfer: async () => { throw new Error("insufficient funds"); },
      markCommissionsPaid: markPaid,
    }));

    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].error).toBe("insufficient funds");
    expect(summary.paid).toHaveLength(0);
    expect(summary.needsReconciliation).toHaveLength(0);
    // Nothing was marked paid, so the next run correctly retries.
    expect(markPaid).not.toHaveBeenCalled();
  });
});

describe("when the money left but the ledger write failed", () => {
  it("does NOT report failed — that is what caused the second payment", async () => {
    const summary = await executePayouts(deps({
      markCommissionsPaid: async () => { throw new Error("db write failed"); },
    }));

    // The old behaviour put this in `failed`, the commissions stayed approved,
    // and the next run paid the same debt again on top of a landed transfer.
    expect(summary.failed).toHaveLength(0);
    expect(summary.needsReconciliation).toHaveLength(1);
  });

  it("records the transfer id, so the money is traceable", async () => {
    const summary = await executePayouts(deps({
      markCommissionsPaid: async () => { throw new Error("db write failed"); },
    }));

    const r = summary.needsReconciliation[0];
    expect(r.transferId).toBe("tr_1");
    expect(r.affiliateId).toBe("aff_1");
    expect(r.amountCents).toBe(5000);
    expect(r.commissionIds).toEqual(["c1", "c2"]);
    expect(r.error).toBe("db write failed");
  });

  it("marks the payout PAID, never failed, because the money is gone", async () => {
    const statuses: Array<[string, string]> = [];
    await executePayouts(deps({
      updatePayoutStatus: async (id, status) => { statuses.push([id, status]); },
      markCommissionsPaid: async () => { throw new Error("db write failed"); },
    }));

    expect(statuses.map(s => s[1])).toContain("paid");
    expect(statuses.map(s => s[1])).not.toContain("failed");
  });
});

describe("the rest of the run", () => {
  it("continues after one affiliate fails", async () => {
    let call = 0;
    const summary = await executePayouts(deps({
      getApprovedCommissions: async () => [
        { id: "c1", affiliateId: "aff_1", commissionAmount: "30.00", status: "approved" },
        { id: "c2", affiliateId: "aff_2", commissionAmount: "40.00", status: "approved" },
      ],
      transfer: async () => {
        call++;
        if (call === 1) throw new Error("first one failed");
        return { id: "tr_ok" };
      },
    }));

    expect(summary.failed).toHaveLength(1);
    expect(summary.paid).toHaveLength(1);
  });

  it("never transfers to an affiliate who has not completed Connect onboarding", async () => {
    const d = deps({ getConnectAccount: async () => ({ accountId: "acct_1", onboarded: false }) });
    const summary = await executePayouts(d);

    expect(summary.skippedNoAccount).toHaveLength(1);
    expect(d.transfers).toHaveLength(0);
  });
});
