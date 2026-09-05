import Stripe from 'stripe';
import { computeCreatorBonus } from "./creatorBonus";
import { getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';
import { stripeService } from './stripeService';
import { recordSaleCommissions } from './commissions';
import { recordFeeAccrual } from './feeAccruals';
import { computeSaleSplit } from './feeConfig';
import { toCents, centsToAmount } from './feeConfig';
import { PLAN_CONFIG, isPlanKey, type PlanKey } from './stripeService';
import { mintBrandConversionToken } from './wallet';

export const DEFAULT_PLAN: PlanKey = 'starter';

/**
 * Amount (in cents) → plan key. Derived from PLAN_CONFIG so a new tier can never
 * be added to the catalogue without the webhook fallback learning about it —
 * a missing entry here silently records the subscriber on DEFAULT_PLAN.
 */
export const PLAN_AMOUNT_FALLBACK: Record<number, PlanKey> = Object.fromEntries(
  (Object.entries(PLAN_CONFIG) as [PlanKey, { amount: number }][]).map(
    ([plan, config]) => [config.amount, plan],
  ),
) as Record<number, PlanKey>;

export function mapStripeStatus(stripeStatus: string): 'active' | 'past_due' | 'cancelled' {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
    default:
      return 'cancelled';
  }
}

/**
 * Resolve a plan AND report whether it was genuinely identified or fell back.
 *
 * `resolved: false` means neither price/product metadata nor the exact-amount map
 * matched, so the returned plan is DEFAULT_PLAN — which is 'starter', the ONLY
 * token-qualifying tier. Anything that pays out money must check this flag:
 * otherwise a subscription on a custom price with no metadata (e.g. $4,990/yr set
 * up by hand in the Stripe dashboard) clears the $249 amount gate and mints a
 * token despite not being the $249 Brand tier.
 */
export async function resolvePlanFromSubscription(
  subscription: Stripe.Subscription,
): Promise<{ plan: PlanKey; resolved: boolean }> {
  const item = subscription.items?.data?.[0];
  if (!item) return { plan: DEFAULT_PLAN, resolved: false };
  const price = item.price as Stripe.Price;

  if (isPlanKey(price.metadata?.plan)) return { plan: price.metadata.plan, resolved: true };

  if (typeof price.product === 'string') {
    try {
      const stripe = await getUncachableStripeClient();
      const product = await stripe.products.retrieve(price.product);
      if (isPlanKey(product.metadata?.plan)) return { plan: product.metadata.plan, resolved: true };
    } catch {
      /* fall through to the amount map */
    }
  } else if (price.product && typeof price.product === 'object') {
    const product = price.product as Stripe.Product;
    if (isPlanKey(product.metadata?.plan)) return { plan: product.metadata.plan, resolved: true };
  }

  const byAmount = PLAN_AMOUNT_FALLBACK[price.unit_amount ?? 0];
  if (byAmount) return { plan: byAmount, resolved: true };

  return { plan: DEFAULT_PLAN, resolved: false };
}

export async function planFromSubscription(subscription: Stripe.Subscription): Promise<PlanKey> {
  const item = subscription.items?.data?.[0];
  if (!item) return DEFAULT_PLAN;

  const price = item.price as Stripe.Price;

  if (isPlanKey(price.metadata?.plan)) {
    return price.metadata.plan;
  }

  if (typeof price.product === 'string') {
    try {
      const stripe = await getUncachableStripeClient();
      const product = await stripe.products.retrieve(price.product);
      if (isPlanKey(product.metadata?.plan)) {
        return product.metadata.plan;
      }
    } catch {
    }
  } else if (price.product && typeof price.product === 'object') {
    const product = price.product as Stripe.Product;
    if (isPlanKey(product.metadata?.plan)) {
      return product.metadata.plan;
    }
  }

  const byAmount = PLAN_AMOUNT_FALLBACK[price.unit_amount ?? 0];
  if (byAmount) return byAmount;

  // No metadata and no amount match — this used to resolve silently to 'starter'.
  // Log it: a wrong tier here is invisible in the app but keeps billing correctly.
  console.warn(
    `[Webhook] planFromSubscription: could not resolve plan for price ${price.id} ` +
    `(unit_amount=${price.unit_amount}); defaulting to '${DEFAULT_PLAN}'`,
  );
  return DEFAULT_PLAN;
}

export function subscriptionPeriodEnd(subscription: Stripe.Subscription): Date {
  const item = subscription.items.data[0];
  const ts = item?.current_period_end ?? 0;
  return new Date(ts * 1000);
}

export function extractCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
): string | null {
  if (!customer) return null;
  if (typeof customer === 'string') return customer;
  return customer.id;
}

export function extractSubscriptionId(
  sub: string | Stripe.Subscription | null
): string | null {
  if (!sub) return null;
  if (typeof sub === 'string') return sub;
  return sub.id;
}

