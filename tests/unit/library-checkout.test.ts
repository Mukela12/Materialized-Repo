import { describe, it, expect } from 'vitest';
import { checkListingCheckout, listingReturnPath, LISTING_CHECKOUT_PURPOSE } from '../../server/libraryCheckout';

const listing = { id: 'l1', creatorId: 'u1', publishStatus: 'pending_payment' };
const fee = { amountCents: 4900, currency: 'usd' };
const paid = {
  mode: 'payment' as const,
  metadata: { purpose: LISTING_CHECKOUT_PURPOSE, listingId: 'l1', userId: 'u1' },
  payment_status: 'paid' as const,
  amount_total: 4900,
  currency: 'usd',
  payment_intent: 'pi_123',
};

describe('checkListingCheckout', () => {
  it('accepts a paid session for this listing, owner and fee', () => {
    expect(checkListingCheckout(paid, listing, fee)).toEqual({ ok: true, paymentIntentId: 'pi_123' });
  });

  it('reads an expanded payment intent too', () => {
    const r = checkListingCheckout({ ...paid, payment_intent: { id: 'pi_456' } as any }, listing, fee);
    expect(r).toEqual({ ok: true, paymentIntentId: 'pi_456' });
  });

  it('refuses a session that has not been paid', () => {
    expect(checkListingCheckout({ ...paid, payment_status: 'unpaid' }, listing, fee).ok).toBe(false);
  });

  it('refuses a paid session for another listing or another user', () => {
    expect(checkListingCheckout({ ...paid, metadata: { ...paid.metadata, listingId: 'l2' } }, listing, fee).ok).toBe(false);
    expect(checkListingCheckout({ ...paid, metadata: { ...paid.metadata, userId: 'u2' } }, listing, fee).ok).toBe(false);
  });

  it('refuses a session that paid less than the fee or in another currency', () => {
    expect(checkListingCheckout({ ...paid, amount_total: 100 }, listing, fee).ok).toBe(false);
    expect(checkListingCheckout({ ...paid, currency: 'eur' }, listing, fee).ok).toBe(false);
  });

  it('refuses any other kind of checkout', () => {
    expect(checkListingCheckout({ ...paid, metadata: { ...paid.metadata, purpose: 'setup_fee' } }, listing, fee).ok).toBe(false);
    expect(checkListingCheckout({ ...paid, mode: 'subscription' }, listing, fee).ok).toBe(false);
  });
});

describe('listingReturnPath', () => {
  it('sends brands and creators back to their own videos page', () => {
    expect(listingReturnPath('brand')).toBe('/brand/my-videos');
    expect(listingReturnPath('creator')).toBe('/creator/my-videos');
  });
});
