import { describe, it, expect, vi, beforeEach } from 'vitest';
import Stripe from 'stripe';

vi.mock('../../server/stripeClient', () => ({
  getUncachableStripeClient: vi.fn(),
}));

import { StripeService } from '../../server/stripeService';
import {
  mapStripeStatus,
  subscriptionPeriodEnd,
  extractCustomerId,
  extractSubscriptionId,
  PLAN_AMOUNT_FALLBACK,
} from '../../server/webhookHandlers';
import { getUncachableStripeClient } from '../../server/stripeClient';

const mockStripe = {
  products: {
    list: vi.fn(),
    create: vi.fn(),
  },
  prices: {
    list: vi.fn(),
    create: vi.fn(),
  },
  checkout: {
    sessions: {
      create: vi.fn(),
    },
  },
  customers: {
    create: vi.fn(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  (getUncachableStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockStripe);
});

describe('StripeService.findOrCreateSubscriptionPrice', () => {
  const service = new StripeService();

  it('returns existing price ID when a matching starter price already exists', async () => {
    mockStripe.products.list.mockResolvedValue({
      data: [{ id: 'prod_starter', metadata: { plan: 'starter' } }],
    });
    mockStripe.prices.list.mockResolvedValue({
      data: [
        {
          id: 'price_existing_starter',
          unit_amount: 24900,
          currency: 'eur',
          recurring: { interval: 'month' },
        },
      ],
    });

    const priceId = await service.findOrCreateSubscriptionPrice('starter');

    expect(priceId).toBe('price_existing_starter');
    expect(mockStripe.prices.create).not.toHaveBeenCalled();
    expect(mockStripe.products.create).not.toHaveBeenCalled();
  });

  it('returns existing price ID when a matching pro price already exists', async () => {
    mockStripe.products.list.mockResolvedValue({
      data: [{ id: 'prod_pro', metadata: { plan: 'pro' } }],
    });
    mockStripe.prices.list.mockResolvedValue({
      data: [
        {
          id: 'price_existing_pro',
          unit_amount: 49900,
          currency: 'eur',
          recurring: { interval: 'month' },
        },
      ],
    });

    const priceId = await service.findOrCreateSubscriptionPrice('pro');

    expect(priceId).toBe('price_existing_pro');
    expect(mockStripe.prices.create).not.toHaveBeenCalled();
  });

  it('creates a new starter product and price when none exists', async () => {
    mockStripe.products.list.mockResolvedValue({ data: [] });
    mockStripe.products.create.mockResolvedValue({
      id: 'prod_new_starter',
      metadata: { plan: 'starter' },
    });
    mockStripe.prices.list.mockResolvedValue({ data: [] });
    mockStripe.prices.create.mockResolvedValue({ id: 'price_new_starter' });

    const priceId = await service.findOrCreateSubscriptionPrice('starter');

    expect(priceId).toBe('price_new_starter');

    expect(mockStripe.products.create).toHaveBeenCalledWith({
      name: 'Materialized Starter Plan',
      metadata: { plan: 'starter' },
    });

    expect(mockStripe.prices.create).toHaveBeenCalledWith({
      product: 'prod_new_starter',
      unit_amount: 24900,
      currency: 'eur',
      recurring: { interval: 'month' },
      metadata: { plan: 'starter' },
    });
  });

  it('creates a new pro product and price with correct amount (49900 EUR cents)', async () => {
    mockStripe.products.list.mockResolvedValue({ data: [] });
    mockStripe.products.create.mockResolvedValue({
      id: 'prod_new_pro',
      metadata: { plan: 'pro' },
    });
    mockStripe.prices.list.mockResolvedValue({ data: [] });
    mockStripe.prices.create.mockResolvedValue({ id: 'price_new_pro' });

    const priceId = await service.findOrCreateSubscriptionPrice('pro');

    expect(priceId).toBe('price_new_pro');

    expect(mockStripe.products.create).toHaveBeenCalledWith({
      name: 'Materialized Pro Plan',
      metadata: { plan: 'pro' },
    });

    expect(mockStripe.prices.create).toHaveBeenCalledWith({
      product: 'prod_new_pro',
      unit_amount: 49900,
      currency: 'eur',
      recurring: { interval: 'month' },
      metadata: { plan: 'pro' },
    });
  });

  it('skips wrong-amount prices and creates a new one', async () => {
    mockStripe.products.list.mockResolvedValue({
      data: [{ id: 'prod_starter', metadata: { plan: 'starter' } }],
    });
    mockStripe.prices.list.mockResolvedValue({
      data: [
        {
          id: 'price_wrong_amount',
          unit_amount: 9900,
          currency: 'eur',
          recurring: { interval: 'month' },
        },
      ],
    });
    mockStripe.prices.create.mockResolvedValue({ id: 'price_correct_starter' });

    const priceId = await service.findOrCreateSubscriptionPrice('starter');

    expect(priceId).toBe('price_correct_starter');
    expect(mockStripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({ unit_amount: 24900 })
    );
  });

  it('skips wrong-currency prices and creates a new EUR one', async () => {
    mockStripe.products.list.mockResolvedValue({
      data: [{ id: 'prod_starter', metadata: { plan: 'starter' } }],
    });
    mockStripe.prices.list.mockResolvedValue({
      data: [
        {
          id: 'price_usd',
          unit_amount: 24900,
          currency: 'usd',
          recurring: { interval: 'month' },
        },
      ],
    });
    mockStripe.prices.create.mockResolvedValue({ id: 'price_eur_starter' });

    const priceId = await service.findOrCreateSubscriptionPrice('starter');

    expect(priceId).toBe('price_eur_starter');
    expect(mockStripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'eur' })
    );
  });

  it('reuses an existing product and creates a new price when price list is empty', async () => {
    mockStripe.products.list.mockResolvedValue({
      data: [{ id: 'prod_existing_pro', metadata: { plan: 'pro' } }],
    });
    mockStripe.prices.list.mockResolvedValue({ data: [] });
    mockStripe.prices.create.mockResolvedValue({ id: 'price_pro_new' });

    const priceId = await service.findOrCreateSubscriptionPrice('pro');

    expect(priceId).toBe('price_pro_new');
    expect(mockStripe.products.create).not.toHaveBeenCalled();
    expect(mockStripe.prices.create).toHaveBeenCalledOnce();
  });
});

