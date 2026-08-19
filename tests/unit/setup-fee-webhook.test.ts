/**
 * The webhook that actually settles the $29 admin fee.
 *
 * ── Why this exists as a dispatch test ───────────────────────────────────────
 * `stripe trigger` cannot prove this. It sends tok_visa, a TEST token, and the
 * platform account is live — live mode correctly refuses fake cards, which is
 * the right behaviour and also means the handler can never be exercised that
 * way. The remaining options are a real card (a human with a wallet) or driving
 * the dispatcher directly with the event Stripe would send. This is the latter.
 *
 * The negative cases carry the weight. Settling the fee grants access, so a
 * handler that settles too eagerly hands out paid accounts for free — and does
 * it silently, which is exactly how the original missing-fee gap survived.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/storage', () => ({
  storage: {
    getUserByStripeCustomerId: vi.fn(),
    getUserByStripeConnectAccountId: vi.fn(),
    getBrandSubscription: vi.fn(),
    upsertBrandSubscription: vi.fn(),
    updateUser: vi.fn().mockResolvedValue(undefined),
    getPayoutByStripeTransferId: vi.fn(),
    getAllPayouts: vi.fn(),
    getCommissionsByPayoutId: vi.fn(),
    markCommissionsReversed: vi.fn(),
    updatePayoutStatus: vi.fn(),
    getCampaignAffiliates: vi.fn(),
    updateCampaignAffiliateStats: vi.fn(),
    getUser: vi.fn(),
    createCommissionTransaction: vi.fn(),
    hasCommissionForExternalOrder: vi.fn(),
  },
}));
vi.mock('../../server/stripeClient', () => ({ getUncachableStripeClient: vi.fn() }));

import { storage } from '../../server/storage';
import { dispatchStripeEvent } from '../../server/webhookHandlers';

const mockStorage = storage as any;

const event = (obj: unknown) => ({
  id: `evt_${Date.now()}`,
  object: 'event',
  type: 'checkout.session.completed',
  data: { object: obj },
  livemode: true,
  created: Math.floor(Date.now() / 1000),
  api_version: '2024-06-20',
}) as any;

/** The session Stripe sends back for a standalone fee payment. */
const feeSession = (over: Record<string, any> = {}) => ({
  id: 'cs_live_fee_1',
  object: 'checkout.session',
  mode: 'payment',
  payment_status: 'paid',
  customer: 'cus_123',
  amount_total: 2900,
  metadata: { userId: 'user_brand_1', purpose: 'setup_fee' },
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('the fee is settled when it is actually paid', () => {
  it('marks the account settled, with a timestamp', async () => {
    await dispatchStripeEvent(event(feeSession()));

    expect(mockStorage.updateUser).toHaveBeenCalledOnce();
    const [userId, patch] = mockStorage.updateUser.mock.calls[0];
    expect(userId).toBe('user_brand_1');
    expect(patch.setupFeePaid).toBe(true);
    expect(patch.setupFeePaidAt).toBeInstanceOf(Date);
  });

  it('falls back to the Stripe customer when metadata carries no user', async () => {
    mockStorage.getUserByStripeCustomerId.mockResolvedValue({ id: 'user_from_customer' });
    await dispatchStripeEvent(event(feeSession({ metadata: { purpose: 'setup_fee' } })));

    expect(mockStorage.updateUser).toHaveBeenCalledOnce();
    expect(mockStorage.updateUser.mock.calls[0][0]).toBe('user_from_customer');
  });
});

describe('and not settled when it is not', () => {
  it('refuses an unpaid session — completed is not paid', async () => {
    await dispatchStripeEvent(event(feeSession({ payment_status: 'unpaid' })));
    expect(mockStorage.updateUser).not.toHaveBeenCalled();
  });

  it('refuses a session with no payment_status at all', async () => {
    await dispatchStripeEvent(event(feeSession({ payment_status: undefined })));
    expect(mockStorage.updateUser).not.toHaveBeenCalled();
  });

  /**
   * The one that matters most. Other one-time payments share `payment` mode —
   * settling on mode alone would mark the fee paid because somebody bought
   * something else entirely.
   */
  it('ignores a one-time payment that is not the fee', async () => {
    await dispatchStripeEvent(event(feeSession({ metadata: { userId: 'user_brand_1', purpose: 'video_license' } })));
    expect(mockStorage.updateUser).not.toHaveBeenCalled();
  });

  it('ignores a one-time payment with no purpose', async () => {
    await dispatchStripeEvent(event(feeSession({ metadata: { userId: 'user_brand_1' } })));
    expect(mockStorage.updateUser).not.toHaveBeenCalled();
  });

  it('does nothing when it cannot identify the account', async () => {
    mockStorage.getUserByStripeCustomerId.mockResolvedValue(undefined);
    await dispatchStripeEvent(event(feeSession({ metadata: { purpose: 'setup_fee' }, customer: null })));
    expect(mockStorage.updateUser).not.toHaveBeenCalled();
  });
});
