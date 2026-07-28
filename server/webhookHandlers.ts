import Stripe from 'stripe';
import { getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';
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

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
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

  const stripe = await getUncachableStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price.product'],
  });
  const currentPeriodEnd = subscriptionPeriodEnd(subscription);
  const plan = metaPlan ?? (await planFromSubscription(subscription));

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

// Stripe SDK v20 likewise dropped `invoice` from the Charge type, but it is still
// present in webhook payloads — access via the raw object.
type ChargeWithInvoice = Stripe.Charge & {
  invoice: string | Stripe.Invoice | null;
};

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  const customerId = extractCustomerId(invoice.customer);
  if (!customerId) return;

  const subscriptionId = extractSubscriptionId((invoice as InvoiceWithSubscription).subscription);
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

  const existing = await storage.getBrandSubscription(user.id);
  const invoiceSubscriptionId = extractSubscriptionId((invoice as InvoiceWithSubscription).subscription);

  await storage.upsertBrandSubscription({
    userId: user.id,
    plan: (existing?.plan ?? DEFAULT_PLAN) as PlanKey,
    status: 'past_due',
    stripeSubscriptionId: existing?.stripeSubscriptionId ?? invoiceSubscriptionId ?? undefined,
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

  const onboarded = !!account.charges_enabled && !!account.payouts_enabled && !!account.details_submitted;

  if (!!user.stripeConnectOnboarded === onboarded) {
    return; // no change — avoid a needless write
  }

  await storage.updateUser(user.id, { stripeConnectOnboarded: onboarded });
  console.log(`[Webhook] account.updated: user ${user.id} stripeConnectOnboarded -> ${onboarded} (account ${account.id})`);
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
