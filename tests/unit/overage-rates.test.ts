/**
 * The overage price, in one place.
 *
 * The product previously quoted TWO different prices on two different screens:
 * the settings pages used $0.05/view + $0.15/min, while the brand dashboard
 * used $0.008/min with minutes derived as views x publishers. On 10,000 views
 * across 10 publishers that is $5,000 versus $800 for the same usage.
 *
 * The client confirmed $0.05 + $0.15 on 29 Jul 2026. These tests pin the rates
 * and the shape of the formula so a future edit to one screen cannot silently
 * reintroduce a second price.
 */
import { describe, it, expect } from 'vitest';
import { OVERAGE_RATES, estimateOverage } from '../../shared/plans';

describe('overage rates', () => {
  it('is $0.05 per view and $0.15 per minute', () => {
    expect(OVERAGE_RATES.perView).toBe(0.05);
    expect(OVERAGE_RATES.perMinute).toBe(0.15);
  });

  it('is NOT the retired $0.008/min model', () => {
    expect(OVERAGE_RATES.perMinute).not.toBe(0.008);
    expect(OVERAGE_RATES.perView).not.toBe(0.008);
  });
});

describe('estimateOverage', () => {
  it('multiplies BOTH rates by the publisher count', () => {
    // 10,000 views x $0.05 x 10 = $5,000 ; 60 min x $0.15 x 10 = $90
    expect(estimateOverage(10_000, 60, 10)).toBeCloseTo(5_090, 6);
  });

  it('a single publisher is the un-multiplied base', () => {
    expect(estimateOverage(1_000, 100, 1)).toBeCloseTo(1_000 * 0.05 + 100 * 0.15, 6);
  });

  it('scales linearly in publishers — the same view is charged once per publisher', () => {
    const one = estimateOverage(500, 20, 1);
    expect(estimateOverage(500, 20, 4)).toBeCloseTo(one * 4, 6);
  });

  it('is zero with no usage', () => {
    expect(estimateOverage(0, 0, 10)).toBe(0);
  });

  it('reproduces the figure the retired calculator disagreed with', () => {
    // The old dashboard said $800 for this; the correct model says $5,000.
    expect(estimateOverage(10_000, 0, 10)).toBe(5_000);
  });
});
