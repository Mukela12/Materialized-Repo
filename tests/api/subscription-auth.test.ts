import { describe, it, expect, beforeAll } from 'vitest';

const BASE = process.env.API_BASE_URL ?? 'http://localhost:5000';

// Admin credentials — set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD env vars before running
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error('TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD environment variables are required to run these tests');
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function get(path: string, headers: Record<string, string> = {}) {
  return fetch(`${BASE}${path}`, { method: 'GET', headers });
}

async function loginAndGetCookie(): Promise<string> {
  const res = await post('/api/auth/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/(connect\.sid=[^;]+)/);
  if (!match) throw new Error('No session cookie returned from login');
  return match[1];
}

async function postWithSession(path: string, body: unknown, sessionCookie: string) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify(body),
  });
}

async function getWithSession(path: string, sessionCookie: string) {
  return fetch(`${BASE}${path}`, {
    method: 'GET',
    headers: { Cookie: sessionCookie },
  });
}

async function getStripeSession(sessionId: string, cookie: string) {
  const res = await getWithSession(`/api/dev/stripe/checkout-session/${sessionId}`, cookie);
  if (!res.ok) throw new Error(`Session fetch failed: ${res.status} — ${await res.text()}`);
  return res.json();
}

let sessionCookie = '';
let adminUserId = '';

beforeAll(async () => {
  sessionCookie = await loginAndGetCookie();
  const meRes = await getWithSession('/api/auth/me', sessionCookie);
  const me = await meRes.json();
  adminUserId = me.id;
});

// ─── Unauthenticated 401 Guards ─────────────────────────────────────────────

