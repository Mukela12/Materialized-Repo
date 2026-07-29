/**
 * The onboarding checkout: setup fee now, TRIAL_DAYS free, card kept on file.
 *
 * These pin the three things that are easy to break silently and expensive to
 * discover in production:
 *
 *   1. The amounts are MINOR units. This codebase has already shipped a 100x
 *      overcharge once, from mixing the two conventions in the same file
 *      (createPaymentIntent takes MAJOR units and multiplies; Stripe prices do
 *      not). A wrong unit here is a $2,900 charge on signup.
 *
 *   2. The session collects a card even when the fee is waived. With nothing
 *      due, Stripe does not ask for one unless told to — and a comped creator
 *      with no card is unbillable the moment overage starts, which is the
 *      entire reason the fee exists operationally.
 *
 *   3. The one-time price is distinguished from the monthly price by the ABSENCE
 *      of `recurring`. Matching on amount alone would happily reuse a monthly
 *      $29 price and bill the fee every month forever.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/stripeClient', () => ({
  getUncachableStripeClient: vi.fn(),
}));

import { StripeService } from '../../server/stripeService';
import { getUncachableStripeClient } from '../../server/stripeClient';
import { SETUP_FEE, TRIAL_DAYS, setupFeeMajor, isEligibleForIntroOffer } from '../../shared/plans';

const mockStripe = {
  products: { list: vi.fn(), create: vi.fn() },
  prices: { list: vi.fn(), create: vi.fn() },
  checkout: { sessions: { create: vi.fn() } },
  customers: { create: vi.fn() },
  invoices: { create: vi.fn(), finalizeInvoice: vi.fn() },
  invoiceItems: { create: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PLATFORM_CURRENCY = 'usd';
  (getUncachableStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockStripe);
});

describe('the offer constants', () => {
  it('prices the setup fee at $29 expressed in MINOR units', () => {
    expect(SETUP_FEE.amount).toBe(2900);
    expect(setupFeeMajor()).toBe(29);
  });

  it('gives 30 days before the first monthly charge', () => {
    expect(TRIAL_DAYS).toBe(30);
  });
});

describe('StripeService.findOrCreateSetupFeePrice', () => {
  const service = new StripeService();

  it('reuses an existing one-time price rather than minting a duplicate', async () => {
    mockStripe.products.list.mockResolvedValue({
      data: [{ id: 'prod_fee', metadata: { kind: 'setup_fee' } }],
    });
    mockStripe.prices.list.mockResolvedValue({
      data: [{ id: 'price_fee', unit_amount: 2900, currency: 'usd', recurring: null }],
    });

    expect(await service.findOrCreateSetupFeePrice()).toBe('price_fee');
    expect(mockStripe.prices.create).not.toHaveBeenCalled();
    expect(mockStripe.products.create).not.toHaveBeenCalled();
  });

  it('never reuses a RECURRING $29 price — that would bill the fee monthly', async () => {
    mockStripe.products.list.mockResolvedValue({
      data: [{ id: 'prod_fee', metadata: { kind: 'setup_fee' } }],
    });
    mockStripe.prices.list.mockResolvedValue({
      data: [{ id: 'price_monthly_29', unit_amount: 2900, currency: 'usd', recurring: { interval: 'month' } }],
    });
    mockStripe.prices.create.mockResolvedValue({ id: 'price_new_oneoff' });

    expect(await service.findOrCreateSetupFeePrice()).toBe('price_new_oneoff');
    // The created price must itself carry no `recurring`.
    expect(mockStripe.prices.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ recurring: expect.anything() }),
    );
  });

  it('creates the product on first use, keyed on metadata not name', async () => {
    mockStripe.products.list.mockResolvedValue({ data: [] });
    mockStripe.products.create.mockResolvedValue({ id: 'prod_new' });
    mockStripe.prices.list.mockResolvedValue({ data: [] });
    mockStripe.prices.create.mockResolvedValue({ id: 'price_new' });

    await service.findOrCreateSetupFeePrice();

    expect(mockStripe.products.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { kind: 'setup_fee' } }),
    );
    expect(mockStripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({ unit_amount: 2900, currency: 'usd' }),
    );
  });
});

describe('StripeService.createTrialWithSetupFeeCheckout', () => {
  const service = new StripeService();

  /** Monthly price lookup hits first, then the fee lookup. */
  function stubPrices() {
    mockStripe.products.list.mockResolvedValue({
      data: [
        { id: 'prod_plan', metadata: { plan: 'creator' } },
        { id: 'prod_fee', metadata: { kind: 'setup_fee' } },
      ],
    });
    mockStripe.prices.list.mockImplementation(({ product }: any) =>
      Promise.resolve({
        data: product === 'prod_plan'
          ? [{ id: 'price_plan', unit_amount: 14900, currency: 'usd', recurring: { interval: 'month' } }]
          : [{ id: 'price_fee', unit_amount: 2900, currency: 'usd', recurring: null }],
      }),
    );
    mockStripe.checkout.sessions.create.mockResolvedValue({ id: 'cs_1', url: 'https://checkout' });
  }

  it('bills the fee and the plan on one session, on a 30-day trial', async () => {
    stubPrices();
    await service.createTrialWithSetupFeeCheckout('cus_1', 'creator', 'ok', 'no', { userId: 'u1' });

    const arg = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(arg.mode).toBe('subscription');
    expect(arg.subscription_data).toEqual({ trial_period_days: 30 });
    expect(arg.line_items).toEqual([
      { price: 'price_plan', quantity: 1 },
      { price: 'price_fee', quantity: 1 },
    ]);
  });

  it('always collects a card, so overage can be charged later', async () => {
    stubPrices();
    await service.createTrialWithSetupFeeCheckout('cus_1', 'creator', 'ok', 'no');
    expect(mockStripe.checkout.sessions.create.mock.calls[0][0].payment_method_collection).toBe('always');
  });

  it('waiving the fee drops the fee line but STILL collects a card', async () => {
    stubPrices();
    await service.createTrialWithSetupFeeCheckout('cus_1', 'creator', 'ok', 'no', undefined, true);

    const arg = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(arg.line_items).toEqual([{ price: 'price_plan', quantity: 1 }]);
    expect(arg.payment_method_collection).toBe('always');
    expect(arg.subscription_data).toEqual({ trial_period_days: 30 });
  });

  it('waiving the fee does not even look up the fee price', async () => {
    stubPrices();
    await service.createTrialWithSetupFeeCheckout('cus_1', 'creator', 'ok', 'no', undefined, true);
    const lookedUp = mockStripe.prices.list.mock.calls.map((c: any) => c[0].product);
    expect(lookedUp).not.toContain('prod_fee');
  });
});

