/**
 * Plan allowances and what a month costs.
 *
 * ── Two things changed here, both on the client's instruction (5 Aug 2026) ────
 *
 * THE VIEW RATE DROPPED TENFOLD, from $0.05 to $0.005. At the old rate a creator
 * on the $149 plan whose video did 100,000 views — the outcome the product
 * exists to produce — was billed $4,649, thirty-one times their subscription,
 * against roughly $230 of delivery cost. A bill nobody can anticipate is a bill
 * that gets disputed rather than paid.
 *
 * THE PUBLISHER MULTIPLIER IS GONE. The old model multiplied both rates by the
 * number of publishers reposting, so one creator's allowance was consumed ten
 * times over by ten reposts. The client settled it: each account has its own
 * allowance and pays for its own usage. The old tests pinned that multiplier
 * explicitly; they are replaced rather than loosened, because the behaviour they
 * described is no longer the intended one.
 *
 * What has NOT changed: these numbers still live in exactly one place. The
 * product once quoted $5,000 on one screen and $800 on another for identical
 * usage, because three copies of the arithmetic had drifted apart.
 */
import { describe, it, expect } from 'vitest';
import {
  OVERAGE_RATES, PLAN_ALLOWANCES, estimateBill, planPriceMajor, PLAN_KEYS,
} from '../../shared/plans';

describe('the rates', () => {
  it('is $0.005 per view, not the $0.05 that produced $4,649 bills', () => {
    expect(OVERAGE_RATES.perView).toBe(0.005);
  });

  it('is $0.15 per uploaded minute', () => {
    expect(OVERAGE_RATES.perMinute).toBe(0.15);
  });
});

describe('the allowances', () => {
  it('covers every plan, so a tier cannot exist without one', () => {
    for (const key of PLAN_KEYS) {
      expect(PLAN_ALLOWANCES[key]).toBeDefined();
      expect(PLAN_ALLOWANCES[key].views).toBeGreaterThan(0);
      expect(PLAN_ALLOWANCES[key].minutes).toBeGreaterThan(0);
    }
  });

  it('includes 10,000 views on every tier, as agreed', () => {
    for (const key of PLAN_KEYS) {
      expect(PLAN_ALLOWANCES[key].views).toBe(10_000);
    }
  });

  it('matches the video counts the client specified', () => {
    expect(PLAN_ALLOWANCES.creator.videos).toBe(8);
    expect(PLAN_ALLOWANCES.starter.videos).toBe(30);  // Brand
    expect(PLAN_ALLOWANCES.pro.videos).toBe(20);      // Publisher: 4 carousels x 5
  });

  it("gives minutes as videos x 2, the client's own arithmetic", () => {
    for (const key of PLAN_KEYS) {
      expect(PLAN_ALLOWANCES[key].minutes).toBe(PLAN_ALLOWANCES[key].videos * 2);
    }
  });
});

describe('estimating a month', () => {
  it('charges NOTHING extra at exactly the allowance', () => {
    // The headline number, and the one most easily got wrong by charging from
    // view one — which would make the subscription price decorative.
    const bill = estimateBill('creator', 10_000, 16);
    expect(bill.overageViews).toBe(0);
    expect(bill.overageMinutes).toBe(0);
    expect(bill.total).toBe(planPriceMajor('creator'));
    expect(bill.total).toBe(149);
  });

  it('charges nothing extra below the allowance either', () => {
    expect(estimateBill('creator', 500, 4).total).toBe(149);
  });

  it('charges only the excess, not the whole usage', () => {
    // 20,000 views = 10,000 over x $0.005 = $50.
    const bill = estimateBill('creator', 20_000, 16);
    expect(bill.overageViews).toBe(10_000);
    expect(bill.viewCost).toBeCloseTo(50, 6);
    expect(bill.total).toBeCloseTo(199, 6);
  });

  it('keeps a viral month survivable — the reason the rate changed', () => {
    // 100,000 views on the $149 plan. At the old $0.05 this was $4,649.
    const bill = estimateBill('creator', 100_000, 16);
    expect(bill.total).toBeCloseTo(599, 6);
    expect(bill.total / planPriceMajor('creator')).toBeLessThan(5);
  });

  it('prices uploaded minutes over the allowance', () => {
    // 40 minutes on creator = 24 over x $0.15 = $3.60.
    const bill = estimateBill('creator', 0, 40);
    expect(bill.overageMinutes).toBe(24);
    expect(bill.minuteCost).toBeCloseTo(3.6, 6);
    expect(bill.total).toBeCloseTo(152.6, 6);
  });

  it('adds both overages together', () => {
    const bill = estimateBill('starter', 30_000, 100);
    expect(bill.overageViews).toBe(20_000);   // 20,000 x 0.005 = $100
    expect(bill.overageMinutes).toBe(40);     // 40 x 0.15 = $6
    expect(bill.total).toBeCloseTo(249 + 100 + 6, 6);
  });

  it('takes no publisher count — reposts do not multiply anyone\'s bill', () => {
    // The old signature was (views, minutes, publishers). It was removed rather
    // than defaulted, so nobody can pass one and quietly get the old model back.
    expect(estimateBill.length).toBe(3); // plan, views, minutes
    expect((estimateBill as any)('creator', 20_000, 16, 10).total)
      .toBeCloseTo(estimateBill('creator', 20_000, 16).total, 6);
  });

  it('rounds to the cent, so no bill shows floating-point noise', () => {
    const bill = estimateBill('creator', 10_001, 17);
    expect(Number.isInteger(Math.round(bill.total * 100))).toBe(true);
    expect(bill.total).toBe(Math.round(bill.total * 100) / 100);
  });

  it('ignores negative usage rather than crediting it', () => {
    const bill = estimateBill('creator', -5_000, -10);
    expect(bill.overageViews).toBe(0);
    expect(bill.overageMinutes).toBe(0);
    expect(bill.total).toBe(149);
  });

  it('prices every tier off its own plan price and allowance', () => {
    for (const key of PLAN_KEYS) {
      const bill = estimateBill(key, PLAN_ALLOWANCES[key].views, PLAN_ALLOWANCES[key].minutes);
      expect(bill.total).toBe(planPriceMajor(key));
    }
  });
});
