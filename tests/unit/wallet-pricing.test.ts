/**
 * Token pricing constants and the fee→tokens conversion.
 *
 * TOKEN_USD and LICENSE_FEE are both 49 today by COINCIDENCE, not by definition:
 * one is what a token is worth, the other is what a listing costs. These tests pin
 * the fact that they are independent, and that a divergence is REFUSED rather than
 * silently rounded — under-charging gives away platform revenue, over-charging
 * takes a creator's credit for nothing.
 */
import { describe, it, expect } from 'vitest';
import {
  TOKEN_USD,
  TOKEN_USD_CENTS,
  LICENSE_FEE,
  LICENSE_FEE_PER_VIDEO,
  tokensForFee,
} from '../../shared/pricing';
import { TOKEN_QUALIFYING_PLANS, PLAN_CONFIG } from '../../shared/plans';

describe('token pricing', () => {
  it('is $49 = 4900 cents, per the client spec', () => {
    expect(TOKEN_USD).toBe(49);
    expect(TOKEN_USD_CENTS).toBe(4900);
  });

  it('quotes one token for a one-video fee', () => {
    expect(tokensForFee(LICENSE_FEE)).toBe(1);
    expect(tokensForFee(LICENSE_FEE_PER_VIDEO)).toBe(1);
    expect(tokensForFee(5 * LICENSE_FEE_PER_VIDEO)).toBe(5);
  });

  it('REFUSES a fee tokens cannot cover exactly, instead of rounding', () => {
    expect(tokensForFee(50)).toBeNull();   // would silently over- or under-charge
    expect(tokensForFee(24.5)).toBeNull();
    expect(tokensForFee(0)).toBeNull();
    expect(tokensForFee(-49)).toBeNull();
  });
});

describe('qualifying plans', () => {
  it('is the $249 Brand tier and nothing else', () => {
    expect(TOKEN_QUALIFYING_PLANS).toEqual(['starter']);
    expect(PLAN_CONFIG.starter.amount).toBe(24900);
  });

  it('excludes the $149 creator and $499 publisher tiers', () => {
    expect(TOKEN_QUALIFYING_PLANS).not.toContain('creator');
    expect(TOKEN_QUALIFYING_PLANS).not.toContain('pro');
  });

  it('mints less than one third of the subscription it rewards', () => {
    // Unit economics sanity check, and a tripwire if either number moves: every
    // conversion mints $49 of platform-funded credit against $249 of revenue.
    expect(TOKEN_USD_CENTS).toBeLessThan(PLAN_CONFIG.starter.amount / 3);
  });
});