describe('Creator Subscription Checkout — Auth Validation (no session)', () => {
  it('POST /api/creator/subscription/checkout returns 401 without a session', async () => {
    const res = await post('/api/creator/subscription/checkout', { plan: 'starter' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('POST /api/creator/subscription/checkout with pro plan returns 401 without session', async () => {
    const res = await post('/api/creator/subscription/checkout', { plan: 'pro' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('POST /api/creator/subscription/checkout with invalid plan returns 401 (auth before validation)', async () => {
    const res = await post('/api/creator/subscription/checkout', { plan: 'enterprise' });
    expect(res.status).toBe(401);
  });
});

// ─── Authenticated Session ────────────────────────────────────────────────────

describe('Auth Session — Login & Identity', () => {
  it('admin login returns session cookie', async () => {
    expect(sessionCookie).toMatch(/connect\.sid=/);
  });

  it('GET /api/auth/me with session returns authenticated user', async () => {
    const res = await getWithSession('/api/auth/me', sessionCookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('email', ADMIN_EMAIL);
    expect(body).toHaveProperty('isAdmin', true);
    expect(body).toHaveProperty('role', 'creator');
    expect(body).toHaveProperty('id');
  });
});

// ─── Creator Checkout — Full Stripe Session Validation ───────────────────────

describe('Creator Checkout — Authenticated with Stripe session internals', () => {
  it('POST /api/creator/subscription/checkout (starter) returns 200 with url and sessionId', async () => {
    const res = await postWithSession('/api/creator/subscription/checkout', { plan: 'starter' }, sessionCookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('url');
    expect(body).toHaveProperty('sessionId');
    expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(body.sessionId).toMatch(/^cs_test_/);
  });

  it('Stripe checkout session (starter) has mode=subscription, correct metadata, and EUR line item', async () => {
    const checkoutRes = await postWithSession('/api/creator/subscription/checkout', { plan: 'starter' }, sessionCookie);
    expect(checkoutRes.status).toBe(200);
    const { sessionId } = await checkoutRes.json();

    const session = await getStripeSession(sessionId, sessionCookie);

    expect(session.mode).toBe('subscription');
    expect(session.metadata).toHaveProperty('plan', 'starter');
    expect(session.metadata).toHaveProperty('userId', adminUserId);

    expect(Array.isArray(session.line_items)).toBe(true);
    expect(session.line_items.length).toBeGreaterThanOrEqual(1);

    const lineItem = session.line_items[0];
    expect(lineItem.currency).toBe('eur');
    expect(lineItem.price.unit_amount).toBe(24900);
    expect(lineItem.price.recurring?.interval).toBe('month');
  }, 30_000);

  it('Stripe checkout session (pro) has mode=subscription with €499 line item', async () => {
    const checkoutRes = await postWithSession('/api/creator/subscription/checkout', { plan: 'pro' }, sessionCookie);
    expect(checkoutRes.status).toBe(200);
    const { sessionId } = await checkoutRes.json();

    const session = await getStripeSession(sessionId, sessionCookie);

    expect(session.mode).toBe('subscription');
    expect(session.metadata).toHaveProperty('plan', 'pro');
    expect(session.metadata).toHaveProperty('userId', adminUserId);

    const lineItem = session.line_items[0];
    expect(lineItem.currency).toBe('eur');
    expect(lineItem.price.unit_amount).toBe(49900);
    expect(lineItem.price.recurring?.interval).toBe('month');
  }, 30_000);

  it('POST /api/creator/subscription/portal with session returns 200 with Stripe billing portal URL', async () => {
    const res = await postWithSession('/api/creator/subscription/portal', {}, sessionCookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('url');
    expect(typeof body.url).toBe('string');
    expect(body.url).toMatch(/^https:\/\/billing\.stripe\.com\//);
  }, 15_000);
});

// ─── Brand Checkout — Authenticated with Stripe Session Internals ────────────

describe('Brand Checkout — Authenticated with Stripe session internals', () => {
  it('POST /api/brand/subscription/checkout (starter) returns 200 with url and sessionId', async () => {
    const res = await postWithSession('/api/brand/subscription/checkout', { plan: 'starter' }, sessionCookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('url');
    expect(body).toHaveProperty('sessionId');
    expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(body.sessionId).toMatch(/^cs_test_/);
  }, 15_000);

  it('Stripe brand checkout session (starter) has mode=subscription, correct metadata and EUR amount', async () => {
    const checkoutRes = await postWithSession('/api/brand/subscription/checkout', { plan: 'starter' }, sessionCookie);
    expect(checkoutRes.status).toBe(200);
    const { sessionId } = await checkoutRes.json();

    const session = await getStripeSession(sessionId, sessionCookie);

    expect(session.mode).toBe('subscription');
    expect(session.metadata).toHaveProperty('plan', 'starter');
    expect(session.metadata).toHaveProperty('userId', adminUserId);

    expect(Array.isArray(session.line_items)).toBe(true);
    expect(session.line_items.length).toBeGreaterThanOrEqual(1);

    const lineItem = session.line_items[0];
    expect(lineItem.currency).toBe('eur');
    expect(lineItem.price.unit_amount).toBe(24900);
    expect(lineItem.price.recurring?.interval).toBe('month');
  }, 30_000);

  it('Stripe brand checkout session (pro) has mode=subscription with €499 line item and metadata', async () => {
    const checkoutRes = await postWithSession('/api/brand/subscription/checkout', { plan: 'pro' }, sessionCookie);
    expect(checkoutRes.status).toBe(200);
    const { sessionId } = await checkoutRes.json();

    const session = await getStripeSession(sessionId, sessionCookie);

    expect(session.mode).toBe('subscription');
    expect(session.metadata).toHaveProperty('plan', 'pro');
    expect(session.metadata).toHaveProperty('userId', adminUserId);

    const lineItem = session.line_items[0];
    expect(lineItem.currency).toBe('eur');
    expect(lineItem.price.unit_amount).toBe(49900);
    expect(lineItem.price.recurring?.interval).toBe('month');
  }, 30_000);

  it('POST /api/brand/subscription/portal with session returns 200 with Stripe billing portal URL', async () => {
    const res = await postWithSession('/api/brand/subscription/portal', {}, sessionCookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('url');
    expect(body.url).toMatch(/^https:\/\/billing\.stripe\.com\//);
  }, 15_000);
});

// ─── Affiliate Connect — Full E2E (create + onboarding URL) ─────────────────

describe('Affiliate Stripe Connect — E2E Create + Onboarding URL', () => {
  it('POST /api/stripe/connect/create returns 401 without session', async () => {
    const res = await post('/api/stripe/connect/create', {});
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('POST /api/stripe/connect/onboarding returns 401 without session', async () => {
    const res = await post('/api/stripe/connect/onboarding', {});
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('POST /api/stripe/connect/create with session returns 200 with accountId', async () => {
    const res = await postWithSession('/api/stripe/connect/create', {}, sessionCookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('accountId');
    expect(typeof body.accountId).toBe('string');
    expect(body.accountId).toMatch(/^acct_/);
  }, 15_000);

  it('POST /api/stripe/connect/onboarding returns 200 with a Stripe Express onboarding URL', async () => {
    await postWithSession('/api/stripe/connect/create', {}, sessionCookie);

    const res = await postWithSession('/api/stripe/connect/onboarding', {}, sessionCookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('url');
    expect(typeof body.url).toBe('string');
    expect(body.url).toMatch(/^https:\/\/connect\.stripe\.com\//);
  }, 15_000);

  it('GET /api/stripe/connect/status returns 200 with connected and onboarded booleans', async () => {
    const res = await get('/api/stripe/connect/status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('connected');
    expect(body).toHaveProperty('onboarded');
    expect(typeof body.connected).toBe('boolean');
    expect(typeof body.onboarded).toBe('boolean');
  });

  it('GET /api/stripe/connect/status with session returns authenticated user Connect state', async () => {
    const res = await getWithSession('/api/stripe/connect/status', sessionCookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('connected');
    expect(typeof body.connected).toBe('boolean');
  });
});

// ─── Brand Subscription — Unauthenticated Guards ─────────────────────────────

describe('Brand Subscription Checkout — Auth Validation (no session)', () => {
  it('POST /api/brand/subscription/checkout returns 401 without session', async () => {
    const res = await post('/api/brand/subscription/checkout', { plan: 'starter' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('POST /api/brand/subscription/portal returns 401 without session', async () => {
    const res = await post('/api/brand/subscription/portal', {});
    expect(res.status).toBe(401);
  });

  it('POST /api/brand/subscription/surplus-invoice returns 401 without session', async () => {
    const res = await post('/api/brand/subscription/surplus-invoice', {
      views: 1000,
      minutes: 60,
      publishers: 3,
      totalAmount: 350,
    });
    expect(res.status).toBe(401);
  });
});

// ─── Webhook — Signature Validation ──────────────────────────────────────────

describe('Webhook Endpoint — Signature Validation', () => {
  it('POST /api/webhooks/stripe without stripe-signature returns 400', async () => {
    const res = await post('/api/webhooks/stripe', { type: 'checkout.session.completed' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    const err: string = body.error;
    expect(
      err.includes('Webhook secret not configured') ||
      err.includes('Missing stripe-signature header') ||
      err.includes('Signature verification failed')
    ).toBe(true);
  });

  it('POST /api/webhooks/stripe with malformed stripe-signature returns 400', async () => {
    const res = await post('/api/webhooks/stripe', { type: 'customer.subscription.updated' }, {
      'stripe-signature': 't=invalid,v1=badhash',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ─── /api/users/me ─────────────────────────────────────────────────────────────

describe('User Identity Endpoint', () => {
  it('GET /api/users/me returns a user even without session (demo fallback)', async () => {
    const res = await get('/api/users/me');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('email');
    expect(body).toHaveProperty('role');
  });

  it('GET /api/users/me with session returns the authenticated admin user', async () => {
    const res = await getWithSession('/api/users/me', sessionCookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('email', ADMIN_EMAIL);
  });
});