describe('StripeService.createSubscriptionCheckout', () => {
  const service = new StripeService();

  it('calls createSubscriptionCheckout with correct plan metadata', async () => {
    mockStripe.products.list.mockResolvedValue({
      data: [{ id: 'prod_starter', metadata: { plan: 'starter' } }],
    });
    mockStripe.prices.list.mockResolvedValue({
      data: [{ id: 'price_starter', unit_amount: 24900, currency: 'eur', recurring: { interval: 'month' } }],
    });
    mockStripe.checkout.sessions.create.mockResolvedValue({
      id: 'cs_test',
      url: 'https://checkout.stripe.com/pay/cs_test',
    });

    const result = await service.createSubscriptionCheckout(
      'cus_test',
      'starter',
      'https://example.com/success',
      'https://example.com/cancel',
      { userId: 'user_test', plan: 'starter' },
    );

    expect(result.url).toBe('https://checkout.stripe.com/pay/cs_test');
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_test',
        mode: 'subscription',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        metadata: { userId: 'user_test', plan: 'starter' },
      })
    );
  });

  it('calls createSubscriptionCheckout with pro plan price (49900)', async () => {
    mockStripe.products.list.mockResolvedValue({
      data: [{ id: 'prod_pro', metadata: { plan: 'pro' } }],
    });
    mockStripe.prices.list.mockResolvedValue({
      data: [{ id: 'price_pro', unit_amount: 49900, currency: 'eur', recurring: { interval: 'month' } }],
    });
    mockStripe.checkout.sessions.create.mockResolvedValue({
      id: 'cs_pro_test',
      url: 'https://checkout.stripe.com/pay/cs_pro',
    });

    const result = await service.createSubscriptionCheckout(
      'cus_test',
      'pro',
      'https://example.com/brand/settings/subscription?checkout=success',
      'https://example.com/brand/settings/subscription?checkout=cancelled',
      { userId: 'user_test', plan: 'pro' },
    );

    expect(result.url).toContain('cs_pro');
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_pro', quantity: 1 }],
        mode: 'subscription',
      })
    );
  });
});

