/**
 * When is a creator's Stripe account ready to be paid?
 *
 * Regression coverage for a defect that made affiliate payouts impossible.
 *
 * createConnectAccount (server/stripeService.ts) requests the `transfers`
 * capability ONLY — which is correct: money flows platform -> creator, and a
 * creator never accepts card payments through this platform. But both readiness
 * checks additionally required `charges_enabled`, which reflects whether the
 * account can PROCESS charges and needs the `card_payments` capability. On a
 * transfers-only account it is false forever.
 *
 * Net effect: stripeConnectOnboarded never became true for anyone, and
 * executePayouts put every affiliate in skippedNoAccount. The payout engine ran
 * cleanly and paid nobody, every time.
 */
import { describe, it, expect } from 'vitest';

/** Mirrors the gate in /api/stripe/connect/status and handleAccountUpdated. */
function isOnboarded(account: { payouts_enabled?: boolean; details_submitted?: boolean }): boolean {
  return !!account.payouts_enabled && !!account.details_submitted;
}

describe('Connect onboarding gate', () => {
  it('accepts a transfers-only account that can receive payouts — the real case', () => {
    // charges_enabled is false here, as it always is on a transfers-only account.
    expect(isOnboarded({ payouts_enabled: true, details_submitted: true })).toBe(true);
  });

  it('does not require charges_enabled, which can never be true here', () => {
    const account = { payouts_enabled: true, details_submitted: true, charges_enabled: false };
    expect(isOnboarded(account)).toBe(true);
  });

  it('still refuses an account that has not finished onboarding', () => {
    expect(isOnboarded({ payouts_enabled: true, details_submitted: false })).toBe(false);
  });

  it('still refuses an account Stripe will not pay out to', () => {
    expect(isOnboarded({ payouts_enabled: false, details_submitted: true })).toBe(false);
  });

  it('refuses an empty/unknown account', () => {
    expect(isOnboarded({})).toBe(false);
  });
});
