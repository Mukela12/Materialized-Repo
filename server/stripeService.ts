import { getUncachableStripeClient } from './stripeClient';
import { getPlatformCurrency } from './feeConfig';

// Plan catalogue lives in shared/ so the client renders exactly the amounts the
// server charges. See shared/plans.ts for why the keys must never be renamed.
export {
  PLAN_CONFIG, PLAN_KEYS, isPlanKey, planPriceMajor,
  BRAND_PLANS, CREATOR_PLANS, isAllowedPlan,
  SETUP_FEE, TRIAL_DAYS, setupFeeMajor, isEligibleForIntroOffer,
  type PlanKey,
} from '../shared/plans';
import { PLAN_CONFIG, SETUP_FEE, TRIAL_DAYS, type PlanKey } from '../shared/plans';

export class StripeService {
  async findOrCreateSubscriptionPrice(plan: PlanKey): Promise<string> {
    const stripe = await getUncachableStripeClient();
    const config = PLAN_CONFIG[plan];

    const products = await stripe.products.list({ active: true, limit: 100 });
    let product = products.data.find(p => p.metadata?.plan === plan);

    if (!product) {
      product = await stripe.products.create({
        name: config.name,
        metadata: { plan },
      });
    }

    // limit must stay well above the number of prices a product can accumulate
    // across currency/amount changes — a miss here mints a duplicate price on
    // every checkout.
    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
    const existing = prices.data.find(p => p.recurring?.interval === 'month' && p.unit_amount === config.amount && p.currency === getPlatformCurrency());

    if (existing) return existing.id;

    const newPrice = await stripe.prices.create({
      product: product.id,
      unit_amount: config.amount,
      currency: getPlatformCurrency(),
      recurring: { interval: 'month' },
      metadata: { plan },
    });
    return newPrice.id;
  }

  async createSubscriptionCheckout(
    customerId: string,
    plan: PlanKey,
    successUrl: string,
    cancelUrl: string,
    metadata?: Record<string, string>,
  ) {
    const priceId = await this.findOrCreateSubscriptionPrice(plan);
    return this.createCheckoutSession(customerId, priceId, successUrl, cancelUrl, 'subscription', metadata);
  }

  /**
   * The one-time setup-fee price, created once and reused.
   *
   * Mirrors findOrCreateSubscriptionPrice deliberately, including its `limit:
   * 100` reasoning: a miss here mints a duplicate price on every checkout, and
   * duplicates are invisible until someone reconciles Stripe by hand. The
   * lookup keys on product metadata rather than name, because names are
   * editable in the Stripe dashboard and metadata is not surfaced there.
   *
   * Distinguished from the subscription price by having NO `recurring` — that
   * absence is what makes Checkout bill it once instead of monthly.
   */
  async findOrCreateSetupFeePrice(): Promise<string> {
    const stripe = await getUncachableStripeClient();

    const products = await stripe.products.list({ active: true, limit: 100 });
    let product = products.data.find(p => p.metadata?.kind === 'setup_fee');

    if (!product) {
      product = await stripe.products.create({
        name: SETUP_FEE.name,
        metadata: { kind: 'setup_fee' },
      });
    }

    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
    const existing = prices.data.find(
      p => !p.recurring && p.unit_amount === SETUP_FEE.amount && p.currency === getPlatformCurrency(),
    );
    if (existing) return existing.id;

    const newPrice = await stripe.prices.create({
      product: product.id,
      unit_amount: SETUP_FEE.amount,
      currency: getPlatformCurrency(),
      metadata: { kind: 'setup_fee' },
    });
    return newPrice.id;
  }

