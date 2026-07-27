import { describe, it, expect, beforeEach } from 'vitest';
import {
  getFeeConfig,
  toCents,
  centsToAmount,
  computeSaleSplit,
  feeConfigWarning,
} from '../../server/feeConfig';

// Ensure a clean, deterministic default config regardless of the host env.
beforeEach(() => {
  delete process.env.MARKETPLACE_FEE_PCT;
  delete process.env.CREATOR_COMMISSION_PCT;
  delete process.env.PUBLISHER_COMMISSION_PCT;
});

describe('getFeeConfig', () => {
  it('defaults to 15 / 0 / 2 (creator paid by the brand directly, not via MTRLZD)', () => {
    expect(getFeeConfig()).toEqual({ marketplaceFeePct: 15, creatorPct: 0, publisherPct: 2 });
  });

  it('reads overrides from env', () => {
    process.env.MARKETPLACE_FEE_PCT = '20';
    process.env.CREATOR_COMMISSION_PCT = '10';
    process.env.PUBLISHER_COMMISSION_PCT = '3';
    expect(getFeeConfig()).toEqual({ marketplaceFeePct: 20, creatorPct: 10, publisherPct: 3 });
  });

  it('ignores non-numeric env values', () => {
    process.env.MARKETPLACE_FEE_PCT = 'oops';
    expect(getFeeConfig().marketplaceFeePct).toBe(15);
  });
});

describe('money helpers', () => {
  it('toCents rounds to the nearest cent and is float-safe', () => {
    expect(toCents('100.00')).toBe(10000);
    expect(toCents('19.99')).toBe(1999);
    expect(toCents(19.99)).toBe(1999);
    expect(toCents('0.1')).toBe(10);
    expect(toCents(0.1 + 0.2)).toBe(30); // 0.30000000000000004 → 30
    expect(toCents('not-a-number')).toBe(0);
  });

  it('centsToAmount renders fixed(2) strings', () => {
    expect(centsToAmount(10000)).toBe('100.00');
    expect(centsToAmount(1999)).toBe('19.99');
    expect(centsToAmount(5)).toBe('0.05');
    expect(centsToAmount(0)).toBe('0.00');
  });
});

describe('computeSaleSplit — defaults', () => {
  it('splits a $100 publisher sale into 85 / 0 / 2 / 13', () => {
    const s = computeSaleSplit(10000, { hasPublisher: true });
    expect(s.brandCents).toBe(8500);
    expect(s.marketplaceFeeCents).toBe(1500);
    expect(s.creatorCents).toBe(0);
    expect(s.publisherCents).toBe(200);
    expect(s.platformCents).toBe(1300);
    expect(s.effectiveRates).toEqual({ marketplaceFeePct: 15, creatorPct: 0, publisherPct: 2 });
  });

  it('gives the publisher 0 when none is attributed (platform keeps it)', () => {
    const s = computeSaleSplit(10000, { hasPublisher: false });
    expect(s.brandCents).toBe(8500);
    expect(s.creatorCents).toBe(0);
    expect(s.publisherCents).toBe(0);
    expect(s.platformCents).toBe(1500); // whole fee: creator 0 by default, no publisher
    expect(s.effectiveRates.publisherPct).toBe(0);
  });

  // The creator share is 0 by platform default but fully supported when set.
  it('still pays the creator when an explicit rate is supplied', () => {
    const s = computeSaleSplit(10000, { hasPublisher: true, creatorPct: 8 });
    expect(s.creatorCents).toBe(800);
    expect(s.publisherCents).toBe(200);
    expect(s.platformCents).toBe(500);
    expect(s.effectiveRates.creatorPct).toBe(8);
  });
});

describe('computeSaleSplit — conservation & rounding', () => {
  const amounts = [0, 1, 33, 99, 100, 3333, 999, 1234567, 100003, 7, 250];
  for (const hasPublisher of [true, false]) {
    for (const sale of amounts) {
      it(`conserves every cent (sale=${sale}, hasPublisher=${hasPublisher})`, () => {
        const s = computeSaleSplit(sale, { hasPublisher });
        // Brand + fee reconstitute the sale exactly.
        expect(s.brandCents + s.marketplaceFeeCents).toBe(s.saleCents);
        // Creator + publisher + platform reconstitute the fee exactly.
        expect(s.creatorCents + s.publisherCents + s.platformCents).toBe(s.marketplaceFeeCents);
        // No party ever goes negative.
        for (const v of [s.brandCents, s.marketplaceFeeCents, s.creatorCents, s.publisherCents, s.platformCents]) {
          expect(v).toBeGreaterThanOrEqual(0);
        }
      });
    }
  }

  it('handles a fractional-cent fee deterministically ($33.33)', () => {
    const s = computeSaleSplit(3333, { hasPublisher: true, creatorPct: 8 });
    expect(s.marketplaceFeeCents).toBe(500); // round(3333*0.15)=round(499.95)
    expect(s.brandCents).toBe(2833);
    expect(s.creatorCents).toBe(267);        // round(266.64)
    expect(s.publisherCents).toBe(67);       // round(66.66)
    expect(s.platformCents).toBe(166);       // remainder absorbs rounding
  });
});

// These pin creatorPct: 8 explicitly — they verify clamping BEHAVIOUR against a
// creator share, which is independent of the platform default (now 0).
describe('computeSaleSplit — overrides & clamping', () => {
  it('applies an admin per-repost publisher override', () => {
    const s = computeSaleSplit(10000, { hasPublisher: true, publisherPct: 5, creatorPct: 8 });
    expect(s.publisherCents).toBe(500);
    expect(s.creatorCents).toBe(800);
    expect(s.platformCents).toBe(200); // 1500 − 800 − 500
    expect(s.effectiveRates.publisherPct).toBe(5);
  });

  it('supports a custom marketplace fee', () => {
    const s = computeSaleSplit(10000, { hasPublisher: true, marketplaceFeePct: 30, creatorPct: 8 });
    expect(s.marketplaceFeeCents).toBe(3000);
    expect(s.brandCents).toBe(7000);
    expect(s.platformCents).toBe(3000 - 800 - 200);
  });

  it('caps total commission at the marketplace fee — publisher reduced first', () => {
    const s = computeSaleSplit(10000, { hasPublisher: true, publisherPct: 20, creatorPct: 8 });
    // publisher clamped to the 15% fee, creator then clamped to 0
    expect(s.effectiveRates.publisherPct).toBe(15);
    expect(s.effectiveRates.creatorPct).toBe(0);
    expect(s.platformCents).toBeGreaterThanOrEqual(0);
    expect(s.creatorCents + s.publisherCents + s.platformCents).toBe(s.marketplaceFeeCents);
  });

  it('caps a raised publisher rate against the creator share', () => {
    const s = computeSaleSplit(10000, { hasPublisher: true, publisherPct: 8, creatorPct: 8 });
    // 8 (pub) + 8 (creator) = 16 > 15 → creator trimmed to 7
    expect(s.effectiveRates.publisherPct).toBe(8);
    expect(s.effectiveRates.creatorPct).toBe(7);
    expect(s.platformCents).toBe(0);
  });
});

describe('feeConfigWarning', () => {
  it('is null for a valid config', () => {
    expect(feeConfigWarning({ marketplaceFeePct: 15, creatorPct: 8, publisherPct: 2 })).toBeNull();
  });
  it('warns when creator + publisher exceed the fee', () => {
    expect(feeConfigWarning({ marketplaceFeePct: 10, creatorPct: 8, publisherPct: 5 })).toMatch(/exceeds marketplace fee/);
  });
});
