import { describe, it, expect, beforeEach } from 'vitest';
import { resolveFeeConfig, userRateOr, numOr } from '../../server/feeConfig';

beforeEach(() => {
  delete process.env.MARKETPLACE_FEE_PCT;
  delete process.env.CREATOR_COMMISSION_PCT;
  delete process.env.PUBLISHER_COMMISSION_PCT;
});

describe('numOr', () => {
  it('accepts numbers and numeric strings, rejects the rest', () => {
    expect(numOr(5, 1)).toBe(5);
    expect(numOr('5.00', 1)).toBe(5);
    expect(numOr(0, 1)).toBe(0);
    expect(numOr(null, 1)).toBe(1);
    expect(numOr(undefined, 1)).toBe(1);
    expect(numOr('', 1)).toBe(1);
    expect(numOr('abc', 1)).toBe(1);
    expect(numOr(-2, 1)).toBe(1); // negative rejected
  });
});

describe('resolveFeeConfig', () => {
  it('uses env defaults (15/8/2) with no settings', () => {
    expect(resolveFeeConfig(null)).toEqual({ marketplaceFeePct: 15, creatorPct: 8, publisherPct: 2 });
    expect(resolveFeeConfig(undefined)).toEqual({ marketplaceFeePct: 15, creatorPct: 8, publisherPct: 2 });
  });

  it('layers admin DB settings (decimal strings) over defaults', () => {
    expect(resolveFeeConfig({ marketplaceFeePct: '20.00', creatorPct: '10.00', publisherPct: '3.00' }))
      .toEqual({ marketplaceFeePct: 20, creatorPct: 10, publisherPct: 3 });
  });

  it('falls back per-field when a setting is null/blank', () => {
    expect(resolveFeeConfig({ marketplaceFeePct: '18.00', creatorPct: null, publisherPct: undefined }))
      .toEqual({ marketplaceFeePct: 18, creatorPct: 8, publisherPct: 2 });
  });
});

describe('userRateOr', () => {
  it('uses the override when present, else the fallback', () => {
    expect(userRateOr('5.00', 8)).toBe(5);
    expect(userRateOr(0, 8)).toBe(0);
    expect(userRateOr(null, 8)).toBe(8);
    expect(userRateOr(undefined, 8)).toBe(8);
    expect(userRateOr('', 8)).toBe(8);
  });
});