/**
 * A shopper completed an in-video purchase.
 *
 * The money has already moved and the fee is already ours — Stripe withheld it
 * as an application fee on the charge. Nothing here collects anything; it
 * records what happened.
 *
 * IDEMPOTENT VIA THE ORDER ROW. markVideoOrderPaid only flips a row that is
 * still `pending`, so a retried delivery returns null and this returns early.
 * Without that, a Stripe retry would write the commissions twice.
 */
async function handleInVideoOrderCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const meta = session.metadata ?? {};
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id ?? null;

  const order = await storage.markVideoOrderPaid(session.id, paymentIntentId);
  if (!order) return; // already handled, or unknown session

  const saleAmount = (order.amountCents / 100).toFixed(2);

  // Same helper the store-webhook path uses, so an in-video sale and an
  // on-store sale cannot disagree about what a creator or publisher earns.
  await recordSaleCommissions(
    storage,
    saleAmount,
    {
      videoId: order.videoId,
      creatorId: order.creatorId,
      affiliateId: order.affiliateId,
      campaignAffiliateId: null,
      resolvedCommissionRate: null,
      externalOrderId: session.id,
      storeConnectionId: null,
    },
    null,
  );

  // Recorded as ALREADY COLLECTED. The fee was withheld at the charge, so an
  // `accrued` row here would make the monthly invoice run bill this brand a
  // second time for money we already have.
  await recordFeeAccrual(storage as any, {
    // NULL, not the video id. This column is a foreign key into
    // store_connections; passing a video id violated it on every in-video sale,
    // and the error was swallowed by the webhook dispatcher so the platform's
    // revenue row was silently never written. See migrations/0017.
    storeConnectionId: null,
    brandUserId: order.brandUserId,
    externalOrderId: session.id,
    videoId: order.videoId,
    currency: order.currency,
    saleAmount,
    attributionState: 'attributed',
    split: computeSaleSplit(order.amountCents, {
      hasPublisher: !!order.affiliateId && order.affiliateId !== order.creatorId,
    }),
    alreadyCollected: true,
  });

  console.log(
    `[Webhook] in-video order ${order.id} paid — ${saleAmount} ${order.currency}, ` +
    `fee ${(order.applicationFeeCents / 100).toFixed(2)} retained at charge`,
  );
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  // Two kinds of completed checkout arrive here now. An in-video purchase is
  // mode 'payment' and carries our marker; subscriptions are everything else.
  if (session.mode === 'payment' && session.metadata?.kind === 'in_video_order') {
    return handleInVideoOrderCompleted(session);
  }

  // A card vaulted without a subscription. Stripe attaches it to the customer
  // but does NOT make it the invoice default, so a later overage charge would
  // find no default and fail — the card would be on file and unusable.
  if (session.mode === 'setup') {
    const customerId = extractCustomerId(session.customer);
    const si = session.setup_intent;
    const setupIntentId = typeof si === 'string' ? si : si?.id ?? null;
    if (!customerId || !setupIntentId) return;

    const stripe = await getUncachableStripeClient();
    const intent = await stripe.setupIntents.retrieve(setupIntentId);
    const pm = typeof intent.payment_method === 'string'
      ? intent.payment_method
      : intent.payment_method?.id ?? null;
    if (!pm) return;

    await stripeService.setDefaultPaymentMethod(customerId, pm);
    // The entitlement gate reads this flag; the vaulted card is what free
    // access is conditional on, so the mark and the vault happen together.
    const cardUserId = session.metadata?.userId
      ?? (await storage.getUserByStripeCustomerId(customerId))?.id;
    if (cardUserId) {
      try {
        await storage.updateUser(cardUserId, { cardOnFile: true, cardOnFileAt: new Date() } as any);
      } catch (err) {
        console.warn('[Webhook] could not mark card on file for', cardUserId, err);
      }
    }
    console.log(`[Webhook] card on file set as default for customer ${customerId}`);
    return;
  }
  /**
   * The standalone admin setup fee.
   *
   * Keyed on metadata.purpose, not on mode alone — other one-time payments share
   * `payment` mode, and marking an account fee-settled because it bought
   * something else would hand out access nobody paid for.
   */
  if (session.mode === 'payment' && session.metadata?.purpose === 'setup_fee') {
    if (session.payment_status !== 'paid') {
      console.warn(`[Webhook] setup_fee session ${session.id} completed but payment_status=${session.payment_status}`);
      return;
    }
    const feeUserId = session.metadata?.userId
      ?? (await storage.getUserByStripeCustomerId(extractCustomerId(session.customer) ?? ''))?.id;
    if (!feeUserId) {
      console.warn('[Webhook] setup_fee: no user on session', session.id);
      return;
    }
    await storage.updateUser(feeUserId, { setupFeePaid: true, setupFeePaidAt: new Date(), cardOnFile: true, cardOnFileAt: new Date() } as any);
    console.log(`[Webhook] setup fee settled for user ${feeUserId} (session ${session.id})`);
    return;
  }

  if (session.mode !== 'subscription') return;

  const customerId = extractCustomerId(session.customer);
  const subscriptionId = extractSubscriptionId(session.subscription);

  if (!customerId || !subscriptionId) {
    console.warn('[Webhook] checkout.session.completed: missing customer or subscription ID');
    return;
  }

  const metaUserId = session.metadata?.userId;
  const metaPlan = isPlanKey(session.metadata?.plan) ? session.metadata.plan : undefined;

  let userId: string | undefined = metaUserId;
  if (!userId) {
    const user = await storage.getUserByStripeCustomerId(customerId);
    userId = user?.id;
  }
  if (!userId) {
    console.warn('[Webhook] checkout.session.completed: no user found for customer', customerId);
    return;
  }

  /**
   * A subscription checkout carries the setup fee as a line item unless it was
   * explicitly waived, and a waiver is a decision not to collect it. Either way
   * the obligation is closed, so the account must not be held behind it.
   */
  try {
    await storage.updateUser(userId, { setupFeePaid: true, setupFeePaidAt: new Date(), cardOnFile: true, cardOnFileAt: new Date() } as any);
  } catch (err) {
    // Never let the fee bookkeeping cost us the subscription record. A missing
    // fee mark is recoverable by hand; a lost subscription upsert means an
    // account that paid and has nothing to show for it.
    console.warn('[Webhook] could not mark setup fee settled for', userId, err);
  }

  const stripe = await getUncachableStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price.product'],
  });
  const currentPeriodEnd = subscriptionPeriodEnd(subscription);
  const plan = metaPlan ?? (await planFromSubscription(subscription));

  /**
   * Promote the card just captured to be the CUSTOMER's default payment method.
   *
   * Checkout sets it as the SUBSCRIPTION's default, which is enough for the
   * monthly invoices — but overage is billed as a standalone invoice against the
   * customer (see createSurplusInvoice), and a standalone `charge_automatically`
   * invoice resolves its card from customer.invoice_settings.default_payment_method
   * only. It cannot reach a subscription's default.
   *
   * Verified against Stripe test mode: after a completed setup-fee checkout the
   * subscription default was set and the customer default was NOT, so every
   * overage invoice would have gone uncollected. Without this, "card on file for
   * overage" is not true no matter how the card was captured.
   *
   * Best-effort: a failure here must not lose the subscription write below, which
   * is what actually grants access.
   */
  const capturedPm = subscription.default_payment_method;
  if (capturedPm) {
    const pmId = typeof capturedPm === 'string' ? capturedPm : capturedPm.id;
    try {
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: pmId },
      });
    } catch (err) {
      console.error('[Webhook] could not set customer default payment method:', err);
    }
  }

  await storage.upsertBrandSubscription({
    userId,
    plan,
    status: 'active',
    stripeSubscriptionId: subscriptionId,
    currentPeriodEnd,
  });

  console.log(`[Webhook] Subscription activated — user ${userId}, plan ${plan}, ends ${currentPeriodEnd.toISOString()}`);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const customerId = extractCustomerId(subscription.customer);
  if (!customerId) return;

  const user = await storage.getUserByStripeCustomerId(customerId);
  if (!user) {
    console.warn('[Webhook] customer.subscription.updated: no user found for customer', customerId);
    return;
  }

  const stripe = await getUncachableStripeClient();
  const fullSub = await stripe.subscriptions.retrieve(subscription.id, {
    expand: ['items.data.price.product'],
  });

  const plan = await planFromSubscription(fullSub);
  const status = mapStripeStatus(fullSub.status);
  const currentPeriodEnd = subscriptionPeriodEnd(fullSub);

  await storage.upsertBrandSubscription({
    userId: user.id,
    plan,
    status,
    stripeSubscriptionId: fullSub.id,
    currentPeriodEnd,
  });

  console.log(`[Webhook] Subscription updated — user ${user.id}, plan ${plan}, status ${status}`);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const customerId = extractCustomerId(subscription.customer);
  if (!customerId) return;

  const user = await storage.getUserByStripeCustomerId(customerId);
  if (!user) return;

  const existing = await storage.getBrandSubscription(user.id);

  await storage.upsertBrandSubscription({
    userId: user.id,
    plan: (existing?.plan ?? DEFAULT_PLAN) as PlanKey,
    status: 'cancelled',
    stripeSubscriptionId: subscription.id,
    currentPeriodEnd: undefined,
  });

  console.log(`[Webhook] Subscription cancelled — user ${user.id}`);
}

