import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordSaleCommissions,
  clawbackSaleCommissions,
  type CommissionStore,
  type ClawbackStore,
  type CommissionRow,
} from '../../server/commissions';

beforeEach(() => {
  delete process.env.MARKETPLACE_FEE_PCT;
  delete process.env.PUBLISHER_COMMISSION_PCT;
  // The PLATFORM default creator rate is 0 (creators are paid by brands directly
  // — see server/feeConfig.ts). These tests exercise the creator-commission
  // MECHANISM, which still has to work whenever an admin sets a rate, so they pin
  // an explicit 8%. Default-rate behaviour is covered in fee-split.test.ts.
  process.env.CREATOR_COMMISSION_PCT = '8';
});

function makeStore(campaignAffiliates: any[] = []) {
  const commissions: any[] = [];
  const statUpdates: any[] = [];
  const store: CommissionStore = {
    async createCommissionTransaction(tx) {
      const row = { id: `c${commissions.length + 1}`, ...tx };
      commissions.push(row);
      return row;
    },
    async getCampaignAffiliates() {
      return campaignAffiliates;
    },
    async updateCampaignAffiliateStats(id, stats) {
      statUpdates.push({ id, stats });
      return stats;
    },
  };
  return { store, commissions, statUpdates };
}

describe('recordSaleCommissions', () => {
  it('creates creator + publisher commissions for a publisher-attributed sale', async () => {
    const { store, commissions } = makeStore();
    const r = await recordSaleCommissions(store, '100.00', {
      videoId: 'v1',
      creatorId: 'creator1',
      affiliateId: 'pub1',
      campaignAffiliateId: null,
      resolvedCommissionRate: null,
    });

    expect(commissions).toHaveLength(2);
    const creator = commissions.find((c) => c.affiliateId === 'creator1');
    const publisher = commissions.find((c) => c.affiliateId === 'pub1');
    expect(creator.commissionAmount).toBe('8.00');
    expect(creator.commissionRate).toBe('8.00');
    expect(publisher.commissionAmount).toBe('2.00');
    expect(publisher.commissionRate).toBe('2.00');
    // Split is returned for reporting (brand keeps 85, platform ~5).
    expect(r.split.brandCents).toBe(8500);
    expect(r.split.platformCents).toBe(500);
  });

  it('creates only the creator commission when no publisher is attributed', async () => {
    const { store, commissions, statUpdates } = makeStore();
    await recordSaleCommissions(store, '100.00', {
      videoId: 'v1',
      creatorId: 'creator1',
      affiliateId: null,
      campaignAffiliateId: null,
      resolvedCommissionRate: null,
    });
    expect(commissions).toHaveLength(1);
    expect(commissions[0].affiliateId).toBe('creator1');
    expect(commissions[0].commissionAmount).toBe('8.00');
    expect(statUpdates).toHaveLength(0);
  });

  it('treats affiliate == creator as no publisher (creator earns once)', async () => {
    const { store, commissions } = makeStore();
    await recordSaleCommissions(store, '100.00', {
      videoId: 'v1',
      creatorId: 'creator1',
      affiliateId: 'creator1',
      campaignAffiliateId: null,
      resolvedCommissionRate: null,
    });
    expect(commissions).toHaveLength(1);
    expect(commissions[0].affiliateId).toBe('creator1');
  });

  it('applies an admin per-repost publisher override', async () => {
    const { store, commissions } = makeStore();
    await recordSaleCommissions(store, '100.00', {
      videoId: 'v1',
      creatorId: 'creator1',
      affiliateId: 'pub1',
      campaignAffiliateId: 'ca1',
      resolvedCommissionRate: '5.00',
    });
    const publisher = commissions.find((c) => c.affiliateId === 'pub1');
    expect(publisher.commissionAmount).toBe('5.00');
    expect(publisher.commissionRate).toBe('5.00');
  });

  it('updates campaign-affiliate stats when a campaign publisher is attributed', async () => {
    const ca = { id: 'ca1', totalConversions: 2, totalRevenue: '50.00', totalEarnings: '1.00' };
    const { store, statUpdates } = makeStore([ca]);
    await recordSaleCommissions(store, '100.00', {
      videoId: 'v1',
      creatorId: 'creator1',
      affiliateId: 'pub1',
      campaignAffiliateId: 'ca1',
      resolvedCommissionRate: null,
    });
    expect(statUpdates).toHaveLength(1);
    expect(statUpdates[0].id).toBe('ca1');
    expect(statUpdates[0].stats.totalConversions).toBe(3);
    expect(statUpdates[0].stats.totalRevenue).toBe('150.00'); // 50 + 100
    expect(statUpdates[0].stats.totalEarnings).toBe('3.00');   // 1.00 + 2.00
  });

  it('skips the creator row when no creator is known', async () => {
    const { store, commissions } = makeStore();
    await recordSaleCommissions(store, '100.00', {
      videoId: 'v1',
      creatorId: null,
      affiliateId: 'pub1',
      campaignAffiliateId: null,
      resolvedCommissionRate: null,
    });
    expect(commissions).toHaveLength(1);
    expect(commissions[0].affiliateId).toBe('pub1');
  });

  it('applies resolved rates (admin/settings) passed by the caller', async () => {
    const { store, commissions } = makeStore();
    await recordSaleCommissions(
      store, '100.00',
      { videoId: 'v1', creatorId: 'creator1', affiliateId: 'pub1', campaignAffiliateId: null, resolvedCommissionRate: null },
      null,
      { marketplaceFeePct: 20, creatorPct: 10, publisherPct: 3 },
    );
    expect(commissions.find((c) => c.affiliateId === 'creator1').commissionAmount).toBe('10.00');
    expect(commissions.find((c) => c.affiliateId === 'pub1').commissionAmount).toBe('3.00');
  });

  it('lets a per-repost publisher override win over the resolved publisher rate', async () => {
    const { store, commissions } = makeStore();
    await recordSaleCommissions(
      store, '100.00',
      { videoId: 'v1', creatorId: 'creator1', affiliateId: 'pub1', campaignAffiliateId: 'ca1', resolvedCommissionRate: '6.00' },
      null,
      { marketplaceFeePct: 20, creatorPct: 10, publisherPct: 3 },
    );
    // per-repost 6% beats the resolved 3% default
    expect(commissions.find((c) => c.affiliateId === 'pub1').commissionAmount).toBe('6.00');
  });

  it('rounds correctly on a fractional sale (€33.33)', async () => {
    const { store, commissions } = makeStore();
    await recordSaleCommissions(store, '33.33', {
      videoId: 'v1',
      creatorId: 'creator1',
      affiliateId: 'pub1',
      campaignAffiliateId: null,
      resolvedCommissionRate: null,
    });
    const creator = commissions.find((c) => c.affiliateId === 'creator1');
    const publisher = commissions.find((c) => c.affiliateId === 'pub1');
    expect(creator.commissionAmount).toBe('2.67'); // round(3333 * 0.08) = 267c
    expect(publisher.commissionAmount).toBe('0.67'); // round(3333 * 0.02) = 67c
  });
});

