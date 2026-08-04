import { describe, it, expect } from 'vitest';
import { planPayouts, executePayouts, idempotencyKeyFor, type PayoutExecDeps, type PayableCommission } from '../../server/payouts';

describe('planPayouts', () => {
  it('groups approved commissions per affiliate and sums cents', () => {
    const cs: PayableCommission[] = [
      { id: 'c1', affiliateId: 'a1', commissionAmount: '8.00', status: 'approved' },
      { id: 'c2', affiliateId: 'a1', commissionAmount: '2.00', status: 'approved' },
      { id: 'c3', affiliateId: 'a2', commissionAmount: '5.00', status: 'approved' },
    ];
    const plan = planPayouts(cs);
    const a1 = plan.payable.find(g => g.affiliateId === 'a1')!;
    expect(a1.amountCents).toBe(1000);
    expect(a1.commissionIds).toEqual(['c1', 'c2']);
    expect(plan.payable.find(g => g.affiliateId === 'a2')!.amountCents).toBe(500);
  });

  it('ignores non-approved and non-positive commissions', () => {
    const cs: PayableCommission[] = [
      { id: 'c1', affiliateId: 'a1', commissionAmount: '8.00', status: 'pending' },
      { id: 'c2', affiliateId: 'a1', commissionAmount: '0.00', status: 'approved' },
      { id: 'c3', affiliateId: 'a1', commissionAmount: '9.00', status: 'paid' },
    ];
    expect(planPayouts(cs).payable).toHaveLength(0);
  });

  it('holds groups below the minimum transfer threshold', () => {
    const cs: PayableCommission[] = [
      { id: 'c1', affiliateId: 'a1', commissionAmount: '0.30', status: 'approved' }, // 30c < 50c
      { id: 'c2', affiliateId: 'a2', commissionAmount: '0.50', status: 'approved' }, // 50c == threshold
    ];
    const plan = planPayouts(cs);
    expect(plan.payable.map(g => g.affiliateId)).toEqual(['a2']);
    expect(plan.heldBelowThreshold.map(g => g.affiliateId)).toEqual(['a1']);
  });
});

function makeDeps(overrides: Partial<PayoutExecDeps> = {}) {
  const calls = {
    transfers: [] as any[],
    payoutsCreated: [] as any[],
    statusUpdates: [] as any[],
    commissionsPaid: [] as any[],
  };
  let seq = 0;
  const deps: PayoutExecDeps = {
    getApprovedCommissions: async () => [],
    getConnectAccount: async () => ({ accountId: 'acct_1', onboarded: true }),
    createPayout: async (affiliateId, amountCents) => {
      const id = `po_${++seq}`;
      calls.payoutsCreated.push({ id, affiliateId, amountCents });
      return { id };
    },
    updatePayoutStatus: async (payoutId, status, transferId) => {
      calls.statusUpdates.push({ payoutId, status, transferId });
    },
    markCommissionsPaid: async (commissionIds, payoutId) => {
      calls.commissionsPaid.push({ commissionIds, payoutId });
    },
    transfer: async (amountCents, dest, idempotencyKey, metadata) => {
      calls.transfers.push({ amountCents, dest, idempotencyKey, metadata });
      return { id: `tr_${calls.transfers.length}` };
    },
    ...overrides,
  };
  return { deps, calls };
}

const approved = (): PayableCommission[] => [
  { id: 'c1', affiliateId: 'a1', commissionAmount: '8.00', status: 'approved' },
  { id: 'c2', affiliateId: 'a1', commissionAmount: '2.00', status: 'approved' },
];

describe('executePayouts', () => {
  it('pays an onboarded affiliate with an idempotent transfer and marks commissions paid', async () => {
    const { deps, calls } = makeDeps({ getApprovedCommissions: approved });
    const summary = await executePayouts(deps);

    expect(summary.paid).toHaveLength(1);
    expect(summary.paid[0].amountCents).toBe(1000);
    expect(summary.paid[0].transferId).toBe('tr_1');
    expect(calls.transfers[0].amountCents).toBe(1000);
    // Keyed on the COMMISSIONS, not the payout row. This used to assert
    // 'payout_po_1', which encoded the double-pay bug: payout ids are minted
    // fresh every run, so a retry presented a new key and Stripe sent the money
    // again. See tests/unit/payout-double-pay.test.ts.
    expect(calls.transfers[0].idempotencyKey).toBe(idempotencyKeyFor('a1', ['c1', 'c2']));
    expect(calls.transfers[0].metadata).toMatchObject({ payoutId: 'po_1', affiliateId: 'a1' });
    expect(calls.commissionsPaid[0].commissionIds).toEqual(['c1', 'c2']);
    expect(calls.statusUpdates.map(s => s.status)).toEqual(['processing', 'paid']);
    expect(calls.statusUpdates[1].transferId).toBe('tr_1');
  });

  it('holds below-threshold balances without transferring or creating a payout', async () => {
    const { deps, calls } = makeDeps({
      getApprovedCommissions: async () => [{ id: 'c1', affiliateId: 'a1', commissionAmount: '0.30', status: 'approved' }],
    });
    const summary = await executePayouts(deps);
    expect(summary.heldBelowThreshold).toHaveLength(1);
    expect(calls.transfers).toHaveLength(0);
    expect(calls.payoutsCreated).toHaveLength(0);
  });

  it('skips affiliates without an onboarded Connect account', async () => {
    const { deps, calls } = makeDeps({
      getApprovedCommissions: approved,
      getConnectAccount: async () => ({ accountId: null, onboarded: false }),
    });
    const summary = await executePayouts(deps);
    expect(summary.skippedNoAccount).toHaveLength(1);
    expect(calls.transfers).toHaveLength(0);
    expect(calls.payoutsCreated).toHaveLength(0);
  });

  it('marks the payout failed and does NOT mark commissions paid when the transfer throws', async () => {
    const { deps, calls } = makeDeps({
      getApprovedCommissions: approved,
      transfer: async () => { throw new Error('insufficient funds'); },
    });
    const summary = await executePayouts(deps);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].error).toBe('insufficient funds');
    expect(calls.commissionsPaid).toHaveLength(0);
    expect(calls.statusUpdates.at(-1)!.status).toBe('failed');
  });
});