// Stripe SDK v20 removed the top-level `subscription` field from Invoice type,
// but it is still present in webhook payloads — access via the raw object.
type InvoiceWithSubscription = Stripe.Invoice & {
  subscription: string | Stripe.Subscription | null;
};

/**
 * Read an invoice's subscription id across Stripe API versions.
 *
 * Stripe moved this field in the 2025-03-31.basil release: the top-level
 * `invoice.subscription` became `invoice.parent.subscription_details.subscription`.
 *
 * This matters because nothing here pins an API version — getUncachableStripeClient
 * constructs `new Stripe(secretKey)` with no apiVersion, so requests follow the
 * ACCOUNT default, and each webhook ENDPOINT carries its own version chosen when it
 * was created. Those are independent. Creating a fresh endpoint (which is exactly
 * what switching to live mode requires, since endpoints are per-mode) gets the
 * account's current version, which may be newer than the test endpoint's.
 *
 * The failure mode is silence, not an error. Both callers below do
 * `if (!subscriptionId) return;`, so a null read means renewals stop extending
 * periods and stop minting tokens, with nothing logged and no exception — the
 * quietest possible way for a live cutover to fail. Reading every known shape
 * costs nothing and removes the dependency on which version an endpoint happens
 * to carry.
 */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as InvoiceWithSubscription).subscription;
  if (legacy) return extractSubscriptionId(legacy);

  // 2025-03-31.basil and later.
  const parent = (invoice as any).parent?.subscription_details?.subscription;
  if (parent) return extractSubscriptionId(parent);

  // Last resort: line items carry it on both shapes.
  const line = (invoice as any).lines?.data?.[0]?.subscription
    ?? (invoice as any).lines?.data?.[0]?.parent?.subscription_item_details?.subscription;
  if (line) return extractSubscriptionId(line);

  return null;
}

