import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

vi.mock('../../server/storage', () => ({
  storage: {
    getUserByStripeCustomerId: vi.fn(),
    getBrandSubscription: vi.fn(),
    upsertBrandSubscription: vi.fn(),
  },
}));

vi.mock('../../server/stripeClient', () => ({
  getUncachableStripeClient: vi.fn().mockResolvedValue({
    subscriptions: {
      retrieve: vi.fn(),
    },
    products: {
      retrieve: vi.fn(),
    },
  }),
}));

import { dispatchStripeEvent } from '../../server/webhookHandlers';
import { storage } from '../../server/storage';
import { getUncachableStripeClient } from '../../server/stripeClient';

const mockStorage = storage as {
  getUserByStripeCustomerId: ReturnType<typeof vi.fn>;
  getBrandSubscription: ReturnType<typeof vi.fn>;
  upsertBrandSubscription: ReturnType<typeof vi.fn>;
};

function makeSubscriptionObject(opts: {
  id?: string;
  customerId?: string;
  status?: string;
  plan?: 'starter' | 'pro';
  periodEnd?: number;
}): Stripe.Subscription {
  const {
    id = 'sub_test123',
    customerId = 'cus_test123',
    status = 'active',
    plan = 'starter',
    periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400,
  } = opts;

  return {
    id,
    object: 'subscription',
    customer: customerId,
    status,
    items: {
      object: 'list',
      data: [
        {
          id: 'si_test',
          object: 'subscription_item',
          current_period_end: periodEnd,
          price: {
            id: 'price_test',
            object: 'price',
            unit_amount: plan === 'starter' ? 24900 : 49900,
            currency: 'eur',
            recurring: { interval: 'month', interval_count: 1 },
            metadata: { plan },
            product: 'prod_test',
          },
        } as unknown as Stripe.SubscriptionItem,
      ],
      has_more: false,
      url: '',
    },
  } as unknown as Stripe.Subscription;
}

function makeInvoiceObject(opts: {
  customerId?: string;
  subscriptionId?: string;
}): Stripe.Invoice {
  const { customerId = 'cus_test123', subscriptionId = 'sub_test123' } = opts;
  return {
    id: 'inv_test123',
    object: 'invoice',
    customer: customerId,
    subscription: subscriptionId,
    status: 'open',
  } as unknown as Stripe.Invoice;
}

function makeCheckoutSession(opts: {
  customerId?: string;
  subscriptionId?: string;
  userId?: string | null;
  plan?: 'starter' | 'pro';
}): Stripe.Checkout.Session {
  const {
    customerId = 'cus_test123',
    subscriptionId = 'sub_test123',
    userId = 'user_test123',
    plan = 'starter',
  } = opts;
  const metadata: Record<string, string> = { plan };
  if (userId != null) metadata.userId = userId;
  return {
    id: 'cs_test123',
    object: 'checkout.session',
    mode: 'subscription',
    customer: customerId,
    subscription: subscriptionId,
    metadata,
  } as unknown as Stripe.Checkout.Session;
}

function makeStripeEvent(type: string, obj: unknown): Stripe.Event {
  return {
    id: `evt_${Date.now()}`,
    object: 'event',
    type,
    data: { object: obj },
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    api_version: '2024-06-20',
  } as unknown as Stripe.Event;
}

async function getSubscriptionsRetrieveMock() {
  const stripe = await (getUncachableStripeClient as ReturnType<typeof vi.fn>)();
  return stripe.subscriptions.retrieve as ReturnType<typeof vi.fn>;
}

beforeEach(async () => {
  vi.clearAllMocks();

  const stripeClientMock = {
    subscriptions: { retrieve: vi.fn() },
    products: { retrieve: vi.fn() },
  };
  (getUncachableStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue(stripeClientMock);

  mockStorage.getUserByStripeCustomerId.mockResolvedValue({
    id: 'user_test123',
    email: 'test@example.com',
  });
  mockStorage.getBrandSubscription.mockResolvedValue({
    userId: 'user_test123',
    plan: 'starter',
    status: 'active',
    stripeSubscriptionId: 'sub_test123',
    currentPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000),
  });
  mockStorage.upsertBrandSubscription.mockResolvedValue({});
});

