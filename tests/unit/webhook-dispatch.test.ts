import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

vi.mock('../../server/storage', () => ({
  storage: {
    getUserByStripeCustomerId: vi.fn(),
    getUserByStripeConnectAccountId: vi.fn(),
    getBrandSubscription: vi.fn(),
    upsertBrandSubscription: vi.fn(),
    updateUser: vi.fn(),
    getPayoutByStripeTransferId: vi.fn(),
    getAllPayouts: vi.fn(),
    getCommissionsByPayoutId: vi.fn(),
    markCommissionsReversed: vi.fn(),
    updatePayoutStatus: vi.fn(),
    getCampaignAffiliates: vi.fn(),
    updateCampaignAffiliateStats: vi.fn(),
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
  getUserByStripeConnectAccountId: ReturnType<typeof vi.fn>;
  getBrandSubscription: ReturnType<typeof vi.fn>;
  upsertBrandSubscription: ReturnType<typeof vi.fn>;
  updateUser: ReturnType<typeof vi.fn>;
  getPayoutByStripeTransferId: ReturnType<typeof vi.fn>;
  getAllPayouts: ReturnType<typeof vi.fn>;
  getCommissionsByPayoutId: ReturnType<typeof vi.fn>;
  markCommissionsReversed: ReturnType<typeof vi.fn>;
  updatePayoutStatus: ReturnType<typeof vi.fn>;
  getCampaignAffiliates: ReturnType<typeof vi.fn>;
  updateCampaignAffiliateStats: ReturnType<typeof vi.fn>;
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
    charges: { retrieve: vi.fn() },
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
  mockStorage.getCampaignAffiliates.mockResolvedValue([]);
  mockStorage.updateCampaignAffiliateStats.mockResolvedValue({});
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

describe('dispatchStripeEvent — transfer.reversed / transfer.failed', () => {
  function makeTransfer(opts: { id?: string; payoutId?: string; amount?: number; amountReversed?: number } = {}) {
    const { id = 'tr_test123', payoutId, amount, amountReversed } = opts;
    return {
      id,
      object: 'transfer',
      reversed: true,
      ...(amount !== undefined ? { amount } : {}),
      ...(amountReversed !== undefined ? { amount_reversed: amountReversed } : {}),
      metadata: payoutId ? { payoutId } : {},
    } as unknown as Stripe.Transfer;
  }

  it('reverses paid commissions and marks the payout reversed', async () => {
    mockStorage.getPayoutByStripeTransferId.mockResolvedValue({ id: 'payout_1', status: 'paid' });
    mockStorage.getCommissionsByPayoutId.mockResolvedValue([
      { id: 'c1', status: 'paid' },
      { id: 'c2', status: 'paid' },
    ]);

    await dispatchStripeEvent(makeStripeEvent('transfer.reversed', makeTransfer()));

    expect(mockStorage.markCommissionsReversed).toHaveBeenCalledWith(['c1', 'c2']);
    expect(mockStorage.updatePayoutStatus).toHaveBeenCalledWith('payout_1', 'reversed');
  });

  it('marks the payout failed for transfer.failed events', async () => {
    mockStorage.getPayoutByStripeTransferId.mockResolvedValue({ id: 'payout_2', status: 'paid' });
    mockStorage.getCommissionsByPayoutId.mockResolvedValue([{ id: 'c9', status: 'paid' }]);

    await dispatchStripeEvent(makeStripeEvent('transfer.failed', makeTransfer({ id: 'tr_fail' })));

    expect(mockStorage.markCommissionsReversed).toHaveBeenCalledWith(['c9']);
    expect(mockStorage.updatePayoutStatus).toHaveBeenCalledWith('payout_2', 'failed');
  });

  it('falls back to metadata.payoutId when no payout matches the transfer id', async () => {
    mockStorage.getPayoutByStripeTransferId.mockResolvedValue(undefined);
    mockStorage.getAllPayouts.mockResolvedValue([{ id: 'payout_meta', status: 'paid' }]);
    mockStorage.getCommissionsByPayoutId.mockResolvedValue([{ id: 'c3', status: 'paid' }]);

    await dispatchStripeEvent(makeStripeEvent('transfer.reversed', makeTransfer({ payoutId: 'payout_meta' })));

    expect(mockStorage.markCommissionsReversed).toHaveBeenCalledWith(['c3']);
    expect(mockStorage.updatePayoutStatus).toHaveBeenCalledWith('payout_meta', 'reversed');
  });

  it('is idempotent — skips when payout already reversed and no paid commissions remain', async () => {
    mockStorage.getPayoutByStripeTransferId.mockResolvedValue({ id: 'payout_done', status: 'reversed' });
    mockStorage.getCommissionsByPayoutId.mockResolvedValue([{ id: 'c4', status: 'reversed' }]);

    await dispatchStripeEvent(makeStripeEvent('transfer.reversed', makeTransfer()));

    expect(mockStorage.markCommissionsReversed).not.toHaveBeenCalled();
    expect(mockStorage.updatePayoutStatus).not.toHaveBeenCalled();
  });

  it('does not throw when no payout can be resolved', async () => {
    mockStorage.getPayoutByStripeTransferId.mockResolvedValue(undefined);
    mockStorage.getAllPayouts.mockResolvedValue([]);

    await expect(
      dispatchStripeEvent(makeStripeEvent('transfer.reversed', makeTransfer({ payoutId: 'nope' })))
    ).resolves.not.toThrow();
    expect(mockStorage.markCommissionsReversed).not.toHaveBeenCalled();
  });

  it('does not throw when a storage call rejects', async () => {
    mockStorage.getPayoutByStripeTransferId.mockRejectedValue(new Error('db down'));

    await expect(
      dispatchStripeEvent(makeStripeEvent('transfer.reversed', makeTransfer()))
    ).resolves.not.toThrow();
  });

  // Finding E — the campaign-affiliate rollup must be decremented symmetric to the sale,
  // only for rows this call transitioned paid -> reversed.
  it('decrements the campaign-affiliate rollup for reversed publisher commissions (clamped, once)', async () => {
    mockStorage.getPayoutByStripeTransferId.mockResolvedValue({ id: 'payout_e', status: 'paid' });
    mockStorage.getCommissionsByPayoutId.mockResolvedValue([
      // creator row: no campaignAffiliateId — no stat decrement
      { id: 'c1', status: 'paid', campaignAffiliateId: null, videoId: 'v1', saleAmount: '100.00', commissionAmount: '8.00' },
      // publisher row: campaign-attributed — decrements the rollup
      { id: 'c2', status: 'paid', campaignAffiliateId: 'ca1', videoId: 'v1', saleAmount: '100.00', commissionAmount: '2.00' },
    ]);
    mockStorage.getCampaignAffiliates.mockResolvedValue([
      { id: 'ca1', totalConversions: 3, totalRevenue: '150.00', totalEarnings: '3.00' },
    ]);

    await dispatchStripeEvent(makeStripeEvent('transfer.reversed', makeTransfer()));

    expect(mockStorage.markCommissionsReversed).toHaveBeenCalledWith(['c1', 'c2']);
    expect(mockStorage.updateCampaignAffiliateStats).toHaveBeenCalledTimes(1);
    expect(mockStorage.updateCampaignAffiliateStats).toHaveBeenCalledWith('ca1', {
      totalConversions: 2,      // 3 - 1
      totalRevenue: '50.00',    // 150 - 100
      totalEarnings: '1.00',    // 3.00 - 2.00
    });
  });

  it('clamps the campaign-affiliate rollup decrement at zero on stale totals', async () => {
    mockStorage.getPayoutByStripeTransferId.mockResolvedValue({ id: 'payout_e2', status: 'paid' });
    mockStorage.getCommissionsByPayoutId.mockResolvedValue([
      { id: 'c2', status: 'paid', campaignAffiliateId: 'ca1', videoId: 'v1', saleAmount: '100.00', commissionAmount: '2.00' },
    ]);
    mockStorage.getCampaignAffiliates.mockResolvedValue([
      { id: 'ca1', totalConversions: 0, totalRevenue: '0.00', totalEarnings: '0.00' },
    ]);

    await dispatchStripeEvent(makeStripeEvent('transfer.reversed', makeTransfer()));

    expect(mockStorage.updateCampaignAffiliateStats).toHaveBeenCalledWith('ca1', {
      totalConversions: 0,
      totalRevenue: '0.00',
      totalEarnings: '0.00',
    });
  });

  // Finding F — a partial reversal must NOT auto-reverse; it is flagged for manual handling.
  it('does not auto-reverse a partial transfer reversal (amount_reversed < amount)', async () => {
    mockStorage.getPayoutByStripeTransferId.mockResolvedValue({ id: 'payout_p', status: 'paid' });
    mockStorage.getCommissionsByPayoutId.mockResolvedValue([{ id: 'c1', status: 'paid' }]);

    await dispatchStripeEvent(makeStripeEvent('transfer.reversed', makeTransfer({ amount: 1000, amountReversed: 400 })));

    expect(mockStorage.markCommissionsReversed).not.toHaveBeenCalled();
    expect(mockStorage.updatePayoutStatus).not.toHaveBeenCalled();
  });

  it('treats a fully-reversed transfer (amount_reversed >= amount) as a full reconcile', async () => {
    mockStorage.getPayoutByStripeTransferId.mockResolvedValue({ id: 'payout_full', status: 'paid' });
    mockStorage.getCommissionsByPayoutId.mockResolvedValue([{ id: 'c1', status: 'paid', campaignAffiliateId: null, videoId: 'v1', saleAmount: '10.00', commissionAmount: '1.00' }]);

    await dispatchStripeEvent(makeStripeEvent('transfer.reversed', makeTransfer({ amount: 1000, amountReversed: 1000 })));

    expect(mockStorage.markCommissionsReversed).toHaveBeenCalledWith(['c1']);
    expect(mockStorage.updatePayoutStatus).toHaveBeenCalledWith('payout_full', 'reversed');
  });
});

describe('dispatchStripeEvent — account.updated', () => {
  function makeAccount(opts: {
    id?: string;
    charges?: boolean;
    payouts?: boolean;
    details?: boolean;
  }) {
    const { id = 'acct_test', charges = true, payouts = true, details = true } = opts;
    return {
      id,
      object: 'account',
      charges_enabled: charges,
      payouts_enabled: payouts,
      details_submitted: details,
    } as unknown as Stripe.Account;
  }

  it('sets stripeConnectOnboarded=true when all capabilities are enabled', async () => {
    mockStorage.getUserByStripeConnectAccountId.mockResolvedValue({ id: 'u1', stripeConnectOnboarded: false });

    await dispatchStripeEvent(makeStripeEvent('account.updated', makeAccount({})));

    expect(mockStorage.updateUser).toHaveBeenCalledWith('u1', { stripeConnectOnboarded: true });
  });

  it('sets stripeConnectOnboarded=false when payouts are not enabled', async () => {
    mockStorage.getUserByStripeConnectAccountId.mockResolvedValue({ id: 'u2', stripeConnectOnboarded: true });

    await dispatchStripeEvent(makeStripeEvent('account.updated', makeAccount({ payouts: false })));

    expect(mockStorage.updateUser).toHaveBeenCalledWith('u2', { stripeConnectOnboarded: false });
  });

  it('is idempotent — does not write when the flag is unchanged', async () => {
    mockStorage.getUserByStripeConnectAccountId.mockResolvedValue({ id: 'u3', stripeConnectOnboarded: true });

    await dispatchStripeEvent(makeStripeEvent('account.updated', makeAccount({})));

    expect(mockStorage.updateUser).not.toHaveBeenCalled();
  });

  it('skips when no user matches the connect account', async () => {
    mockStorage.getUserByStripeConnectAccountId.mockResolvedValue(undefined);

    await dispatchStripeEvent(makeStripeEvent('account.updated', makeAccount({})));

    expect(mockStorage.updateUser).not.toHaveBeenCalled();
  });
});

describe('dispatchStripeEvent — payout.paid / payout.failed', () => {
  function makePayout(opts: { id?: string; status?: string } = {}) {
    const { id = 'po_test', status = 'paid' } = opts;
    return {
      id,
      object: 'payout',
      status,
      amount: 1000,
      currency: 'eur',
    } as unknown as Stripe.Payout;
  }

  it('logs Connect payout lifecycle without touching subscription/ledger storage', async () => {
    mockStorage.getUserByStripeConnectAccountId.mockResolvedValue({ id: 'u4' });

    const event = makeStripeEvent('payout.paid', makePayout());
    (event as any).account = 'acct_test';
    await dispatchStripeEvent(event);

    expect(mockStorage.getUserByStripeConnectAccountId).toHaveBeenCalledWith('acct_test');
    expect(mockStorage.upsertBrandSubscription).not.toHaveBeenCalled();
    expect(mockStorage.markCommissionsReversed).not.toHaveBeenCalled();
  });

  it('does not throw when the account is absent', async () => {
    const event = makeStripeEvent('payout.failed', makePayout({ status: 'failed' }));
    await expect(dispatchStripeEvent(event)).resolves.not.toThrow();
  });
});

describe('dispatchStripeEvent — charge.refunded', () => {
  function makeCharge(opts: {
    id?: string;
    customerId?: string | null;
    invoiceId?: string | null;
    amount?: number;
    refunded?: number;
  }) {
    const {
      id = 'ch_test',
      customerId = 'cus_test123',
      invoiceId = 'inv_test',
      amount = 24900,
      refunded = 24900,
    } = opts;
    return {
      id,
      object: 'charge',
      customer: customerId,
      invoice: invoiceId,
      amount,
      amount_refunded: refunded,
    } as unknown as Stripe.Charge;
  }

  it('cancels the subscription on a full refund of a subscription invoice', async () => {
    mockStorage.getBrandSubscription.mockResolvedValue({
      userId: 'user_test123', plan: 'pro', status: 'active', stripeSubscriptionId: 'sub_test123',
    });

    await dispatchStripeEvent(makeStripeEvent('charge.refunded', makeCharge({})));

    const call = mockStorage.upsertBrandSubscription.mock.calls[0][0];
    expect(call.status).toBe('cancelled');
    expect(call.plan).toBe('pro');
  });

  it('ignores non-invoice charges (e.g. license purchases)', async () => {
    await dispatchStripeEvent(makeStripeEvent('charge.refunded', makeCharge({ invoiceId: null })));
    expect(mockStorage.upsertBrandSubscription).not.toHaveBeenCalled();
  });

  it('leaves the subscription active on a partial refund', async () => {
    await dispatchStripeEvent(makeStripeEvent('charge.refunded', makeCharge({ amount: 24900, refunded: 10000 })));
    expect(mockStorage.upsertBrandSubscription).not.toHaveBeenCalled();
  });

  it('is idempotent — does not re-cancel an already cancelled subscription', async () => {
    mockStorage.getBrandSubscription.mockResolvedValue({
      userId: 'user_test123', plan: 'pro', status: 'cancelled', stripeSubscriptionId: 'sub_test123',
    });

    await dispatchStripeEvent(makeStripeEvent('charge.refunded', makeCharge({})));
    expect(mockStorage.upsertBrandSubscription).not.toHaveBeenCalled();
  });
});

describe('dispatchStripeEvent — charge.dispute.created', () => {
  function makeDispute(opts: { id?: string; chargeId?: string } = {}) {
    const { id = 'dp_test', chargeId = 'ch_test' } = opts;
    return {
      id,
      object: 'dispute',
      charge: chargeId,
    } as unknown as Stripe.Dispute;
  }

  function setChargeRetrieve(charge: unknown) {
    (getUncachableStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      subscriptions: { retrieve: vi.fn() },
      products: { retrieve: vi.fn() },
      charges: { retrieve: vi.fn().mockResolvedValue(charge) },
    });
  }

  it('freezes the subscription past_due on a subscription-invoice dispute', async () => {
    setChargeRetrieve({ id: 'ch_test', customer: 'cus_test123', invoice: 'inv_test' });
    mockStorage.getBrandSubscription.mockResolvedValue({
      userId: 'user_test123', plan: 'pro', status: 'active', stripeSubscriptionId: 'sub_test123',
    });

    await dispatchStripeEvent(makeStripeEvent('charge.dispute.created', makeDispute()));

    const call = mockStorage.upsertBrandSubscription.mock.calls[0][0];
    expect(call.status).toBe('past_due');
    expect(call.plan).toBe('pro');
  });

  it('ignores disputes on non-invoice charges', async () => {
    setChargeRetrieve({ id: 'ch_test', customer: 'cus_test123', invoice: null });

    await dispatchStripeEvent(makeStripeEvent('charge.dispute.created', makeDispute()));
    expect(mockStorage.upsertBrandSubscription).not.toHaveBeenCalled();
  });

  it('does not throw when the charge cannot be retrieved', async () => {
    (getUncachableStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      subscriptions: { retrieve: vi.fn() },
      products: { retrieve: vi.fn() },
      charges: { retrieve: vi.fn().mockRejectedValue(new Error('no such charge')) },
    });

    await expect(
      dispatchStripeEvent(makeStripeEvent('charge.dispute.created', makeDispute()))
    ).resolves.not.toThrow();
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

/**
 * A failed STANDALONE invoice must not touch subscription status.
 *
 * handleInvoicePaymentFailed read the invoice's subscription id but never
 * guarded on it, so an invoice with no subscription — an overage charge, or one
 * raised by hand in the Stripe dashboard — flipped the user's whole plan to
 * past_due and revoked their access over an unrelated bill. The success-path
 * twin already returned early on exactly this condition; the two disagreed.
 *
 * This matters more as overage billing arrives: overage failing is routine, and
 * it must never cancel someone's subscription.
 */
describe('invoice.payment_failed — only subscription invoices change status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storage.getUserByStripeCustomerId as any).mockResolvedValue({ id: 'u1' });
    (storage.getBrandSubscription as any).mockResolvedValue({
      plan: 'creator', stripeSubscriptionId: 'sub_1', currentPeriodEnd: new Date(),
    });
  });

  it('ignores a standalone invoice (no subscription) — does not mark past_due', async () => {
    await dispatchStripeEvent({
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_1', subscription: null } },
    } as any as Stripe.Event);

    expect(storage.upsertBrandSubscription).not.toHaveBeenCalled();
  });

  it('still marks past_due for a genuine subscription invoice', async () => {
    await dispatchStripeEvent({
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_1', subscription: 'sub_1' } },
    } as any as Stripe.Event);

    expect(storage.upsertBrandSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', status: 'past_due' }),
    );
  });
});

/**
 * Reading an invoice's subscription id across Stripe API versions.
 *
 * Stripe moved this field in 2025-03-31.basil: top-level `invoice.subscription`
 * became `invoice.parent.subscription_details.subscription`. Nothing in this
 * codebase pins an API version, and webhook ENDPOINTS carry their own version
 * chosen at creation — so the live endpoint (which must be created fresh, since
 * endpoints are per-mode) can easily land on a newer version than the test one.
 *
 * The failure is silent: the handlers return early on a null id, so renewals
 * would stop extending periods and stop minting tokens with nothing logged.
 * These pin that every known shape resolves.
 */
describe('invoice subscription id — API-version tolerance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storage.getUserByStripeCustomerId as any).mockResolvedValue({ id: 'u1' });
    (storage.getBrandSubscription as any).mockResolvedValue({ plan: 'creator' });
  });

  async function failedInvoice(object: any) {
    await dispatchStripeEvent({
      type: 'invoice.payment_failed', data: { object },
    } as any as Stripe.Event);
  }

  it('reads the legacy top-level field (pre-basil)', async () => {
    await failedInvoice({ customer: 'cus_1', subscription: 'sub_legacy' });
    expect(storage.upsertBrandSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'past_due' }),
    );
  });

  it('reads parent.subscription_details.subscription (2025-03-31.basil+)', async () => {
    await failedInvoice({
      customer: 'cus_1',
      subscription: null,
      parent: { subscription_details: { subscription: 'sub_basil' } },
    });
    expect(storage.upsertBrandSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'past_due' }),
    );
  });

  it('falls back to the line item', async () => {
    await failedInvoice({
      customer: 'cus_1',
      subscription: null,
      lines: { data: [{ subscription: 'sub_line' }] },
    });
    expect(storage.upsertBrandSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'past_due' }),
    );
  });

  it('still returns null when there is genuinely no subscription', async () => {
    await failedInvoice({ customer: 'cus_1', subscription: null, lines: { data: [] } });
    expect(storage.upsertBrandSubscription).not.toHaveBeenCalled();
  });
});