describe('StripeService.createCustomer', () => {
  const service = new StripeService();

  it('creates a Stripe customer with email and userId metadata', async () => {
    mockStripe.customers.create.mockResolvedValue({
      id: 'cus_new_123',
      email: 'test@example.com',
    });

    const customer = await service.createCustomer('test@example.com', 'user_abc123', 'Test User');

    expect(customer.id).toBe('cus_new_123');
    expect(mockStripe.customers.create).toHaveBeenCalledWith({
      email: 'test@example.com',
      name: 'Test User',
      metadata: { userId: 'user_abc123' },
    });
  });
});

describe('mapStripeStatus — imported from webhookHandlers', () => {
  it('maps "active" → "active"', () => {
    expect(mapStripeStatus('active')).toBe('active');
  });

  it('maps "trialing" → "active"', () => {
    expect(mapStripeStatus('trialing')).toBe('active');
  });

  it('maps "past_due" → "past_due"', () => {
    expect(mapStripeStatus('past_due')).toBe('past_due');
  });

  it('maps "unpaid" → "past_due"', () => {
    expect(mapStripeStatus('unpaid')).toBe('past_due');
  });

  it('maps "canceled" → "cancelled" (Stripe uses US spelling, DB uses UK)', () => {
    expect(mapStripeStatus('canceled')).toBe('cancelled');
  });

  it('maps "incomplete_expired" → "cancelled"', () => {
    expect(mapStripeStatus('incomplete_expired')).toBe('cancelled');
  });

  it('maps unknown status → "cancelled" (default branch)', () => {
    expect(mapStripeStatus('some_future_stripe_status')).toBe('cancelled');
  });
});

describe('PLAN_AMOUNT_FALLBACK — imported from webhookHandlers', () => {
  it('maps 24900 cents → starter (€249/mo)', () => {
    expect(PLAN_AMOUNT_FALLBACK[24900]).toBe('starter');
  });

  it('maps 49900 cents → pro (€499/mo)', () => {
    expect(PLAN_AMOUNT_FALLBACK[49900]).toBe('pro');
  });

  it('unknown amount is undefined (handler defaults to starter)', () => {
    expect(PLAN_AMOUNT_FALLBACK[99999]).toBeUndefined();
  });
});

describe('extractCustomerId — imported from webhookHandlers', () => {
  it('returns string customer ID directly', () => {
    expect(extractCustomerId('cus_abc123')).toBe('cus_abc123');
  });

  it('returns .id when customer is an expanded Stripe object', () => {
    const customer = { id: 'cus_expanded' } as Stripe.Customer;
    expect(extractCustomerId(customer)).toBe('cus_expanded');
  });

  it('returns null for null input', () => {
    expect(extractCustomerId(null)).toBeNull();
  });
});

describe('extractSubscriptionId — imported from webhookHandlers', () => {
  it('returns string subscription ID directly', () => {
    expect(extractSubscriptionId('sub_abc123')).toBe('sub_abc123');
  });

  it('returns .id when subscription is an expanded object', () => {
    const sub = { id: 'sub_expanded' } as Stripe.Subscription;
    expect(extractSubscriptionId(sub)).toBe('sub_expanded');
  });

  it('returns null for null input', () => {
    expect(extractSubscriptionId(null)).toBeNull();
  });
});

describe('subscriptionPeriodEnd — imported from webhookHandlers', () => {
  it('converts Unix timestamp (seconds) to Date correctly', () => {
    const subscription = {
      items: {
        data: [{ current_period_end: 1800000000 }],
      },
    } as unknown as Stripe.Subscription;

    const result = subscriptionPeriodEnd(subscription);
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(1800000000 * 1000);
  });

  it('returns epoch date when current_period_end is 0', () => {
    const subscription = {
      items: { data: [{ current_period_end: 0 }] },
    } as unknown as Stripe.Subscription;

    const result = subscriptionPeriodEnd(subscription);
    expect(result.getTime()).toBe(0);
  });

  it('produces a future date for typical upcoming billing', () => {
    const thirtyDaysFromNow = Math.floor(Date.now() / 1000) + 30 * 86400;
    const subscription = {
      items: { data: [{ current_period_end: thirtyDaysFromNow }] },
    } as unknown as Stripe.Subscription;

    const result = subscriptionPeriodEnd(subscription);
    expect(result.getTime()).toBeGreaterThan(Date.now());
  });
});