describe('dispatchStripeEvent — checkout.session.completed', () => {
  it('upserts subscription with status active when checkout completes (starter)', async () => {
    const session = makeCheckoutSession({ plan: 'starter', userId: 'user_test123' });
    const subscription = makeSubscriptionObject({ plan: 'starter', status: 'active' });

    (getUncachableStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription) },
      products: { retrieve: vi.fn() },
    });

    await dispatchStripeEvent(makeStripeEvent('checkout.session.completed', session));

    expect(mockStorage.upsertBrandSubscription).toHaveBeenCalledOnce();
    const call = mockStorage.upsertBrandSubscription.mock.calls[0][0];
    expect(call.status).toBe('active');
    expect(call.plan).toBe('starter');
    expect(call.userId).toBe('user_test123');
  });

  it('upserts subscription with status active when checkout completes (pro)', async () => {
    const session = makeCheckoutSession({ plan: 'pro', userId: 'user_test123' });
    const subscription = makeSubscriptionObject({ plan: 'pro', status: 'active' });

    (getUncachableStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription) },
      products: { retrieve: vi.fn() },
    });

    await dispatchStripeEvent(makeStripeEvent('checkout.session.completed', session));

    expect(mockStorage.upsertBrandSubscription).toHaveBeenCalledOnce();
    const call = mockStorage.upsertBrandSubscription.mock.calls[0][0];
    expect(call.status).toBe('active');
    expect(call.plan).toBe('pro');
  });

  it('skips non-subscription checkout sessions (mode !== subscription)', async () => {
    const session = { ...makeCheckoutSession({}), mode: 'payment' };

    await dispatchStripeEvent(makeStripeEvent('checkout.session.completed', session));

    expect(mockStorage.upsertBrandSubscription).not.toHaveBeenCalled();
  });

  it('skips when no customerId in session', async () => {
    const session = { ...makeCheckoutSession({}), customer: null };

    await dispatchStripeEvent(makeStripeEvent('checkout.session.completed', session));

    expect(mockStorage.upsertBrandSubscription).not.toHaveBeenCalled();
  });

  it('resolves userId via stripe customer lookup when not in metadata', async () => {
    const session = makeCheckoutSession({ userId: null });
    Object.assign(session, { metadata: {} });
    const subscription = makeSubscriptionObject({ status: 'active' });

    (getUncachableStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription) },
      products: { retrieve: vi.fn() },
    });

    await dispatchStripeEvent(makeStripeEvent('checkout.session.completed', session));

    expect(mockStorage.getUserByStripeCustomerId).toHaveBeenCalledWith('cus_test123');
    expect(mockStorage.upsertBrandSubscription).toHaveBeenCalledOnce();
  });

  it('falls back to amount-based plan detection when metadata.plan is missing', async () => {
    const session = makeCheckoutSession({ userId: 'user_test123' });
    Object.assign(session, { metadata: { userId: 'user_test123' } });

    const subscription = makeSubscriptionObject({ status: 'active' });
    Object.assign(subscription.items.data[0].price, { metadata: {}, unit_amount: 49900 });

    (getUncachableStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription) },
      products: { retrieve: vi.fn() },
    });

    await dispatchStripeEvent(makeStripeEvent('checkout.session.completed', session));

    const call = mockStorage.upsertBrandSubscription.mock.calls[0][0];
    expect(call.plan).toBe('pro');
  });
});

