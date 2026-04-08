/**
 * Stripe test-mode price/product validation.
 * Verifies that the starter (€249/mo) and pro (€499/mo) prices exist in Stripe
 * test mode with correct amounts, currency, interval, and plan metadata.
 * All assertions run against the real Stripe API via the server's dev endpoint.
 *
 * Dev endpoints require admin authentication — tests login as admin first.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = process.env.API_BASE_URL ?? 'http://localhost:5000';
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error('TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD environment variables are required to run these tests');
}

let adminCookie = '';

async function adminGet(path: string) {
  return fetch(`${BASE}${path}`, {
    headers: { Cookie: adminCookie },
  });
}

describe('Stripe Plan Prices — Test-Mode Integration', () => {
  beforeAll(async () => {
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    expect(loginRes.status, 'admin login for stripe price tests').toBe(200);
    adminCookie = loginRes.headers.get('set-cookie') ?? '';

    // Ensure starter and pro prices exist in Stripe test mode before assertions
    const ensureRes = await fetch(`${BASE}/api/dev/stripe/ensure-plans`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(ensureRes.status, 'ensure-plans').toBe(200);
    const { starter, pro } = await ensureRes.json();
    expect(starter).toMatch(/^price_/);
    expect(pro).toMatch(/^price_/);
    console.log(`[Setup] Starter price: ${starter}, Pro price: ${pro}`);
  }, 30_000);

  it('GET /api/dev/stripe/plans returns both starter and pro prices', async () => {
    const res = await adminGet('/api/dev/stripe/plans');
    expect(res.status).toBe(200);
    const { plans } = await res.json();
    expect(Array.isArray(plans)).toBe(true);
    expect(plans.length).toBeGreaterThanOrEqual(2);

    const planNames: string[] = plans.map((p: { plan: string }) => p.plan);
    expect(planNames).toContain('starter');
    expect(planNames).toContain('pro');
  }, 15_000);

  it('Starter plan price has amount=24900 EUR, monthly recurring, and plan metadata', async () => {
    const res = await adminGet('/api/dev/stripe/plans');
    expect(res.status).toBe(200);
    const { plans } = await res.json();
    const starter = plans.find((p: { plan: string }) => p.plan === 'starter');

    expect(starter).toBeDefined();
    expect(starter.unit_amount).toBe(24900);
    expect(starter.currency).toBe('eur');
    expect(starter.recurring?.interval).toBe('month');
    expect(starter.recurring?.interval_count).toBe(1);

    const meta: Record<string, string> = starter.metadata ?? {};
    expect(meta.plan).toBe('starter');

    console.log(`[Stripe] starter price ID: ${starter.id}, product: ${starter.product_id}`);
  }, 15_000);

  it('Pro plan price has amount=49900 EUR, monthly recurring, and plan metadata', async () => {
    const res = await adminGet('/api/dev/stripe/plans');
    expect(res.status).toBe(200);
    const { plans } = await res.json();
    const pro = plans.find((p: { plan: string }) => p.plan === 'pro');

    expect(pro).toBeDefined();
    expect(pro.unit_amount).toBe(49900);
    expect(pro.currency).toBe('eur');
    expect(pro.recurring?.interval).toBe('month');
    expect(pro.recurring?.interval_count).toBe(1);

    const meta: Record<string, string> = pro.metadata ?? {};
    expect(meta.plan).toBe('pro');

    console.log(`[Stripe] pro price ID: ${pro.id}, product: ${pro.product_id}`);
  }, 15_000);

  it('Starter and Pro prices have distinct price IDs', async () => {
    const res = await adminGet('/api/dev/stripe/plans');
    expect(res.status).toBe(200);
    const { plans } = await res.json();
    const starter = plans.find((p: { plan: string }) => p.plan === 'starter');
    const pro = plans.find((p: { plan: string }) => p.plan === 'pro');

    expect(starter.id).not.toBe(pro.id);
    expect(starter.id).toMatch(/^price_/);
    expect(pro.id).toMatch(/^price_/);
  }, 15_000);

  it('Unauthenticated request to /api/dev/stripe/plans returns 401', async () => {
    const res = await fetch(`${BASE}/api/dev/stripe/plans`);
    expect(res.status).toBe(401);
  }, 10_000);
});
