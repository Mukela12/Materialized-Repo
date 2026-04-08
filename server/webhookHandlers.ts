import Stripe from 'stripe';
import { getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';

export const PLAN_AMOUNT_FALLBACK: Record<number, 'starter' | 'pro'> = {
  24900: 'starter',
  49900: 'pro',
};

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

async function planFromSubscription(subscription: Stripe.Subscription): Promise<'starter' | 'pro'> {
  const item = subscription.items?.data?.[0];
  if (!item) return 'starter';

  const price = item.price as Stripe.Price;

  if (price.metadata?.plan === 'starter' || price.metadata?.plan === 'pro') {
    return price.metadata.plan;
  }

  if (typeof price.product === 'string') {
    try {
      const stripe = await getUncachableStripeClient();
      const product = await stripe.products.retrieve(price.product);
      if (product.metadata?.plan === 'starter' || product.metadata?.plan === 'pro') {
        return product.metadata.plan;
      }
    } catch {
    }
  } else if (price.product && typeof price.product === 'object') {
    const product = price.product as Stripe.Product;
    if (product.metadata?.plan === 'starter' || product.metadata?.plan === 'pro') {
      return product.metadata.plan;
    }
  }

  return PLAN_AMOUNT_FALLBACK[price.unit_amount ?? 0] ?? 'starter';
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
  const metaPlan = session.metadata?.plan as 'starter' | 'pro' | undefined;

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
    plan: (existing?.plan ?? 'starter') as 'starter' | 'pro',
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
  const plan = await planFromSubscription(subscription);

  await storage.upsertBrandSubscription({
    userId: user.id,
    plan,
    status: 'active',
    stripeSubscriptionId: subscriptionId,
    currentPeriodEnd,
  });

  console.log(`[Webhook] Payment succeeded — user ${user.id}, period ends ${currentPeriodEnd.toISOString()}`);
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
    plan: (existing?.plan ?? 'starter') as 'starter' | 'pro',
    status: 'past_due',
    stripeSubscriptionId: existing?.stripeSubscriptionId ?? invoiceSubscriptionId ?? undefined,
    currentPeriodEnd: existing?.currentPeriodEnd ?? undefined,
  });

  console.log(`[Webhook] Payment failed — user ${user.id} marked past_due`);
}

export async function dispatchStripeEvent(event: Stripe.Event): Promise<void> {
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
    default:
      break;
  }
}
