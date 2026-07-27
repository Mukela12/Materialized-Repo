/**
 * Guardrails for the subscription plan catalogue.
 *
 * The failure this file exists to prevent: adding a tier to PLAN_CONFIG without
 * teaching the webhook resolver about it. `planFromSubscription` falls back to a
 * default plan when it can't identify a price, so a missing entry records every
 * subscriber on that tier — correct Stripe billing, wrong tier in the app, no
 * error and (previously) no log. See server/webhookHandlers.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

vi.mock('../../server/stripeClient', () => ({
  getUncachableStripeClient: vi.fn(),
}));

import { PLAN_CONFIG, PLAN_KEYS, isPlanKey, planPriceMajor } from '../../shared/plans';
import {
  PLAN_AMOUNT_FALLBACK,
  DEFAULT_PLAN,
  planFromSubscription,
} from '../../server/webhookHandlers';
import { getUncachableStripeClient } from '../../server/stripeClient';

const mockStripe = { products: { retrieve: vi.fn() } };

beforeEach(() => {
  vi.clearAllMocks();
  (getUncachableStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockStripe);
});

/** Build a subscription whose single item carries the given price. */
function subWithPrice(price: Partial<Stripe.Price>): Stripe.Subscription {
  return { items: { data: [{ price }] } } as unknown as Stripe.Subscription;
}

describe('PLAN_CONFIG — client decision, 27 Jul', () => {
  it('prices Creator at $149/mo', () => {
    expect(PLAN_CONFIG.creator.amount).toBe(14900);
    expect(planPriceMajor('creator')).toBe(149);
  });

  it('prices Brand (key "starter") at $249/mo', () => {
    expect(PLAN_CONFIG.starter.amount).toBe(24900);
    expect(planPriceMajor('starter')).toBe(249);
  });

  it('prices Publisher (key "pro") at $499/mo', () => {
    expect(PLAN_CONFIG.pro.amount).toBe(49900);
    expect(planPriceMajor('pro')).toBe(499);
  });

  it('keeps the legacy keys so existing Stripe metadata and DB rows still resolve', () => {
    // Renaming either key silently downgrades every existing subscriber.
    expect(PLAN_KEYS).toContain('starter');
    expect(PLAN_KEYS).toContain('pro');
  });

  it('has no duplicate amounts — PLAN_AMOUNT_FALLBACK is keyed on amount', () => {
    const amounts = PLAN_KEYS.map((k) => PLAN_CONFIG[k].amount);
    expect(new Set(amounts).size).toBe(amounts.length);
  });
});

describe('isPlanKey', () => {
  it.each(PLAN_KEYS)('accepts %s', (key) => {
    expect(isPlanKey(key)).toBe(true);
  });

  it('rejects unknown strings and non-strings', () => {
    for (const bad of ['enterprise', 'Starter', '', null, undefined, 42, {}]) {
      expect(isPlanKey(bad)).toBe(false);
    }
  });

  it('rejects inherited Object.prototype keys', () => {
    expect(isPlanKey('toString')).toBe(false);
    expect(isPlanKey('constructor')).toBe(false);
  });
});

describe('PLAN_AMOUNT_FALLBACK stays in sync with PLAN_CONFIG', () => {
  it('has an entry for every plan — a gap here is a silent tier misassignment', () => {
    for (const key of PLAN_KEYS) {
      expect(PLAN_AMOUNT_FALLBACK[PLAN_CONFIG[key].amount]).toBe(key);
    }
  });

  it('has no entries beyond the catalogue', () => {
    expect(Object.keys(PLAN_AMOUNT_FALLBACK)).toHaveLength(PLAN_KEYS.length);
  });

  it('leaves unknown amounts undefined', () => {
    expect(PLAN_AMOUNT_FALLBACK[99999]).toBeUndefined();
  });
});

describe('planFromSubscription', () => {
  it('resolves a 14900 price with NO metadata to creator (guards the silent-downgrade bug)', async () => {
    const plan = await planFromSubscription(
      subWithPrice({ id: 'price_x', unit_amount: 14900, product: { id: 'prod_x', metadata: {} } as Stripe.Product }),
    );
    expect(plan).toBe('creator');
  });

  it('resolves 24900 → starter and 49900 → pro by amount alone', async () => {
    const starter = await planFromSubscription(
      subWithPrice({ id: 'p1', unit_amount: 24900, product: { id: 'prod', metadata: {} } as Stripe.Product }),
    );
    const pro = await planFromSubscription(
      subWithPrice({ id: 'p2', unit_amount: 49900, product: { id: 'prod', metadata: {} } as Stripe.Product }),
    );
    expect(starter).toBe('starter');
    expect(pro).toBe('pro');
  });

  it('prefers price metadata over the amount fallback', async () => {
    const plan = await planFromSubscription(
      subWithPrice({ id: 'p', unit_amount: 49900, metadata: { plan: 'creator' } as any }),
    );
    expect(plan).toBe('creator');
  });

  it('falls back to product metadata when the price has none (expanded product)', async () => {
    const plan = await planFromSubscription(
      subWithPrice({
        id: 'p',
        unit_amount: 999,
        product: { id: 'prod', metadata: { plan: 'creator' } } as unknown as Stripe.Product,
      }),
    );
    expect(plan).toBe('creator');
  });

  it('retrieves the product when it is an unexpanded string id', async () => {
    mockStripe.products.retrieve.mockResolvedValue({ id: 'prod', metadata: { plan: 'pro' } });
    const plan = await planFromSubscription(subWithPrice({ id: 'p', unit_amount: 111, product: 'prod' }));
    expect(plan).toBe('pro');
    expect(mockStripe.products.retrieve).toHaveBeenCalledWith('prod');
  });

  it('ignores unrecognised metadata rather than persisting it', async () => {
    const plan = await planFromSubscription(
      subWithPrice({
        id: 'p',
        unit_amount: 24900,
        metadata: { plan: 'enterprise' } as any,
        product: { id: 'prod', metadata: {} } as Stripe.Product,
      }),
    );
    expect(plan).toBe('starter'); // by amount, not the bogus metadata
  });

  it('warns instead of failing silently when nothing resolves', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plan = await planFromSubscription(
      subWithPrice({ id: 'price_mystery', unit_amount: 12345, product: { id: 'p', metadata: {} } as Stripe.Product }),
    );
    expect(plan).toBe(DEFAULT_PLAN);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('price_mystery'));
    warn.mockRestore();
  });

  it('returns the default plan for a subscription with no items', async () => {
    const plan = await planFromSubscription({ items: { data: [] } } as unknown as Stripe.Subscription);
    expect(plan).toBe(DEFAULT_PLAN);
  });
});