// Stripe SDK v20 likewise dropped `invoice` from the Charge type, but it is still
// present in webhook payloads — access via the raw object.
type ChargeWithInvoice = Stripe.Charge & {
  invoice: string | Stripe.Invoice | null;
};

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  const customerId = extractCustomerId(invoice.customer);
  if (!customerId) return;

  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;

  const user = await storage.getUserByStripeCustomerId(customerId);
  if (!user) return;

  const stripe = await getUncachableStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price.product'],
  });
  const currentPeriodEnd = subscriptionPeriodEnd(subscription);
  // `resolved` gates the MINT only — billing still uses the resolved-or-default
  // plan exactly as before, so an unidentifiable price keeps the subscription
  // working; it just can't hand out money.
  const { plan, resolved: planResolved } = await resolvePlanFromSubscription(subscription);

  await storage.upsertBrandSubscription({
    userId: user.id,
    plan,
    status: 'active',
    stripeSubscriptionId: subscriptionId,
    currentPeriodEnd,
  });

  console.log(`[Webhook] Payment succeeded — user ${user.id}, period ends ${currentPeriodEnd.toISOString()}`);

  // ── Token wallet: the ONE earn trigger ────────────────────────────────────
  //
  // This is the only place a brand-conversion token is minted, and it is hooked
  // HERE rather than on checkout.session.completed on purpose:
  //
  //   * It is the only handler guaranteed to be preceded by money actually
  //     moving. checkout.session.completed fires for trials and for subscriptions
  //     later voided; customer.subscription.updated fires on status churn with no
  //     payment. Minting a $49 liability against a $249 subscription that never
  //     paid is precisely the failure to avoid.
  //   * It also covers subscriptions created OUTSIDE Checkout — billing portal,
  //     Stripe dashboard, imports — which handleCheckoutCompleted never sees.
  //   * Firing again on every monthly renewal is harmless BY DESIGN. Idempotency
  //     comes from the DB unique indexes, not from picking a handler that happens
  //     to fire once, so we deliberately hook the most reliable handler rather
  //     than the rarest. Renewal #2..#N trip the index and no-op.
  //
  // Consequence worth knowing: a brand in a Stripe trial mints nothing until the
  // first real charge, even though mapStripeStatus() already shows them 'active'
  // in-app. That is correct for a money reward.
  await mintBrandConversionTokenSafely({
    subscriberUserId: user.id,
    plan,
    // Stripe's own figure, and the ONLY untrusted-input-proof part of the mint
    // gate: `plan` can resolve to DEFAULT_PLAN ('starter', the one qualifying tier)
    // for a price with no metadata, but a $10 invoice still cannot clear a $249
    // bar. mintBrandConversionToken requires >= PLAN_CONFIG[plan].amount, so a $0
    // trial and a mid-cycle proration both mint nothing.
    amountPaidCents: invoice.amount_paid ?? 0,
    stripeSubscriptionId: subscriptionId,
    planResolved,
  });

  /**
   * And the creator's 5% of this payment.
   *
   * Separate from the token mint above on purpose. That is one $49 token per
   * brand, ever; this is cash, on EVERY paid invoice, and it does not care
   * which tier the brand is on — 5% of what was paid is well defined whatever
   * the plan, so it deliberately does not inherit the token's plan gate.
   *
   * It is also not gated on `planResolved`. The token refuses to mint on an
   * unidentified plan because its $49 is a flat amount that a custom price
   * could clear without deserving; a percentage of the actual payment has no
   * such hole — an unrecognised $10 price simply earns 50 cents.
   */
  await recordCreatorBonusSafely({
    subscriberUserId: user.id,
    amountPaidCents: invoice.amount_paid ?? 0,
    stripeInvoiceId: invoice.id ?? "",
    stripeSubscriptionId: subscriptionId,
  });
}