describe('recordSaleCommissions — DB unique-violation idempotency', () => {
  // Simulate the (external_order_id, affiliate_id) partial unique index rejecting a
  // concurrent retry: createCommissionTransaction throws SQLSTATE 23505.
  function makeDedupStore(failFor: Set<string>) {
    const commissions: any[] = [];
    const statUpdates: any[] = [];
    const store: CommissionStore = {
      async createCommissionTransaction(tx) {
        if (failFor.has(tx.affiliateId)) {
          const err: any = new Error('duplicate key value violates unique constraint');
          err.code = '23505';
          throw err;
        }
        const row = { id: `c${commissions.length + 1}`, ...tx };
        commissions.push(row);
        return row;
      },
      async getCampaignAffiliates() { return []; },
      async updateCampaignAffiliateStats(id, stats) { statUpdates.push({ id, stats }); return stats; },
    };
    return { store, commissions, statUpdates };
  }

  it('swallows a 23505 on the creator row and flags deduped', async () => {
    const { store, commissions } = makeDedupStore(new Set(['creator1']));
    const r = await recordSaleCommissions(store, '100.00', {
      videoId: 'v1', creatorId: 'creator1', affiliateId: null,
      campaignAffiliateId: null, resolvedCommissionRate: null,
      externalOrderId: 'order-1',
    });
    expect(commissions).toHaveLength(0);
    expect(r.deduped).toBe(true);
    expect(r.creatorCommissionId).toBeUndefined();
  });

  it('swallows a 23505 on the publisher row and does NOT bump campaign stats', async () => {
    const ca = { id: 'ca1', totalConversions: 2, totalRevenue: '50.00', totalEarnings: '1.00' };
    const { store, commissions, statUpdates } = makeDedupStore(new Set(['pub1']));
    // Re-point getCampaignAffiliates to return our ca.
    (store as any).getCampaignAffiliates = async () => [ca];
    const r = await recordSaleCommissions(store, '100.00', {
      videoId: 'v1', creatorId: 'creator1', affiliateId: 'pub1',
      campaignAffiliateId: 'ca1', resolvedCommissionRate: null,
      externalOrderId: 'order-2',
    });
    // Creator row still lands; publisher is deduped and stats untouched.
    expect(commissions.map((c) => c.affiliateId)).toEqual(['creator1']);
    expect(r.deduped).toBe(true);
    expect(statUpdates).toHaveLength(0);
  });

  it('re-throws non-unique errors', async () => {
    const store: CommissionStore = {
      async createCommissionTransaction() { throw new Error('connection reset'); },
      async getCampaignAffiliates() { return []; },
      async updateCampaignAffiliateStats(_id, s) { return s; },
    };
    await expect(recordSaleCommissions(store, '100.00', {
      videoId: 'v1', creatorId: 'creator1', affiliateId: null,
      campaignAffiliateId: null, resolvedCommissionRate: null, externalOrderId: 'order-3',
    })).rejects.toThrow(/connection reset/);
  });
});

