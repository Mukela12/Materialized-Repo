import { describe, it, expect } from 'vitest';
import { MemStorage } from '../../server/storage';

// These tests drive MemStorage through its public commission methods only (all pure
// in-memory Map ops — no DB round-trip), exercising the real status/scoping guards.

function baseTx(overrides: Record<string, any> = {}) {
  return {
    affiliateId: 'aff1',
    analyticsEventId: null,
    videoId: 'v1',
    productId: null,
    saleAmount: '100.00',
    commissionRate: '8.00',
    commissionAmount: '8.00',
    campaignAffiliateId: null,
    externalOrderId: null,
    storeConnectionId: null,
    ...overrides,
  } as any;
}

describe('MemStorage.markCommissionsPaid — status guard (Finding A)', () => {
  it('advances an approved row to paid and stamps the payoutId', async () => {
    const s = new MemStorage();
    const tx = await s.createCommissionTransaction(baseTx());
    await s.updateCommissionTransactionStatus(tx.id, 'approved');

    await s.markCommissionsPaid([tx.id], 'payout1');

    const after = await s.getCommissionTransaction(tx.id);
    expect(after?.status).toBe('paid');
    expect(after?.payoutId).toBe('payout1');
  });

  it('does NOT resurrect a reversed row to paid (no double-pay)', async () => {
    const s = new MemStorage();
    const tx = await s.createCommissionTransaction(baseTx());
    await s.updateCommissionTransactionStatus(tx.id, 'reversed');

    await s.markCommissionsPaid([tx.id], 'payout1');

    const after = await s.getCommissionTransaction(tx.id);
    expect(after?.status).toBe('reversed');
    expect(after?.payoutId ?? null).toBeNull();
  });

  it('only advances approved rows in a mixed batch', async () => {
    const s = new MemStorage();
    const approved = await s.createCommissionTransaction(baseTx());
    const reversed = await s.createCommissionTransaction(baseTx({ affiliateId: 'aff2' }));
    await s.updateCommissionTransactionStatus(approved.id, 'approved');
    await s.updateCommissionTransactionStatus(reversed.id, 'reversed');

    await s.markCommissionsPaid([approved.id, reversed.id], 'payout1');

    expect((await s.getCommissionTransaction(approved.id))?.status).toBe('paid');
    expect((await s.getCommissionTransaction(reversed.id))?.status).toBe('reversed');
  });
});

describe('MemStorage — external-order lookups scoped by store (Finding C)', () => {
  it('scopes dedup to the store so identical order ids in different stores do not collide', async () => {
    const s = new MemStorage();
    await s.createCommissionTransaction(baseTx({ externalOrderId: 'order-1', storeConnectionId: 'storeA' }));

    expect(await s.hasCommissionForExternalOrder('order-1', 'storeA')).toBe(true);
    // Same order id, different store — must NOT match.
    expect(await s.hasCommissionForExternalOrder('order-1', 'storeB')).toBe(false);
    // Legacy 1-arg call still matches on order id alone.
    expect(await s.hasCommissionForExternalOrder('order-1')).toBe(true);
  });

  it('getCommissionsByExternalOrder returns only the requested store rows', async () => {
    const s = new MemStorage();
    await s.createCommissionTransaction(baseTx({ externalOrderId: 'order-1', storeConnectionId: 'storeA' }));
    await s.createCommissionTransaction(baseTx({ affiliateId: 'aff2', externalOrderId: 'order-1', storeConnectionId: 'storeB' }));

    const storeA = await s.getCommissionsByExternalOrder('order-1', 'storeA');
    expect(storeA.map(r => r.storeConnectionId)).toEqual(['storeA']);

    const both = await s.getCommissionsByExternalOrder('order-1');
    expect(both).toHaveLength(2);
  });
});