/**
 * Bonus wrapper that CANNOT throw, for the same reason the mint has one:
 * dispatchStripeEvent swallows handler errors, so an uncaught failure here
 * would be entirely silent.
 */
async function recordCreatorBonusSafely(args: {
  subscriberUserId: string;
  amountPaidCents: number;
  stripeInvoiceId: string;
  stripeSubscriptionId: string | null;
}): Promise<void> {
  // No invoice id means no idempotency key, and without one a Stripe redelivery
  // pays the creator twice. Refuse rather than record something unrepeatable.
  if (!args.stripeInvoiceId) {
    console.warn('[Bonus] No invoice id on invoice.payment_succeeded — skipped');
    return;
  }
  try {
    const result = await computeCreatorBonus(storage as any, args);
    if (!result.earned) {
      if (result.reason !== 'no_owned_brand' && result.reason !== 'no_attribution') {
        console.log(`[Bonus] None for invoice ${args.stripeInvoiceId} — ${result.reason}`);
      }
      return;
    }
    const row = await storage.recordCreatorBonus({
      creatorId: result.creatorId,
      brandId: result.brandId,
      subscriberUserId: args.subscriberUserId,
      stripeInvoiceId: args.stripeInvoiceId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      basisCents: result.basisCents,
      ratePct: String(result.ratePct),
      amountCents: result.amountCents,
      attributedVideoId: result.attributedVideoId,
      attributionMethod: result.attributionMethod,
    } as any);

    if (!row) {
      // The unique index rejected it — a redelivery or a replay. Expected.
      console.log(`[Bonus] Already recorded for invoice ${args.stripeInvoiceId}`);
      return;
    }
    console.log(
      `[Bonus] ${result.amountCents}c to creator ${result.creatorId} ` +
      `(${result.ratePct}% of ${result.basisCents}c, brand ${result.brandId}, ` +
      `invoice ${args.stripeInvoiceId})`,
    );
  } catch (err) {
    console.error(`[Bonus] Failed for invoice ${args.stripeInvoiceId}:`, err);
  }
}

/**
 * Mint wrapper that CANNOT throw.
 *
 * dispatchStripeEvent already swallows handler errors so a failure never 400s the
 * webhook — which also means a failure here would be silent. Catch locally so the
 * expected "already minted" case logs at info level and anything genuinely wrong
 * logs at error level and stays greppable.
 */