describe('dispatchStripeEvent — customer.subscription.updated', () => {
  it('maps Stripe active → DB active', async () => {
    const subscription = makeSubscriptionObject({ status: 'active', plan: 'pro' });
    const fullSub = makeSubscriptionObject({ status: 'active', plan: 'pro' });

    (getUncachableStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      subscriptions: { retrieve: vi.fn().mockResolvedValue(fullSub) },
      products: { retrieve: vi.fn() },
    });

    await dispatchStripeEvent(makeStripeEvent('customer.subscription.updated', subscription));

    const call = mockStorage.upsertBrandSubscription.mock.calls[0][0];
    expect(call.status).toBe('active');
    expect(call.plan).toBe('pro');
  });

  it('maps Stripe trialing → DB active', async () => {
    const subscription = makeSubscriptionObject({ status: 'trialing', plan: 'starter' });
    const fullSub = makeSubscriptionObject({ status: 'trialing', plan: 'starter' });

    (getUncachableStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      subscriptions: { retrieve: vi.fn().mockResolvedValue(fullSub) },
      products: { retrieve: vi.fn() },
    });

    await dispatchStripeEvent(makeStripeEvent('customer.subscription.updated', subscription));

    const call = mockStorage.upsertBrandSubscription.mock.calls[0][0];
    expect(call.status).toBe('active');
  });

  it('maps Stripe past_due → DB past_due', async () => {
    const subscription = makeSubscriptionObject({ status: 'past_due' });
    const fullSub = makeSubscriptionObject({ status: 'past_due' });

    (getUncachableStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      subscriptions: { retrieve: vi.fn().mockResolvedValue(fullSub) },
      products: { retrieve: vi.fn() },
    });

    await dispatchStripeEvent(makeStripeEvent('customer.subscription.updated', subscription));

    const call = mockStorage.upsertBrandSubscription.mock.calls[0][0];
    expect(call.status).toBe('past_due');
  });

  it('maps Stripe unpaid → DB past_due', async () => {
    const subscription = makeSubscriptionObject({ status: 'unpaid' });
    const fullSub = makeSubscriptionObject({ status: 'unpaid' });

    (getUncachableStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      subscriptions: { retrieve: vi.fn().mockResolvedValue(fullSub) },
      products: { retrieve: vi.fn() },
    });

    await dispatchStripeEvent(makeStripeEvent('customer.subscription.updated', subscription));

    const call = mockStorage.upsertBrandSubscription.mock.calls[0][0];
    expect(call.status).toBe('past_due');
  });

  it('maps Stripe canceled → DB cancelled', async () => {
    const subscription = makeSubscriptionObject({ status: 'canceled' });
    const fullSub = makeSubscriptionObject({ status: 'canceled' });

    (getUncachableStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      subscriptions: { retrieve: vi.fn().mockResolvedValue(fullSub) },
      products: { retrieve: vi.fn() },
    });

    await dispatchStripeEvent(makeStripeEvent('customer.subscription.updated', subscription));

    const call = mockStorage.upsertBrandSubscription.mock.calls[0][0];
    expect(call.status).toBe('cancelled');
  });

  it('maps Stripe incomplete_expired → DB cancelled (default)', async () => {
    const subscription = makeSubscriptionObject({ status: 'incomplete_expired' });
    const fullSub = makeSubscriptionObject({ status: 'incomplete_expired' });

    (getUncachableStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      subscriptions: { retrieve: vi.fn().mockResolvedValue(fullSub) },
      products: { retrieve: vi.fn() },
    });

    await dispatchStripeEvent(makeStripeEvent('customer.subscription.updated', subscription));

    const call = mockStorage.upsertBrandSubscription.mock.calls[0][0];
    expect(call.status).toBe('cancelled');
  });

  it('skips when no user found for customer', async () => {
    mockStorage.getUserByStripeCustomerId.mockResolvedValue(null);
    const subscription = makeSubscriptionObject({ status: 'active' });

    await dispatchStripeEvent(makeStripeEvent('customer.subscription.updated', subscription));

    expect(mockStorage.upsertBrandSubscription).not.toHaveBeenCalled();
  });
});

describe('dispatchStripeEvent — customer.subscription.deleted', () => {
  it('sets status to cancelled and preserves existing plan', async () => {
    mockStorage.getBrandSubscription.mockResolvedValue({
      userId: 'user_test123',
      plan: 'pro',
      status: 'active',
      stripeSubscriptionId: 'sub_test123',
    });

    const subscription = makeSubscriptionObject({ status: 'canceled', id: 'sub_test123' });
    await dispatchStripeEvent(makeStripeEvent('customer.subscription.deleted', subscription));

    const call = mockStorage.upsertBrandSubscription.mock.calls[0][0];
    expect(call.status).toBe('cancelled');
    expect(call.plan).toBe('pro');
    expect(call.userId).toBe('user_test123');
  });

  it('defaults plan to starter when no existing subscription found', async () => {
    mockStorage.getBrandSubscription.mockResolvedValue(null);
    const subscription = makeSubscriptionObject({ status: 'canceled' });

    await dispatchStripeEvent(makeStripeEvent('customer.subscription.deleted', subscription));

    const call = mockStorage.upsertBrandSubscription.mock.calls[0][0];
    expect(call.status).toBe('cancelled');
    expect(call.plan).toBe('starter');
  });

  it('skips when no user found for customer', async () => {
    mockStorage.getUserByStripeCustomerId.mockResolvedValue(null);
    const subscription = makeSubscriptionObject({ status: 'canceled' });

    await dispatchStripeEvent(makeStripeEvent('customer.subscription.deleted', subscription));

    expect(mockStorage.upsertBrandSubscription).not.toHaveBeenCalled();
  });
});

