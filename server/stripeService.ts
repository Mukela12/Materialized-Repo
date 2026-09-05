import { getUncachableStripeClient } from './stripeClient';
import { getPlatformCurrency, feeInvoiceAutoCharge } from './feeConfig';

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

  /**
   * Vault a card WITHOUT selling anything — Checkout in `setup` mode.
   *
   * Needed because a card could previously only be captured as a side effect of
   * subscribing. An account on permanent free access never subscribes, so it
   * never had a payment method, so overage could never be charged to it. The
   * client asked to "link my personal credit card to this Creator profile for
   * overage" and there was no way to do it.
   *
   * Same gap as a brand with no Stripe customer accruing fees nobody can
   * invoice. A free account is not a no-payment-method account.
   */
  async createCardSetupCheckout(customerId: string, successUrl: string, cancelUrl: string, metadata?: Record<string, string>) {
    const stripe = await getUncachableStripeClient();
    return await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: customerId,
      // Vault it as the customer's default, so a later invoice or overage charge
      // finds it without anyone choosing.
      setup_intent_data: { metadata: { ...(metadata ?? {}), purpose: 'card_on_file' } },
      success_url: successUrl,
      cancel_url: cancelUrl,
      ...(metadata ? { metadata } : {}),
    });
  }

  /** What card, if any, this customer has on file. */
  async getDefaultPaymentMethod(customerId: string) {
    const stripe = await getUncachableStripeClient();
    const customer = await stripe.customers.retrieve(customerId);
    if ((customer as any).deleted) return null;
    const defaultPm = (customer as any).invoice_settings?.default_payment_method;
    if (!defaultPm) {
      // Fall back to any attached card — a SetupIntent may have attached one
      // without it becoming the invoice default yet.
      const list = await stripe.paymentMethods.list({ customer: customerId, limit: 1 });
      const pm = list.data[0];
      return pm ? { id: pm.id, brand: pm.card?.brand ?? null, last4: pm.card?.last4 ?? null, isDefault: false } : null;
    }
    const pm = await stripe.paymentMethods.retrieve(
      typeof defaultPm === 'string' ? defaultPm : defaultPm.id,
    );
    return { id: pm.id, brand: pm.card?.brand ?? null, last4: pm.card?.last4 ?? null, isDefault: true };
  }

  /** Make a vaulted card the invoice default, so later charges find it. */
  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string) {
    const stripe = await getUncachableStripeClient();
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }

  async createBillingPortal(customerId: string, returnUrl: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  /**
   * `amount` is in MAJOR UNITS (e.g. 1 = $1.00) — multiplied by 100 here.
   *
   * ORDER MATTERS, AND THE OBVIOUS ORDER IS WRONG.
   *
   * This previously created the invoice item first and then the invoice, relying
   * on the new invoice sweeping up pending items. It does not: `invoices.create`
   * defaults to pending_invoice_items_behavior 'exclude', so the item stayed
   * unattached and the invoice was finalised with ZERO line items. A $0 invoice
   * is auto-marked `paid`, so the call returned a paid invoice and the caller
   * reported success — while nobody was charged and the real amount floated as a
   * pending item, waiting to ambush the customer on their next subscription
   * invoice. Verified against Stripe test mode: a $1 surplus produced
   * `total=0 status=paid lines=0` with the $1 item attached to nothing.
   *
   * Creating the invoice FIRST and naming it on the item removes the ambiguity
   * entirely — the line cannot land anywhere else.
   */
  async createSurplusInvoice(customerId: string, amount: number, description: string) {
    const stripe = await getUncachableStripeClient();

    const invoice = await stripe.invoices.create({
      customer: customerId,
      auto_advance: true,
      collection_method: 'charge_automatically',
      metadata: { type: 'surplus' },
    });

    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      amount: Math.round(amount * 100),
      currency: getPlatformCurrency(),
      description,
    });

    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);

    // A finalised surplus invoice with no lines means the item did not attach —
    // the failure this function was rewritten to fix. Fail loudly rather than
    // returning a $0 "paid" invoice that reads as success.
    if (!finalized.total) {
      throw new Error(
        `Surplus invoice ${finalized.id} finalised with a zero total — the line item did not attach.`,
      );
    }
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

  /**
   * `forSelling` requests `card_payments` as well as `transfers`.
   *
   * Publishers only ever RECEIVE money, so transfers alone is right for them and
   * asks for less verification. A brand selling through in-video checkout has to
   * ACCEPT a card, which is a separate capability Stripe verifies separately —
   * request it up front or the first charge fails with the account looking
   * perfectly healthy.
   */
  async createConnectAccount(email: string, userId: string, forSelling = false) {
    const stripe = await getUncachableStripeClient();
    return await stripe.accounts.create({
      type: 'express',
      email,
      metadata: { userId, ...(forSelling ? { role: 'brand_seller' } : {}) },
      capabilities: {
        transfers: { requested: true },
        ...(forSelling ? { card_payments: { requested: true } } : {}),
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

  // ── Marketplace fee invoices ────────────────────────────────────────────────
  //
  // Billing a brand for the 15% we are owed on sales they made on their own
  // storefront. This is NOT an application fee and cannot be — Materialized is
  // not in that payment path. See server/feeAccruals.ts.
  //
  // Collection method is `send_invoice`, not `charge_automatically`: the brand
  // receives a hosted invoice with a due date rather than having their card
  // silently charged for an amount they have not seen before.

  /**
   * Create the fee invoice.
   *
   * TWO COLLECTION MODES, and the difference is who has to do something.
   *
   *   send_invoice          Stripe emails a hosted invoice with a due date. The
   *                         brand chooses to pay it. Someone has to chase the
   *                         ones that do not.
   *   charge_automatically  Charged to the card the brand already has on file
   *                         for their subscription. Nobody touches it, which is
   *                         the only version that survives thousands of brands.
   *
   * Auto-charge is the platform default (FEE_INVOICE_COLLECTION), because the
   * alternative does not scale and because these brands are already paying us a
   * subscription on that same card.
   *
   * It is still an invoice, not a Stripe application fee: the money is collected
   * FROM the brand after the sale, rather than withheld from the shopper's
   * payment as it passes through. That distinction matters for what we tell
   * brands, and it is why `auto_advance` stays false either way — the invoice is
   * created as a draft and finalising it is a separate, deliberate call.
   */
  async createFeeInvoice(args: {
    customerId: string;
    currency: string;
    description: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
    daysUntilDue: number;
    /** Defaults to the platform setting; pass explicitly to override per run. */
    autoCharge?: boolean;
  }) {
    const stripe = await getUncachableStripeClient();
    const autoCharge = args.autoCharge ?? feeInvoiceAutoCharge();

    return await stripe.invoices.create({
      customer: args.customerId,
      currency: args.currency,
      ...(autoCharge
        ? { collection_method: 'charge_automatically' as const }
        : { collection_method: 'send_invoice' as const, days_until_due: args.daysUntilDue }),
      auto_advance: false,
      description: args.description,
      metadata: { ...args.metadata, collection: autoCharge ? 'auto_charge' : 'send_invoice' },
    }, { idempotencyKey: args.idempotencyKey });
  }

  /**
   * Overage as a line on the NEXT subscription invoice.
   *
   * Passing `subscription` is the whole mechanism: Stripe holds the item as
   * pending against that subscription and sweeps it into the upcoming renewal
   * invoice, which charges the card already on file. No standalone invoice, no
   * separate charge for the customer to recognise — one bill, one extra line.
   *
   * Distinct from createFeeInvoiceItem, which names an explicit invoice: the
   * fee flow builds its own invoice and finalises it by hand, while overage
   * deliberately rides an invoice the subscription was creating anyway.
   */
  /**
   * Vault a card with no purchase: Checkout in `setup` mode.
   *
   * Used to satisfy the free-access card requirement. The SetupIntent stores
   * the card; the checkout.session.completed handler promotes it to the
   * customer's default and marks the account — nothing is charged, which is
   * the point, and also why the consent language lives on the page that sends
   * people here rather than on a receipt.
   */
  async createCardSetupSession(args: {
    customerId: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }) {
    const stripe = await getUncachableStripeClient();
    return await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: args.customerId,
      payment_method_types: ['card'],
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      ...(args.metadata ? { metadata: args.metadata } : {}),
    });
  }

  async createSubscriptionOverageItem(args: {
    customerId: string;
    subscriptionId: string;
    amountCents: number;
    currency: string;
    description: string;
    idempotencyKey: string;
  }) {
    const stripe = await getUncachableStripeClient();
    return await stripe.invoiceItems.create({
      customer: args.customerId,
      subscription: args.subscriptionId,
      amount: args.amountCents,
      currency: args.currency,
      description: args.description,
    }, { idempotencyKey: args.idempotencyKey });
  }

  async createFeeInvoiceItem(args: {
    customerId: string;
    invoiceId: string;
    amountCents: number;
    currency: string;
    description: string;
    idempotencyKey: string;
  }) {
    const stripe = await getUncachableStripeClient();
    // NAMES THE INVOICE. Creating the item first and letting the invoice sweep
    // it up does not work — invoices.create defaults to
    // pending_invoice_items_behavior 'exclude', which once produced a finalised
    // $0 invoice marked paid while the real amount floated as a pending item.
    // See the note on createSurplusInvoice above.
    await stripe.invoiceItems.create({
      customer: args.customerId,
      invoice: args.invoiceId,
      amount: args.amountCents,
      currency: args.currency,
      description: args.description,
    }, { idempotencyKey: args.idempotencyKey });
  }

  /**
   * The in-video checkout. THIS is where the 15% is genuinely retained.
   *
   * A DESTINATION CHARGE: the platform creates the charge, Stripe moves the
   * brand their share automatically via `transfer_data.destination`, and keeps
   * `application_fee_amount` for us in the same movement. Nothing is invoiced
   * afterwards and nothing can go unpaid, because the split happens at the
   * moment the shopper's card is charged.
   *
   * `on_behalf_of` makes the BRAND the merchant of record. That is not cosmetic:
   * it decides whose name appears on the shopper's statement, whose country sets
   * the settlement currency, and who owns the customer relationship for tax and
   * refunds. The brand keeps all of that; MTRLZD is the technology in the middle.
   *
   * `ui_mode: 'embedded'` returns a client secret to mount inside the video
   * overlay, so the shopper never leaves the brand's page. Stripe's own guidance
   * prefers Checkout over assembling a Payment Element by hand.
   *
   * AMOUNTS ARE CALLER-SUPPLIED IN CENTS AND MUST COME FROM THE DATABASE. The
   * caller reads price_cents from the overlay row; a client-supplied price is a
   * shopper choosing what to pay.
   */
  async createInVideoCheckout(args: {
    brandAccountId: string;
    productName: string;
    imageUrl?: string | null;
    amountCents: number;
    applicationFeeCents: number;
    currency: string;
    returnUrl: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }) {
    const stripe = await getUncachableStripeClient();
    return await stripe.checkout.sessions.create({
      mode: 'payment',
      ui_mode: 'embedded',
      return_url: args.returnUrl,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: args.currency,
          unit_amount: args.amountCents,
          product_data: {
            name: args.productName,
            ...(args.imageUrl ? { images: [args.imageUrl] } : {}),
          },
        },
      }],
      payment_intent_data: {
        application_fee_amount: args.applicationFeeCents,
        transfer_data: { destination: args.brandAccountId },
        on_behalf_of: args.brandAccountId,
        metadata: args.metadata,
      },
      metadata: args.metadata,
    }, { idempotencyKey: args.idempotencyKey });
  }

  /** Whether a connected account can actually accept a card today. */
  async getConnectChargeStatus(accountId: string) {
    const stripe = await getUncachableStripeClient();
    const acct = await stripe.accounts.retrieve(accountId);
    return {
      chargesEnabled: !!acct.charges_enabled,
      payoutsEnabled: !!acct.payouts_enabled,
      detailsSubmitted: !!acct.details_submitted,
    };
  }

  async finalizeFeeInvoice(invoiceId: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.invoices.finalizeInvoice(invoiceId);
  }

  /**
   * Find an invoice already raised for this fee-invoice id.
   *
   * Stripe only retains idempotency keys for 24 hours; past that, replaying the
   * same key creates a SECOND invoice. A run resumed a day later therefore looks
   * the invoice up by the id stamped into its metadata instead.
   */
  async findFeeInvoiceByFeeInvoiceId(customerId: string, feeInvoiceId: string) {
    const stripe = await getUncachableStripeClient();
    const list = await stripe.invoices.list({ customer: customerId, limit: 100 });
    const match = list.data.find((inv) => inv.metadata?.feeInvoiceId === feeInvoiceId);
    return match ?? null;
  }
}

export const stripeService = new StripeService();