async function mintBrandConversionTokenSafely(args: {
  subscriberUserId: string;
  plan: PlanKey;
  amountPaidCents: number;
  stripeSubscriptionId: string | null;
  planResolved: boolean;
}): Promise<void> {
  // A plan we could not identify defaults to 'starter' — the only tier that pays
  // out. Refuse to mint on a guess: a hand-made $4,990 price with no metadata
  // would otherwise clear the $249 amount gate and mint a $49 token.
  if (!args.planResolved) {
    console.warn(
      `[Wallet] No mint for subscriber ${args.subscriberUserId} — plan could not be resolved ` +
      `from the Stripe price (defaulted to '${args.plan}'); set metadata.plan on the price to enable`,
    );
    return;
  }
  try {
    const result = await mintBrandConversionToken(storage, args);
    if (result.minted) {
      console.log(
        `[Wallet] Minted 1 token for creator ${result.entry.userId} ` +
        `(brand ${result.attribution.brandId}, via ${result.attribution.method}, ` +
        `video ${result.attribution.videoId}, subscriber ${args.subscriberUserId})`,
      );
    } else if (result.reason === 'already_minted') {
      // Expected on every renewal and on any Stripe replay. Not a problem.
      console.log(`[Wallet] No mint for subscriber ${args.subscriberUserId} — already minted`);
    } else if (result.reason === 'underpaid') {
      // Normal for a proration. ALSO the signature of a subscription on a custom
      // price with no metadata.plan, which planFromSubscription() resolves to
      // DEFAULT_PLAN ('starter') — worth being able to grep for.
      console.warn(
        `[Wallet] No mint for subscriber ${args.subscriberUserId} — invoice paid ` +
        `${args.amountPaidCents}c is below the '${args.plan}' list price ` +
        `${PLAN_CONFIG[args.plan].amount}c (proration, or a price with no metadata.plan)`,
      );
    } else {
      console.log(`[Wallet] No mint for subscriber ${args.subscriberUserId} — ${result.reason}`);
    }
  } catch (err) {
    console.error(`[Wallet] Mint FAILED for subscriber ${args.subscriberUserId}:`, err);
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = extractCustomerId(invoice.customer);
  if (!customerId) return;

  const user = await storage.getUserByStripeCustomerId(customerId);
  if (!user) return;

  const subscriptionId = invoiceSubscriptionId(invoice);

  /**
   * Only a SUBSCRIPTION invoice may change subscription status.
   *
   * Without this, a failed standalone invoice — an overage charge, or anything
   * raised by hand in the Stripe dashboard — flips the user's whole subscription
   * to past_due and revokes their access over a bill that has nothing to do with
   * it. The success-path twin above already returns early on the same condition;
   * this side was missing it, so the two disagreed about what an invoice means.
   *
   * This matters more, not less, as overage billing arrives: overage failing is
   * expected and routine, and it must not cancel someone's plan.
   */
  if (!subscriptionId) return;

  const existing = await storage.getBrandSubscription(user.id);

  await storage.upsertBrandSubscription({
    userId: user.id,
    plan: (existing?.plan ?? DEFAULT_PLAN) as PlanKey,
    status: 'past_due',
    stripeSubscriptionId: existing?.stripeSubscriptionId ?? subscriptionId ?? undefined,
    currentPeriodEnd: existing?.currentPeriodEnd ?? undefined,
  });

  console.log(`[Webhook] Payment failed — user ${user.id} marked past_due`);
}

// --- Payout / Connect reconciliation ---------------------------------------

// A payout is considered settled/terminal for our transfer ledger once it is
// either "reversed" or "failed"; both re-open the underlying commissions.
function isTerminalReversalPayoutStatus(status: string | null | undefined): boolean {
  return status === 'reversed' || status === 'failed';
}

// A Stripe transfer was reversed (clawback) or failed after creation. Find the
// affiliatePayout keyed by that transfer id, mark it reversed/failed, and flip the
// commissions it paid back to a "reversed" state so they no longer count as paid.
// Idempotent: re-running is a no-op once the payout/commissions are already reversed.
async function handleTransferReversed(transfer: Stripe.Transfer, eventType: string): Promise<void> {
  // Our engine only ever issues FULL transfers, so a full reversal is the expected case. If
  // Stripe reports a partial reversal (amount_reversed < amount), we can't safely decide which
  // commissions to reverse — flag for manual handling instead of auto-reversing everything.
  // Missing/undefined amount fields (e.g. transfer.failed or a bare simulated event) are treated
  // as a full reversal, preserving prior behavior.
  const amount = typeof transfer.amount === 'number' ? transfer.amount : undefined;
  const amountReversed = typeof transfer.amount_reversed === 'number' ? transfer.amount_reversed : undefined;
  const isPartialReversal = amount !== undefined && amountReversed !== undefined && amountReversed < amount;
  if (isPartialReversal) {
    console.warn(
      `[Webhook] ${eventType}: partial transfer reversal — manual handling required ` +
      `(transfer ${transfer.id}, reversed ${amountReversed}/${amount})`
    );
    return;
  }

  const metaPayoutId = typeof transfer.metadata?.payoutId === 'string' ? transfer.metadata.payoutId : undefined;

  let payout = await storage.getPayoutByStripeTransferId(transfer.id);
  if (!payout && metaPayoutId) {
    // Fallback: the transfer metadata carries the payout id even if stripeTransferId
    // was never persisted (e.g. transfer failed before updatePayoutStatus ran).
    const all = await storage.getAllPayouts();
    payout = all.find(p => p.id === metaPayoutId);
  }

  if (!payout) {
    console.warn(`[Webhook] ${eventType}: no affiliatePayout found for transfer ${transfer.id}`);
    return;
  }

  const targetStatus = eventType === 'transfer.failed' ? 'failed' : 'reversed';

  const commissions = await storage.getCommissionsByPayoutId(payout.id);
  const rowsToReverse = commissions.filter(c => c.status === 'paid');
  const toReverse = rowsToReverse.map(c => c.id);

  // Idempotency: if the payout is already terminal and no paid commissions remain,
  // there is nothing to do.
  if (isTerminalReversalPayoutStatus(payout.status) && toReverse.length === 0) {
    console.log(`[Webhook] ${eventType}: payout ${payout.id} already reconciled — skipping`);
    return;
  }

  if (toReverse.length > 0) {
    await storage.markCommissionsReversed(toReverse);
    // Decrement the campaign-affiliate rollup symmetric to the increment in
    // recordSaleCommissions, mirroring clawbackSaleCommissions — only for rows this call
    // actually transitioned paid -> reversed, so a re-delivered event can't over-decrement.
    for (const row of rowsToReverse) {
      if (!row.campaignAffiliateId) continue;
      const ca = (await storage.getCampaignAffiliates(row.videoId)).find(c => c.id === row.campaignAffiliateId);
      if (!ca) continue;
      const revenueCents = Math.max(0, toCents(ca.totalRevenue || '0') - toCents(row.saleAmount || '0'));
      const earningsCents = Math.max(0, toCents(ca.totalEarnings || '0') - toCents(row.commissionAmount || '0'));
      await storage.updateCampaignAffiliateStats(row.campaignAffiliateId, {
        totalConversions: Math.max(0, (ca.totalConversions || 0) - 1),
        totalRevenue: centsToAmount(revenueCents),
        totalEarnings: centsToAmount(earningsCents),
      });
    }
  }
  await storage.updatePayoutStatus(payout.id, targetStatus);

  console.log(`[Webhook] ${eventType}: payout ${payout.id} marked ${targetStatus}, ${toReverse.length} commission(s) reversed (transfer ${transfer.id})`);
}

// A Connect payout (money leaving the affiliate's Stripe balance to their bank)
// succeeded or failed. Our ledger is keyed on transfers, not Connect payouts, so
// there is no row to mutate today — record the lifecycle via structured logging.
// Idempotent: logging only, no state written.
async function handleConnectPayoutLifecycle(payout: Stripe.Payout, event: Stripe.Event): Promise<void> {
  const accountId = event.account;
  let affiliateId: string | undefined;
  if (accountId) {
    const user = await storage.getUserByStripeConnectAccountId(accountId);
    affiliateId = user?.id;
  }
  console.log(
    `[Webhook] ${event.type}: Connect payout ${payout.id} status=${payout.status} amount=${payout.amount} ${payout.currency} ` +
    `account=${accountId ?? 'unknown'} affiliate=${affiliateId ?? 'unknown'}`
  );
}

// A Connect account was updated. Recompute the onboarding gate from the account's
// capabilities and persist it, but only when it actually changed. Idempotent.
async function handleAccountUpdated(account: Stripe.Account): Promise<void> {
  const user = await storage.getUserByStripeConnectAccountId(account.id);
  if (!user) {
    console.warn('[Webhook] account.updated: no user found for connect account', account.id);
    return;
  }

  // PAYOUT readiness. charges_enabled is deliberately NOT part of this: publisher
  // accounts are created with the `transfers` capability only, so charges_enabled
  // never becomes true for them, and requiring it here once left every affiliate
  // permanently un-onboarded. Must match the /api/stripe/connect/status gate.
  const onboarded = !!account.payouts_enabled && !!account.details_submitted;

  // SELLING readiness, tracked separately since in-video checkout was added.
  // A brand's account requests `card_payments` as well, which Stripe verifies on
  // its own schedule — an account can be perfectly fine for payouts and still
  // unable to accept a card. Conflating the two would let a brand look ready to
  // sell while Stripe rejected the charge, with the shopper mid-purchase.
  const chargesEnabled = !!account.charges_enabled;

  const onboardedChanged = !!user.stripeConnectOnboarded !== onboarded;
  const chargesChanged = !!user.stripeConnectChargesEnabled !== chargesEnabled;
  if (!onboardedChanged && !chargesChanged) {
    return; // no change — avoid a needless write
  }

  await storage.updateUser(user.id, {
    ...(onboardedChanged ? { stripeConnectOnboarded: onboarded } : {}),
    ...(chargesChanged ? { stripeConnectChargesEnabled: chargesEnabled } : {}),
  } as any);
  console.log(
    `[Webhook] account.updated: user ${user.id} payouts=${onboarded} charges=${chargesEnabled} (account ${account.id})`,
  );
}

// --- Subscription-side refund / dispute ------------------------------------

// A charge was refunded. If (and only if) it ties to a subscription invoice AND was
// fully refunded, cancel the brand's subscription. Non-subscription charges (e.g.
// license purchases) are ignored here. Idempotent: re-cancelling is a no-op.
async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const customerId = extractCustomerId(charge.customer);
  if (!customerId) return;

  // Only subscription invoices should touch brandSubscriptions.
  const chargeInvoice = (charge as ChargeWithInvoice).invoice;
  const invoiceId = typeof chargeInvoice === 'string' ? chargeInvoice : chargeInvoice?.id;
  if (!invoiceId) {
    console.log(`[Webhook] charge.refunded: charge ${charge.id} not tied to an invoice — ignoring (likely a one-off/license charge)`);
    return;
  }

  /**
   * CLAW THE BONUS BACK FIRST, BEFORE the partial-refund early return.
   *
   * A partial refund leaves the subscription active — correct, and why that
   * return exists. But it does NOT mean the creator should keep 5% of money the
   * brand got back. Reversing on any refund of the invoice is the safe
   * direction: the alternative is paying a creator a share of revenue the
   * platform has refunded, out of the platform's own account.
   *
   * Only rows still 'approved' move. One already transferred needs a real
   * clawback against the creator's balance — the existing negative-commission
   * path — and must not be quietly rewritten to look unpaid.
   */
  try {
    const reversed = await storage.reverseCreatorBonusesForInvoice(invoiceId);
    if (reversed > 0) {
      console.log(`[Bonus] Reversed ${reversed} unpaid bonus row(s) for refunded invoice ${invoiceId}`);
    }
  } catch (err) {
    console.error(`[Bonus] Failed to reverse for invoice ${invoiceId}:`, err);
  }

  const fullyRefunded = charge.amount_refunded >= charge.amount;
  if (!fullyRefunded) {
    console.log(`[Webhook] charge.refunded: charge ${charge.id} only partially refunded (${charge.amount_refunded}/${charge.amount}) — leaving subscription active`);
    return;
  }

  const user = await storage.getUserByStripeCustomerId(customerId);
  if (!user) {
    console.warn('[Webhook] charge.refunded: no user found for customer', customerId);
    return;
  }

  const existing = await storage.getBrandSubscription(user.id);
  if (existing?.status === 'cancelled') {
    return; // already reflected
  }

  await storage.upsertBrandSubscription({
    userId: user.id,
    plan: (existing?.plan ?? DEFAULT_PLAN) as PlanKey,
    status: 'cancelled',
    stripeSubscriptionId: existing?.stripeSubscriptionId ?? undefined,
    currentPeriodEnd: undefined,
  });

  console.log(`[Webhook] charge.refunded: user ${user.id} subscription cancelled (full refund of charge ${charge.id})`);
}

