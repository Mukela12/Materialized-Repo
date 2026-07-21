import { describe, it, expect, beforeEach } from 'vitest';
import { recordSaleCommissions, type CommissionStore } from '../../server/commissions';

beforeEach(() => {
  delete process.env.MARKETPLACE_FEE_PCT;
  delete process.env.CREATOR_COMMISSION_PCT;
  delete process.env.PUBLISHER_COMMISSION_PCT;
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
