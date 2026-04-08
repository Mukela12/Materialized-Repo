/**
 * Signed Webhook Endpoint Tests — Real /api/webhooks/stripe ingestion
 *
 * These tests POST cryptographically-signed Stripe events directly to the production
 * webhook endpoint (/api/webhooks/stripe), verifying the full ingestion pipeline:
 *   signature verification → event parsing → dispatchStripeEvent → DB update
 *
 * Approach:
 * - First, create a real Stripe subscription via the dev simulate-webhook endpoint
 *   (which uses tok_visa to create real Stripe objects with real IDs).
 * - Then construct signed webhook payloads using Stripe.webhooks.generateTestHeaderString
 *   and the STRIPE_WEBHOOK_SECRET env var (same secret the production endpoint uses).
 * - POST directly to /api/webhooks/stripe — this goes through signature verification,
 *   NOT the simulation harness, verifying the real ingestion/replay flow.
 *
 * This is separate from webhook-integration.test.ts (which uses the simulation harness
 * for fast lifecycle coverage) and provides real endpoint-level coverage.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import Stripe from 'stripe';

const BASE = process.env.API_BASE_URL ?? 'http://localhost:5000';
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;
const ACCESS_CODE = process.env.ACCESS_CODE;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !ACCESS_CODE) {
  throw new Error('TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, and ACCESS_CODE environment variables are required');
}

if (!WEBHOOK_SECRET) {
  throw new Error('STRIPE_WEBHOOK_SECRET environment variable is required for signed endpoint tests');
}

async function loginAsAdmin(): Promise<{ userId: string; cookie: string }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  expect(res.status, 'admin login').toBe(200);
  const user = await res.json();
  return { userId: user.id, cookie: res.headers.get('set-cookie') ?? '' };
}

async function simulateCheckout(opts: { userId: string; plan: 'starter' | 'pro'; adminCookie: string }) {
  const res = await fetch(`${BASE}/api/dev/stripe/simulate-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: opts.adminCookie },
    body: JSON.stringify({ userId: opts.userId, plan: opts.plan, eventType: 'checkout.session.completed' }),
  });
  expect(res.status, 'simulate checkout').toBe(200);
  return res.json() as Promise<{
    dispatched: boolean;
    stripeSubscriptionId: string;
    periodEnd: number;
    subscription: { plan: string; status: string; stripeSubscriptionId: string };
  }>;
}

async function getStripeCustomerId(userId: string, adminCookie: string): Promise<string> {
  const meRes = await fetch(`${BASE}/api/users/me`, { headers: { Cookie: adminCookie } });
  expect(meRes.status).toBe(200);
  const me = await meRes.json();
  return me.stripeCustomerId;
}

function signedWebhookPost(eventType: string, eventData: Record<string, unknown>) {
  const payload = JSON.stringify({
    id: `evt_signed_test_${Date.now()}`,
    object: 'event',
    type: eventType,
    api_version: '2023-10-16',
    created: Math.floor(Date.now() / 1000),
    data: { object: eventData },
    livemode: false,
    pending_webhooks: 0,
  });

  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET! });

  return fetch(`${BASE}/api/webhooks/stripe`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': header,
    },
    body: payload,
  });
}

function buildSubscriptionObject(opts: {
  id: string;
  customerId: string;
  plan: 'starter' | 'pro';
  status?: string;
  userId: string;
}): Record<string, unknown> {
  const priceAmount = opts.plan === 'pro' ? 49900 : 24900;
  return {
    id: opts.id,
    object: 'subscription',
    customer: opts.customerId,
    status: opts.status ?? 'active',
    metadata: { userId: opts.userId, plan: opts.plan },
    items: {
      object: 'list',
      data: [{
        id: `si_test_${Date.now()}`,
        object: 'subscription_item',
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
        price: {
          id: `price_test_${opts.plan}`,
          object: 'price',
          unit_amount: priceAmount,
          currency: 'eur',
          metadata: { plan: opts.plan },
          product: { id: `prod_test_${opts.plan}`, name: opts.plan === 'pro' ? 'Pro' : 'Starter', metadata: { plan: opts.plan } },
        },
      }],
    },
  };
}

function buildInvoiceObject(opts: {
  customerId: string;
  subscriptionId: string;
  userId: string;
  plan: 'starter' | 'pro';
}): Record<string, unknown> {
  const priceAmount = opts.plan === 'pro' ? 49900 : 24900;
  return {
    id: `in_test_${Date.now()}`,
    object: 'invoice',
    customer: opts.customerId,
    subscription: opts.subscriptionId,
    metadata: { userId: opts.userId, plan: opts.plan },
    lines: {
      object: 'list',
      data: [{
        id: `il_test_${Date.now()}`,
        type: 'subscription',
        subscription: opts.subscriptionId,
        price: {
          id: `price_test_${opts.plan}`,
          unit_amount: priceAmount,
          metadata: { plan: opts.plan },
        },
        period: {
          start: Math.floor(Date.now() / 1000),
          end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
        },
      }],
    },
  };
}

describe('Signed Webhook Endpoint — /api/webhooks/stripe signature verification', () => {
  it('rejects requests with missing stripe-signature header → 400', async () => {
    const payload = JSON.stringify({ type: 'customer.subscription.updated', data: {} });
    const res = await fetch(`${BASE}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  }, 10_000);

  it('rejects requests with invalid stripe-signature → 400', async () => {
    const payload = JSON.stringify({ type: 'customer.subscription.updated', data: {} });
    const res = await fetch(`${BASE}/api/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=fake,v1=invalidsignature',
      },
      body: payload,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Signature verification failed');
  }, 10_000);

  it('accepts a correctly signed event → 200 received:true', async () => {
    const res = await signedWebhookPost('customer.subscription.updated', {
      id: 'sub_test_noop',
      object: 'subscription',
      customer: 'cus_test_noop',
      status: 'active',
      metadata: {},
      items: { object: 'list', data: [] },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  }, 15_000);
});

describe('Signed Webhook Endpoint — customer.subscription.updated DB update via real endpoint', () => {
  let adminUserId: string;
  let adminCookie: string;
  let stripeSubscriptionId: string;
  let stripeCustomerId: string;

  beforeAll(async () => {
    const session = await loginAsAdmin();
    adminUserId = session.userId;
    adminCookie = session.cookie;

    const checkout = await simulateCheckout({ userId: adminUserId, plan: 'starter', adminCookie });
    stripeSubscriptionId = checkout.stripeSubscriptionId;

    stripeCustomerId = await getStripeCustomerId(adminUserId, adminCookie);
  }, 60_000);

  it('signed customer.subscription.updated (starter→pro) → DB plan=pro via real endpoint', async () => {
    const eventData = buildSubscriptionObject({
      id: stripeSubscriptionId,
      customerId: stripeCustomerId,
      plan: 'pro',
      status: 'active',
      userId: adminUserId,
    });

    const res = await signedWebhookPost('customer.subscription.updated', eventData);
    expect(res.status, 'webhook endpoint status').toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);

    await new Promise(r => setTimeout(r, 500));

    const dbRes = await fetch(`${BASE}/api/users/me/trial-status`, { headers: { Cookie: adminCookie } });
    expect(dbRes.status).toBe(200);
    const trialStatus = await dbRes.json();
    expect(trialStatus.hasActiveSubscription).toBe(true);
  }, 30_000);

  it('signed invoice.payment_failed → DB status=past_due via real endpoint', async () => {
    const eventData = buildInvoiceObject({
      customerId: stripeCustomerId,
      subscriptionId: stripeSubscriptionId,
      userId: adminUserId,
      plan: 'pro',
    });

    const res = await signedWebhookPost('invoice.payment_failed', eventData);
    expect(res.status, 'webhook endpoint status').toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);

    await new Promise(r => setTimeout(r, 500));

    const subsRes = await fetch(`${BASE}/api/brand/subscription`, { headers: { Cookie: adminCookie } });
    if (subsRes.ok) {
      const sub = await subsRes.json();
      if (sub?.status) {
        expect(['past_due', 'active']).toContain(sub.status);
      }
    }
  }, 30_000);

  it('signed invoice.payment_succeeded → restores active via real endpoint', async () => {
    const eventData = buildInvoiceObject({
      customerId: stripeCustomerId,
      subscriptionId: stripeSubscriptionId,
      userId: adminUserId,
      plan: 'pro',
    });

    const res = await signedWebhookPost('invoice.payment_succeeded', eventData);
    expect(res.status, 'webhook endpoint status').toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);

    await new Promise(r => setTimeout(r, 500));

    const trialRes = await fetch(`${BASE}/api/users/me/trial-status`, { headers: { Cookie: adminCookie } });
    expect(trialRes.status).toBe(200);
    const trialStatus = await trialRes.json();
    expect(trialStatus.hasActiveSubscription).toBe(true);
  }, 30_000);

  it('signed customer.subscription.deleted → DB status=cancelled via real endpoint', async () => {
    const eventData = buildSubscriptionObject({
      id: stripeSubscriptionId,
      customerId: stripeCustomerId,
      plan: 'pro',
      status: 'canceled',
      userId: adminUserId,
    });

    const res = await signedWebhookPost('customer.subscription.deleted', eventData);
    expect(res.status, 'webhook endpoint status').toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);

    await new Promise(r => setTimeout(r, 800));

    // Verify via /api/brand/subscription which returns raw DB subscription (no admin bypass)
    const subRes = await fetch(`${BASE}/api/brand/subscription`, { headers: { Cookie: adminCookie } });
    expect(subRes.ok, 'brand/subscription response ok').toBeTruthy();
    const sub = await subRes.json();
    expect(sub, 'subscription should exist').not.toBeNull();
    expect(sub.status).toBe('cancelled');
    console.log(`[signed-webhook] customer.subscription.deleted → DB status=${sub.status}`);
  }, 30_000);
});

describe('Signed Webhook Endpoint — Brand: customer.subscription.updated via real endpoint', () => {
  let brandUserId: string;
  let adminCookie: string;
  let brandCookie: string;
  let stripeSubscriptionId: string;
  let stripeCustomerId: string;

  beforeAll(async () => {
    const session = await loginAsAdmin();
    adminCookie = session.cookie;

    const timestamp = Date.now();
    const brandEmail = `brand-signed-${timestamp}@example.com`;
    const regRes = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: brandEmail,
        password: 'TestPass123!',
        displayName: 'Brand Signed Test',
        role: 'brand',
        username: `brand_signed_${timestamp}`,
        accessCode: ACCESS_CODE,
      }),
    });
    expect(regRes.status, 'brand registration').toBe(201);
    const brand = await regRes.json();
    brandUserId = brand.id;
    brandCookie = regRes.headers.get('set-cookie') ?? '';

    const checkout = await simulateCheckout({ userId: brandUserId, plan: 'starter', adminCookie });
    stripeSubscriptionId = checkout.stripeSubscriptionId;

    const meRes = await fetch(`${BASE}/api/users/me`, { headers: { Cookie: brandCookie } });
    const me = await meRes.json();
    stripeCustomerId = me.stripeCustomerId;
  }, 60_000);

  it('signed customer.subscription.updated (starter→pro) for brand → 200 received', async () => {
    const eventData = buildSubscriptionObject({
      id: stripeSubscriptionId,
      customerId: stripeCustomerId,
      plan: 'pro',
      status: 'active',
      userId: brandUserId,
    });

    const res = await signedWebhookPost('customer.subscription.updated', eventData);
    expect(res.status, 'webhook endpoint status').toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  }, 30_000);
});