// A dispute was opened on a charge. Freeze the brand's subscription (past_due) while
// it is pending. Only applies to subscription-invoice charges. Idempotent.
async function handleChargeDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return;

  const stripe = await getUncachableStripeClient();
  let charge: Stripe.Charge;
  try {
    charge = await stripe.charges.retrieve(chargeId);
  } catch {
    console.warn(`[Webhook] charge.dispute.created: could not retrieve charge ${chargeId} for dispute ${dispute.id}`);
    return;
  }

  const customerId = extractCustomerId(charge.customer);
  if (!customerId) return;

  const chargeInvoice = (charge as ChargeWithInvoice).invoice;
  const invoiceId = typeof chargeInvoice === 'string' ? chargeInvoice : chargeInvoice?.id;
  if (!invoiceId) {
    console.log(`[Webhook] charge.dispute.created: charge ${chargeId} not tied to an invoice — ignoring (likely a one-off/license charge)`);
    return;
  }

  const user = await storage.getUserByStripeCustomerId(customerId);
  if (!user) {
    console.warn('[Webhook] charge.dispute.created: no user found for customer', customerId);
    return;
  }

  const existing = await storage.getBrandSubscription(user.id);
  if (existing?.status === 'past_due' || existing?.status === 'cancelled') {
    return; // already frozen/terminated
  }

  await storage.upsertBrandSubscription({
    userId: user.id,
    plan: (existing?.plan ?? DEFAULT_PLAN) as PlanKey,
    status: 'past_due',
    stripeSubscriptionId: existing?.stripeSubscriptionId ?? undefined,
    currentPeriodEnd: existing?.currentPeriodEnd ?? undefined,
  });

  console.log(`[Webhook] charge.dispute.created: user ${user.id} subscription frozen past_due (dispute ${dispute.id} on charge ${chargeId})`);
}

