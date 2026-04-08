/**
 * Webhook Integration Tests — Stripe → DB State Verification
 *
 * Full checkout → webhook → DB lifecycle coverage for Creator and Brand roles.
 *
 * Approach:
 * - POST /api/dev/stripe/simulate-webhook creates a real Stripe subscription using
 *   tok_visa and fires events through dispatchStripeEvent (the production handler).
 * - The endpoint returns the updated DB subscription row for assertion.
 * - Lifecycle transitions (active → past_due → cancelled → active) are verified
 *   against the real DB, not mocked storage.
 *
 * Requires admin session — all calls include Cookie header from admin login.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = process.env.API_BASE_URL ?? 'http://localhost:5000';
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;
const ACCESS_CODE = process.env.ACCESS_CODE;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !ACCESS_CODE) {
  throw new Error('TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, and ACCESS_CODE environment variables are required to run these tests');
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

async function simulateWebhook(opts: {
  userId: string;
  plan?: 'starter' | 'pro';
  eventType: string;
  adminCookie: string;
}) {
  const res = await fetch(`${BASE}/api/dev/stripe/simulate-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: opts.adminCookie },
    body: JSON.stringify({ userId: opts.userId, plan: opts.plan ?? 'starter', eventType: opts.eventType }),
  });
  expect(res.status, `simulate-webhook(${opts.eventType}) status`).toBe(200);
  return res.json();
}

// ─── Creator: checkout.session.completed → active ─────────────────────────────

describe('Webhook Integration — Creator checkout.session.completed → DB state', () => {
  let adminUserId: string;
  let adminCookie: string;

  beforeAll(async () => {
    const session = await loginAsAdmin();
    adminUserId = session.userId;
    adminCookie = session.cookie;
  });

  it('Starter: webhook → DB status=active, plan=starter', async () => {
    const body = await simulateWebhook({ userId: adminUserId, plan: 'starter', eventType: 'checkout.session.completed', adminCookie });
    expect(body.dispatched).toBe(true);
    expect(body.stripeSubscriptionId).toMatch(/^sub_/);
    expect(body.subscription.plan).toBe('starter');
    expect(body.subscription.status).toBe('active');
    expect(typeof body.subscription.currentPeriodEnd).toBe('string');
    console.log(`[checkout→DB] creator starter: ${body.stripeSubscriptionId} → ${body.subscription.status}`);
  }, 40_000);

  it('Pro: webhook → DB status=active, plan=pro', async () => {
    const body = await simulateWebhook({ userId: adminUserId, plan: 'pro', eventType: 'checkout.session.completed', adminCookie });
    expect(body.dispatched).toBe(true);
    expect(body.stripeSubscriptionId).toMatch(/^sub_/);
    expect(body.subscription.plan).toBe('pro');
    expect(body.subscription.status).toBe('active');
    console.log(`[checkout→DB] creator pro: ${body.stripeSubscriptionId} → ${body.subscription.status}`);
  }, 40_000);

  it('trial-status confirms hasActiveSubscription=true after webhook', async () => {
    const res = await fetch(`${BASE}/api/users/me/trial-status`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hasActiveSubscription).toBe(true);
    console.log(`[trial-status] hasActiveSubscription=${data.hasActiveSubscription}`);
  }, 15_000);

  it('Missing userId → 400', async () => {
    const res = await fetch(`${BASE}/api/dev/stripe/simulate-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ plan: 'starter', eventType: 'checkout.session.completed' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  }, 10_000);

  it('Unknown userId → 404', async () => {
    const res = await fetch(`${BASE}/api/dev/stripe/simulate-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ userId: '00000000-0000-0000-0000-000000000000', plan: 'starter', eventType: 'checkout.session.completed' }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBeTruthy();
  }, 10_000);

  it('Unauthenticated request → 401', async () => {
    const res = await fetch(`${BASE}/api/dev/stripe/simulate-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: adminUserId, plan: 'starter', eventType: 'checkout.session.completed' }),
    });
    expect(res.status).toBe(401);
  }, 10_000);
});

// ─── Creator: Full lifecycle active → past_due → cancelled → active ───────────

describe('Webhook Integration — Creator subscription lifecycle transitions', () => {
  let adminUserId: string;
  let adminCookie: string;

  beforeAll(async () => {
    const session = await loginAsAdmin();
    adminUserId = session.userId;
    adminCookie = session.cookie;
    // Bootstrap: ensure there is an active subscription in the DB
    await simulateWebhook({ userId: adminUserId, plan: 'starter', eventType: 'checkout.session.completed', adminCookie });
  }, 50_000);

  it('customer.subscription.updated (plan upgrade starter→pro) → DB plan=pro, status=active', async () => {
    const body = await simulateWebhook({ userId: adminUserId, plan: 'pro', eventType: 'customer.subscription.updated', adminCookie });
    expect(body.dispatched).toBe(true);
    expect(body.subscription.plan).toBe('pro');
    expect(body.subscription.status).toBe('active');
    console.log(`[lifecycle] customer.subscription.updated → plan=${body.subscription.plan}, status=${body.subscription.status}`);
  }, 40_000);

  it('invoice.payment_failed → DB status=past_due', async () => {
    const body = await simulateWebhook({ userId: adminUserId, eventType: 'invoice.payment_failed', adminCookie });
    expect(body.dispatched).toBe(true);
    expect(body.subscription.status).toBe('past_due');
    console.log(`[lifecycle] invoice.payment_failed → ${body.subscription.status}`);
  }, 20_000);

  it('customer.subscription.deleted → DB status=cancelled', async () => {
    const body = await simulateWebhook({ userId: adminUserId, eventType: 'customer.subscription.deleted', adminCookie });
    expect(body.dispatched).toBe(true);
    expect(body.subscription.status).toBe('cancelled');
    console.log(`[lifecycle] customer.subscription.deleted → ${body.subscription.status}`);
  }, 20_000);

  it('invoice.payment_succeeded after deletion → DB status=active', async () => {
    const body = await simulateWebhook({ userId: adminUserId, eventType: 'invoice.payment_succeeded', adminCookie });
    expect(body.dispatched).toBe(true);
    expect(body.subscription.status).toBe('active');
    console.log(`[lifecycle] invoice.payment_succeeded → ${body.subscription.status}`);
  }, 40_000);
});

// ─── Brand: checkout.session.completed → active ───────────────────────────────

describe('Webhook Integration — Brand checkout.session.completed → DB state', () => {
  let adminCookie: string;
  let brandUserId: string;

  beforeAll(async () => {
    const session = await loginAsAdmin();
    adminCookie = session.cookie;

    const email = `brand-wh-${Date.now()}@example.com`;
    const regRes = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'BrandTest123!', displayName: 'Brand WH Test', role: 'brand', accessCode: ACCESS_CODE }),
    });

    if (regRes.status === 201 || regRes.status === 200) {
      brandUserId = (await regRes.json()).id;
    } else {
      const errBody = await regRes.text();
      throw new Error(`Brand user registration failed (status=${regRes.status}): ${errBody}`);
    }
  }, 15_000);

  it('Brand Starter: webhook → DB status=active, plan=starter', async () => {
    const body = await simulateWebhook({ userId: brandUserId, plan: 'starter', eventType: 'checkout.session.completed', adminCookie });
    expect(body.dispatched).toBe(true);
    expect(body.stripeSubscriptionId).toMatch(/^sub_/);
    expect(body.subscription.plan).toBe('starter');
    expect(body.subscription.status).toBe('active');
    console.log(`[checkout→DB] brand starter: ${body.stripeSubscriptionId} → ${body.subscription.status}`);
  }, 40_000);

  it('Brand Pro: webhook → DB status=active, plan=pro', async () => {
    const body = await simulateWebhook({ userId: brandUserId, plan: 'pro', eventType: 'checkout.session.completed', adminCookie });
    expect(body.dispatched).toBe(true);
    expect(body.stripeSubscriptionId).toMatch(/^sub_/);
    expect(body.subscription.plan).toBe('pro');
    expect(body.subscription.status).toBe('active');
    console.log(`[checkout→DB] brand pro: ${body.stripeSubscriptionId} → ${body.subscription.status}`);
  }, 40_000);

  it('Brand invoice.payment_failed → DB status=past_due', async () => {
    const body = await simulateWebhook({ userId: brandUserId, eventType: 'invoice.payment_failed', adminCookie });
    expect(body.dispatched).toBe(true);
    expect(body.subscription.status).toBe('past_due');
    console.log(`[lifecycle] brand invoice.payment_failed → ${body.subscription.status}`);
  }, 20_000);

  it('Brand customer.subscription.deleted → DB status=cancelled', async () => {
    const body = await simulateWebhook({ userId: brandUserId, eventType: 'customer.subscription.deleted', adminCookie });
    expect(body.dispatched).toBe(true);
    expect(body.subscription.status).toBe('cancelled');
    console.log(`[lifecycle] brand customer.subscription.deleted → ${body.subscription.status}`);
  }, 20_000);
});