  /**
   * The onboarding checkout: charge the setup fee now, start the subscription on
   * a free trial, and keep the card for later.
   *
   * All three happen in ONE session on purpose. Splitting them would mean a
   * creator could pay the fee and abandon before the card was vaulted, leaving
   * an account that is entitled for 30 days and uncollectable afterwards.
   *
   * `waiveSetupFee` supports the comped accounts the client asked for. It
   * changes the session shape rather than just the amount: with nothing due,
   * Stripe would not ask for a card at all, so `payment_method_collection:
   * 'always'` is required to still vault one. Without that, a gifted account
   * reaches day 31 with no way to bill it — the exact failure the fee normally
   * prevents.
   */
  async createTrialWithSetupFeeCheckout(
    customerId: string,
    plan: PlanKey,
    successUrl: string,
    cancelUrl: string,
    metadata?: Record<string, string>,
    waiveSetupFee: boolean = false,
  ) {
    const stripe = await getUncachableStripeClient();
    const subscriptionPriceId = await this.findOrCreateSubscriptionPrice(plan);

    const lineItems: Array<{ price: string; quantity: number }> = [
      { price: subscriptionPriceId, quantity: 1 },
    ];
    if (!waiveSetupFee) {
      lineItems.push({ price: await this.findOrCreateSetupFeePrice(), quantity: 1 });
    }

    return await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'subscription',
      // Stripe owns the 30-day clock. The subscription is `trialing` for its
      // duration, which mapStripeStatus already collapses to 'active', so every
      // existing entitlement gate treats a trialing creator as subscribed with
      // no new entitlement code.
      subscription_data: { trial_period_days: TRIAL_DAYS },
      // Redundant when the fee is charged (an amount due always collects a
      // card), load-bearing when it is waived. Set unconditionally so the two
      // paths cannot drift.
      payment_method_collection: 'always',
      success_url: successUrl,
      cancel_url: cancelUrl,
      ...(metadata ? { metadata } : {}),
    });
  }

  async createBillingPortal(customerId: string, returnUrl: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  async createSurplusInvoice(customerId: string, amount: number, description: string) {
    const stripe = await getUncachableStripeClient();
    await stripe.invoiceItems.create({
      customer: customerId,
      amount: Math.round(amount * 100),
      currency: getPlatformCurrency(),
      description,
    });
    const invoice = await stripe.invoices.create({
      customer: customerId,
      auto_advance: true,
      collection_method: 'charge_automatically',
      metadata: { type: 'surplus' },
    });
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    return finalized;
  }


  /**
   * Apply a CREDIT to a customer's Stripe balance — the mechanism behind
   * "subsidise the monthly subscription fee with tokens".
   *
   * ⚠ SIGN. Stripe's convention (node_modules/stripe/types/CustomerBalanceTransactions.d.ts):
   * "A negative value is a credit for the customer's balance, and a positive value
   * is a debit." So a $49 subsidy is `amount: -4900`. Passing +4900 would BILL the
   * customer an extra $49 — the most expensive one-character mistake available on
   * this path. `creditCents` is taken as a POSITIVE number here and negated below,
   * so no caller ever has to reason about the sign; a unit test pins it.
   *
   * Why a customer credit balance and not a coupon or a discounted price: a coupon
   * is a discount on the PRICE and recurs (or needs per-customer promo-code
   * plumbing); a discounted price forks the catalogue and breaks
   * findOrCreateSubscriptionPrice's `unit_amount === config.amount` match, minting
   * a duplicate price on every checkout. The credit balance is a customer-level
   * ledger Stripe drains automatically at invoice finalization, leaves the
   * subscription price untouched, and rolls any excess to the next invoice.
   *
   * `idempotencyKey` (the wallet ledger row id) makes a retry after a timeout
   * return the ORIGINAL balance transaction rather than double-crediting.
   */
  async applyCustomerCreditCents(
    customerId: string,
    creditCents: number,
    description: string,
    idempotencyKey: string,
    metadata?: Record<string, string>,
  ) {
    if (!Number.isInteger(creditCents) || creditCents <= 0) {
      throw new Error(`applyCustomerCreditCents: creditCents must be a positive integer, got ${creditCents}`);
    }
    const stripe = await getUncachableStripeClient();
    return await stripe.customers.createBalanceTransaction(
      customerId,
      {
        amount: -creditCents, // NEGATIVE = credit. See the sign warning above.
        currency: getPlatformCurrency(),
        description,
        ...(metadata ? { metadata } : {}),
      },
      { idempotencyKey },
    );
  }

  async createCustomer(email: string, userId: string, name?: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.customers.create({
      email,
      name,
      metadata: { userId },
    });
  }

  async createCheckoutSession(
    customerId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
    mode: 'payment' | 'subscription' = 'payment',
    metadata?: Record<string, string>,
  ) {
    const stripe = await getUncachableStripeClient();
    return await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode,
      success_url: successUrl,
      cancel_url: cancelUrl,
      ...(metadata ? { metadata } : {}),
    });
  }

  /**
   * `amount` is in MAJOR UNITS (e.g. 49.00 = $49.00) — it is multiplied by 100 here.
   * Never pass cents; doing so overcharges by 100x.
   */
  async createPaymentIntent(amount: number, currency: string = getPlatformCurrency(), metadata?: Record<string, string>) {
    const stripe = await getUncachableStripeClient();
    return await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency,
      metadata,
    });
  }

  /**
   * Fetch a PaymentIntent so the server can confirm a payment really succeeded
   * instead of trusting a client-supplied id. Returns null if it can't be read.
   */
  async retrievePaymentIntent(paymentIntentId: string) {
    try {
      const stripe = await getUncachableStripeClient();
      return await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (error) {
      console.error("[Stripe] retrievePaymentIntent failed:", (error as Error)?.message);
      return null;
    }
  }

  async createConnectAccount(email: string, userId: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.accounts.create({
      type: 'express',
      email,
      metadata: { userId },
      capabilities: {
        transfers: { requested: true },
      },
    });
  }

  async createConnectAccountLink(accountId: string, refreshUrl: string, returnUrl: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
  }

  async createTransfer(amount: number, destinationAccountId: string, metadata?: Record<string, string>) {
    const stripe = await getUncachableStripeClient();
    return await stripe.transfers.create({
      amount: Math.round(amount * 100),
      currency: getPlatformCurrency(),
      destination: destinationAccountId,
      metadata,
    });
  }

  /**
   * Transfer an exact integer-cents amount to a connected account. The
   * idempotencyKey (e.g. the payout id) makes a retried run safe — Stripe returns
   * the original transfer instead of creating a duplicate.
   */
  async createTransferCents(
    amountCents: number,
    destinationAccountId: string,
    idempotencyKey: string,
    metadata?: Record<string, string>,
  ) {
    const stripe = await getUncachableStripeClient();
    return await stripe.transfers.create(
      {
        amount: Math.round(amountCents),
        currency: getPlatformCurrency(),
        destination: destinationAccountId,
        metadata,
      },
      { idempotencyKey },
    );
  }

  async getConnectAccount(accountId: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.accounts.retrieve(accountId);
  }

  async createLoginLink(accountId: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.accounts.createLoginLink(accountId);
  }
}

export const stripeService = new StripeService();