export async function dispatchStripeEvent(event: Stripe.Event): Promise<void> {
  try {
    // Transfer clawback. `transfer.reversed` is the real Stripe signal; `transfer.failed`
    // is not in the SDK's typed event union but is matched defensively as a string in
    // case Stripe (or the dev simulator) emits it — both route to the same reversal path.
    const eventType: string = event.type;
    if (eventType === 'transfer.reversed' || eventType === 'transfer.failed') {
      await handleTransferReversed(event.data.object as Stripe.Transfer, eventType);
      return;
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      case 'payout.failed':
      case 'payout.paid':
        await handleConnectPayoutLifecycle(event.data.object as Stripe.Payout, event);
        break;
      case 'account.updated':
        await handleAccountUpdated(event.data.object as Stripe.Account);
        break;
      case 'charge.refunded':
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;
      case 'charge.dispute.created':
        await handleChargeDisputeCreated(event.data.object as Stripe.Dispute);
        break;
      default:
        break;
    }
  } catch (err) {
    // Never throw out of dispatch — a handler failure must not 400 the webhook and
    // trigger Stripe retries against reconciliation logic that may be non-idempotent
    // mid-flight. Log and acknowledge; Stripe events remain replayable from the dashboard.
    console.error(`[Webhook] handler error for ${event.type} (event ${event.id}):`, err);
  }
}