/**
 * Who may take the offer.
 *
 * This is the anti-abuse rule, and the failure mode is silent: without it a
 * creator cancels, re-runs checkout, and holds the product for $29 every 30 days
 * instead of $149/month — repeatable indefinitely, and invisible in the
 * subscription table because the row is upserted, not appended.
 */
describe('isEligibleForIntroOffer', () => {
  it('allows a creator who has never subscribed', () => {
    expect(isEligibleForIntroOffer(undefined)).toBe(true);
    expect(isEligibleForIntroOffer(null)).toBe(true);
  });

  it('refuses anyone with a prior row, WHATEVER its status', () => {
    for (const status of ['active', 'cancelled', 'past_due', 'trialing', '']) {
      expect(isEligibleForIntroOffer({ userId: 'u1', status })).toBe(false);
    }
  });

  it('a cancelled subscriber cannot re-trial — the loop this rule exists to close', () => {
    expect(isEligibleForIntroOffer({ userId: 'u1', status: 'cancelled' })).toBe(false);
  });
});

/**
 * The surplus/overage invoice.
 *
 * Regression coverage for a live defect: the invoice item was created BEFORE the
 * invoice, on the assumption that `invoices.create` sweeps up pending items. It
 * does not — the default pending_invoice_items_behavior is 'exclude' — so the
 * invoice finalised with zero lines, a $0 invoice is auto-marked `paid`, and the
 * caller reported success while nobody was charged. Confirmed against Stripe
 * test mode: a $1 surplus produced `total=0 status=paid lines=0`.
 */
describe('StripeService.createSurplusInvoice', () => {
  const service = new StripeService();

  it('creates the invoice FIRST, then attaches the item to it by id', async () => {
    mockStripe.invoices.create.mockResolvedValue({ id: 'in_1' });
    mockStripe.invoiceItems.create.mockResolvedValue({ id: 'ii_1' });
    mockStripe.invoices.finalizeInvoice.mockResolvedValue({ id: 'in_1', total: 100, status: 'open' });

    await service.createSurplusInvoice('cus_1', 1, 'Overage');

    // The item must name the invoice — that is what stops it floating.
    expect(mockStripe.invoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({ invoice: 'in_1', amount: 100, customer: 'cus_1' }),
    );
    expect(mockStripe.invoices.create.mock.invocationCallOrder[0])
      .toBeLessThan(mockStripe.invoiceItems.create.mock.invocationCallOrder[0]);
  });

  it('converts MAJOR units to minor — $1 is 100, not 1', async () => {
    mockStripe.invoices.create.mockResolvedValue({ id: 'in_1' });
    mockStripe.invoiceItems.create.mockResolvedValue({ id: 'ii_1' });
    mockStripe.invoices.finalizeInvoice.mockResolvedValue({ id: 'in_1', total: 100 });

    await service.createSurplusInvoice('cus_1', 1, 'Overage');
    expect(mockStripe.invoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 100 }),
    );
  });

  it('THROWS on a zero-total invoice rather than returning a false success', async () => {
    mockStripe.invoices.create.mockResolvedValue({ id: 'in_empty' });
    mockStripe.invoiceItems.create.mockResolvedValue({ id: 'ii_1' });
    mockStripe.invoices.finalizeInvoice.mockResolvedValue({ id: 'in_empty', total: 0, status: 'paid' });

    await expect(service.createSurplusInvoice('cus_1', 1, 'Overage'))
      .rejects.toThrow(/zero total/);
  });
});
