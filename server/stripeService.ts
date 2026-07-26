import { getUncachableStripeClient } from './stripeClient';
import { getPlatformCurrency } from './feeConfig';

const PLAN_CONFIG = {
  starter: { name: 'Materialized Starter Plan', amount: 24900 },
  pro:     { name: 'Materialized Pro Plan',     amount: 49900 },
} as const;

export class StripeService {
  async findOrCreateSubscriptionPrice(plan: 'starter' | 'pro'): Promise<string> {
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

    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 10 });
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
    plan: 'starter' | 'pro',
    successUrl: string,
    cancelUrl: string,
    metadata?: Record<string, string>,
  ) {
    const priceId = await this.findOrCreateSubscriptionPrice(plan);
    return this.createCheckoutSession(customerId, priceId, successUrl, cancelUrl, 'subscription', metadata);
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
   * `amount` is in MAJOR UNITS (e.g. 45.00 = €45.00) — it is multiplied by 100 here.
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