describe('clawbackSaleCommissions', () => {
  // In-memory ClawbackStore keyed by externalOrderId, mirroring the real storage surface.
  function makeClawbackStore(rows: CommissionRow[], campaignAffiliates: any[] = []) {
    const byId = new Map(rows.map((r) => [r.id, { ...r }]));
    const statUpdates: any[] = [];
    const store: ClawbackStore = {
      async getCommissionsByExternalOrder(externalOrderId) {
        // The test rows carry an `externalOrderId` tag; filter on it.
        return Array.from(byId.values()).filter(
          (r) => (r as any).externalOrderId === externalOrderId,
        );
      },
      async updateCommissionTransactionStatus(id, status) {
        const row = byId.get(id);
        if (row) row.status = status;
        return row;
      },
      async getCampaignAffiliates() {
        return campaignAffiliates;
      },
      async updateCampaignAffiliateStats(id, stats) {
        statUpdates.push({ id, stats });
        return stats;
      },
    };
    return { store, byId, statUpdates };
  }

  const orderRows = (): CommissionRow[] => [
    { id: 'c1', affiliateId: 'creator1', videoId: 'v1', saleAmount: '100.00', commissionAmount: '8.00', status: 'pending', campaignAffiliateId: null, externalOrderId: 'order-1' } as any,
    { id: 'c2', affiliateId: 'pub1', videoId: 'v1', saleAmount: '100.00', commissionAmount: '2.00', status: 'pending', campaignAffiliateId: 'ca1', externalOrderId: 'order-1' } as any,
  ];

  it('reverses both creator + publisher rows for a refunded order', async () => {
    const { store, byId } = makeClawbackStore(orderRows());
    const r = await clawbackSaleCommissions(store, 'order-1');
    expect(r.reversed).toBe(2);
    expect(r.alreadyReversed).toBe(false);
    expect(byId.get('c1')!.status).toBe('reversed');
    expect(byId.get('c2')!.status).toBe('reversed');
  });

  it('decrements campaign-affiliate stats symmetric to the sale (once)', async () => {
    const ca = { id: 'ca1', totalConversions: 3, totalRevenue: '150.00', totalEarnings: '3.00' };
    const { store, statUpdates } = makeClawbackStore(orderRows(), [ca]);
    await clawbackSaleCommissions(store, 'order-1');
    // Only the publisher (campaign-attributed) row updates stats.
    expect(statUpdates).toHaveLength(1);
    expect(statUpdates[0].id).toBe('ca1');
    expect(statUpdates[0].stats.totalConversions).toBe(2);       // 3 - 1
    expect(statUpdates[0].stats.totalRevenue).toBe('50.00');     // 150 - 100
    expect(statUpdates[0].stats.totalEarnings).toBe('1.00');     // 3.00 - 2.00
  });

  it('is idempotent: a retried refund webhook is a no-op', async () => {
    const ca = { id: 'ca1', totalConversions: 3, totalRevenue: '150.00', totalEarnings: '3.00' };
    const { store, statUpdates } = makeClawbackStore(orderRows(), [ca]);
    const first = await clawbackSaleCommissions(store, 'order-1');
    expect(first.reversed).toBe(2);
    const second = await clawbackSaleCommissions(store, 'order-1');
    expect(second.reversed).toBe(0);
    expect(second.alreadyReversed).toBe(true);
    // Stats were decremented exactly once across both deliveries.
    expect(statUpdates).toHaveLength(1);
  });

  it('acks an unknown / unattributed order as a no-op without error', async () => {
    const { store } = makeClawbackStore(orderRows());
    const r = await clawbackSaleCommissions(store, 'no-such-order');
    expect(r.reversed).toBe(0);
    expect(r.alreadyReversed).toBe(false);
  });

  it('still reverses an already-paid row (v1 policy) without crashing', async () => {
    const rows: CommissionRow[] = [
      { id: 'c1', affiliateId: 'creator1', videoId: 'v1', saleAmount: '100.00', commissionAmount: '8.00', status: 'paid', campaignAffiliateId: null, externalOrderId: 'order-1' } as any,
    ];
    const { store, byId } = makeClawbackStore(rows);
    const r = await clawbackSaleCommissions(store, 'order-1');
    expect(r.reversed).toBe(1);
    expect(byId.get('c1')!.status).toBe('reversed');
  });

  it('does not decrement campaign stats below zero on stale rollups', async () => {
    const ca = { id: 'ca1', totalConversions: 0, totalRevenue: '0.00', totalEarnings: '0.00' };
    const rows: CommissionRow[] = [
      { id: 'c2', affiliateId: 'pub1', videoId: 'v1', saleAmount: '100.00', commissionAmount: '2.00', status: 'pending', campaignAffiliateId: 'ca1', externalOrderId: 'order-1' } as any,
    ];
    const { store, statUpdates } = makeClawbackStore(rows, [ca]);
    await clawbackSaleCommissions(store, 'order-1');
    expect(statUpdates[0].stats.totalConversions).toBe(0);
    expect(statUpdates[0].stats.totalRevenue).toBe('0.00');
    expect(statUpdates[0].stats.totalEarnings).toBe('0.00');
  });
});
