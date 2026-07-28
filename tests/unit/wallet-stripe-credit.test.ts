/**
 * The sign regression guard for the subscription-subsidy sink.
 *
 * Stripe's convention (node_modules/stripe/types/CustomerBalanceTransactions.d.ts):
 * "A negative value is a CREDIT for the customer's balance, and a positive value is
 * a DEBIT." So subsidising $49 is `amount: -4900`. Passing +4900 would BILL the
 * customer an extra $49 — the single most expensive character on this path, and
 * invisible until a customer complains.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/stripeClient', () => ({
  getUncachableStripeClient: vi.fn(),
}));

import { StripeService } from '../../server/stripeService';
import { getUncachableStripeClient } from '../../server/stripeClient';
import { TOKEN_USD_CENTS } from '../../shared/pricing';

const mockStripe = {
  customers: {
    createBalanceTransaction: vi.fn(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PLATFORM_CURRENCY = 'usd';
  (getUncachableStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockStripe);
  mockStripe.customers.createBalanceTransaction.mockResolvedValue({ id: 'cbtxn_1', amount: -4900 });
});

describe('applyCustomerCreditCents', () => {
  const service = new StripeService();

  it('sends a NEGATIVE amount — a credit, not a charge', async () => {
    await service.applyCustomerCreditCents('cus_1', TOKEN_USD_CENTS, 'token redemption', 'wallet_credit_e1');

    const [customerId, params, options] = mockStripe.customers.createBalanceTransaction.mock.calls[0];
    expect(customerId).toBe('cus_1');
    expect(params.amount).toBe(-4900);
    expect(params.amount).toBeLessThan(0);
    expect(params.currency).toBe('usd');
    expect(options).toEqual({ idempotencyKey: 'wallet_credit_e1' });
  });

  it('scales with the number of tokens', async () => {
    await service.applyCustomerCreditCents('cus_1', 3 * TOKEN_USD_CENTS, 'three tokens', 'wallet_credit_e2');
    expect(mockStripe.customers.createBalanceTransaction.mock.calls[0][1].amount).toBe(-14700);
  });

  it('passes the wallet entry id through as metadata for reconciliation', async () => {
    await service.applyCustomerCreditCents('cus_1', 4900, 'x', 'k', { userId: 'u1', walletEntryId: 'e9' });
    expect(mockStripe.customers.createBalanceTransaction.mock.calls[0][1].metadata)
      .toEqual({ userId: 'u1', walletEntryId: 'e9' });
  });

  it('refuses a non-positive or fractional credit rather than guessing the sign', async () => {
    await expect(service.applyCustomerCreditCents('cus_1', 0, 'x', 'k')).rejects.toThrow(/positive integer/);
    await expect(service.applyCustomerCreditCents('cus_1', -4900, 'x', 'k')).rejects.toThrow(/positive integer/);
    await expect(service.applyCustomerCreditCents('cus_1', 49.5, 'x', 'k')).rejects.toThrow(/positive integer/);
    expect(mockStripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
  });
});