describe('dispatchStripeEvent — invoice.payment_succeeded', () => {
  it('sets status to active and updates period end', async () => {
    const invoice = makeInvoiceObject({});
    const subscription = makeSubscriptionObject({ plan: 'pro', status: 'active' });

    (getUncachableStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription) },
      products: { retrieve: vi.fn() },
    });

    await dispatchStripeEvent(makeStripeEvent('invoice.payment_succeeded', invoice));

    const call = mockStorage.upsertBrandSubscription.mock.calls[0][0];
    expect(call.status).toBe('active');
    expect(call.userId).toBe('user_test123');
    expect(call.currentPeriodEnd).toBeInstanceOf(Date);
  });

  it('skips when invoice has no subscription ID', async () => {
    const invoice = { ...makeInvoiceObject({}), subscription: null };

    await dispatchStripeEvent(makeStripeEvent('invoice.payment_succeeded', invoice));

    expect(mockStorage.upsertBrandSubscription).not.toHaveBeenCalled();
  });

  it('skips when no user found for customer', async () => {
    mockStorage.getUserByStripeCustomerId.mockResolvedValue(null);
    const invoice = makeInvoiceObject({});

    await dispatchStripeEvent(makeStripeEvent('invoice.payment_succeeded', invoice));

    expect(mockStorage.upsertBrandSubscription).not.toHaveBeenCalled();
  });
});

describe('dispatchStripeEvent — invoice.payment_failed', () => {
  it('sets status to past_due and preserves existing plan', async () => {
    mockStorage.getBrandSubscription.mockResolvedValue({
      userId: 'user_test123',
      plan: 'pro',
      status: 'active',
      stripeSubscriptionId: 'sub_test123',
      currentPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000),
    });

    const invoice = makeInvoiceObject({});
    await dispatchStripeEvent(makeStripeEvent('invoice.payment_failed', invoice));

    const call = mockStorage.upsertBrandSubscription.mock.calls[0][0];
    expect(call.status).toBe('past_due');
    expect(call.plan).toBe('pro');
    expect(call.userId).toBe('user_test123');
  });

  it('sets status to past_due even when no existing subscription (upserts with defaults)', async () => {
    mockStorage.getBrandSubscription.mockResolvedValue(null);
    const invoice = makeInvoiceObject({});

    await dispatchStripeEvent(makeStripeEvent('invoice.payment_failed', invoice));

    const call = mockStorage.upsertBrandSubscription.mock.calls[0][0];
    expect(call.status).toBe('past_due');
    expect(call.plan).toBe('starter');
  });

  it('skips when no user found for customer', async () => {
    mockStorage.getUserByStripeCustomerId.mockResolvedValue(null);
    const invoice = makeInvoiceObject({});

    await dispatchStripeEvent(makeStripeEvent('invoice.payment_failed', invoice));

    expect(mockStorage.upsertBrandSubscription).not.toHaveBeenCalled();
  });
});

describe('dispatchStripeEvent — unrecognised event type', () => {
  it('does not call storage for unknown event types', async () => {
    await dispatchStripeEvent(makeStripeEvent('product.created', { id: 'prod_123' }));
    expect(mockStorage.upsertBrandSubscription).not.toHaveBeenCalled();
  });

  it('does not throw for unknown event types', async () => {
    await expect(
      dispatchStripeEvent(makeStripeEvent('charge.succeeded', { id: 'ch_123' }))
    ).resolves.not.toThrow();
  });
});
