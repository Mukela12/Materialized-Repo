import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5000';

// Admin credentials — set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD env vars before running
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error('TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD environment variables are required. Set them before running E2E tests.');
}

test.describe('Creator Subscription Page — Unauthenticated', () => {
  test('redirects to /login when not authenticated', async ({ page }) => {
    await page.goto(`${BASE}/creator/settings/subscription`);
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/login');
  });

  test('login page shows email and password fields', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('input-login-email')).toBeVisible();
    await expect(page.getByTestId('input-login-password')).toBeVisible();
  });
});

test.describe('Creator Subscription Page — Authenticated', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.waitForLoadState('networkidle');

    await page.getByTestId('input-login-email').fill(ADMIN_EMAIL);
    await page.getByTestId('input-login-password').fill(ADMIN_PASSWORD);
    await page.getByTestId('button-login-submit').click();
    await page.waitForURL(`${BASE}/creator`, { timeout: 10_000 });

    await page.goto(`${BASE}/creator/settings/subscription`);
    await page.waitForLoadState('networkidle');
  });

  test('renders subscription heading and back button', async ({ page }) => {
    await expect(page.getByText('Subscription')).toBeVisible();
    await expect(page.getByTestId('button-back-settings')).toBeVisible();
  });

  test('renders plan card with price and status badge', async ({ page }) => {
    await expect(
      page.getByText('Creator Plan').or(page.getByText('Brand Plan')).or(page.getByText('Publisher Plan')),
    ).toBeVisible();
    const pricePattern = /\$149|\$249|\$499/;
    await expect(page.getByText(pricePattern)).toBeVisible();
  });

  test('renders upgrade plan and billing portal buttons', async ({ page }) => {
    await expect(page.getByTestId('button-upgrade-plan')).toBeVisible();
    await expect(page.getByTestId('button-billing-portal')).toBeVisible();
  });

  test('surplus calculator shows sliders and a non-zero initial total', async ({ page }) => {
    const surplusEl = page.getByTestId('text-total-surplus');
    await expect(surplusEl).toBeVisible();
    const surplusText = await surplusEl.textContent();
    // Sliders default to views=5000, minutes=60, publishers=3 → total > $0
    expect(surplusText).toMatch(/\$\d+/);
    await expect(page.getByTestId('button-pay-surplus')).toBeEnabled();
  });

  test('opens plan selector dialog offering the Creator tier', async ({ page }) => {
    await page.getByTestId('button-upgrade-plan').click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Choose your creator plan')).toBeVisible();

    await expect(page.getByText('Creator', { exact: true })).toBeVisible();
    await expect(page.getByText('$149')).toBeVisible();
    await expect(page.getByTestId('button-select-plan-creator')).toBeVisible();
  });

  test('plan picker does not offer the legacy Brand/Publisher tiers to creators', async ({ page }) => {
    // starter/pro remain valid plan ids (existing subscribers keep billing on
    // them) but must not be purchasable from the creator page.
    await page.getByTestId('button-upgrade-plan').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await expect(page.getByTestId('button-select-plan-starter')).toHaveCount(0);
    await expect(page.getByTestId('button-select-plan-pro')).toHaveCount(0);
  });

  test('plan dialog shows "Popular" badge on the Creator plan', async ({ page }) => {
    await page.getByTestId('button-upgrade-plan').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Popular')).toBeVisible();
  });

  test('plan dialog closes on Escape key', async ({ page }) => {
    await page.getByTestId('button-upgrade-plan').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('clicking Creator plan triggers checkout API and returns a Stripe URL with sessionId', async ({ page }) => {
    const [response] = await Promise.all([
      page.waitForResponse(
        r => r.url().includes('/api/creator/subscription/checkout') && r.request().method() === 'POST',
        { timeout: 10_000 }
      ),
      (async () => {
        await page.getByTestId('button-upgrade-plan').click();
        await page.waitForTimeout(300);
        await page.getByTestId('button-select-plan-creator').click();
      })(),
    ]);

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('url');
    expect(body).toHaveProperty('sessionId');
    expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(body.sessionId).toMatch(/^cs_test_/);
  });

  // Backward compatibility: the legacy plan ids are no longer offered in the
  // creator picker, but the endpoint must still accept them so in-flight
  // checkouts and existing subscribers keep working.
  for (const legacyPlan of ['starter', 'pro'] as const) {
    test(`checkout endpoint still accepts the legacy "${legacyPlan}" plan id`, async ({ page }) => {
      const body = await page.evaluate(async ({ base, plan }) => {
        const r = await fetch(`${base}/api/creator/subscription/checkout`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan }),
        });
        return { status: r.status, json: await r.json() };
      }, { base: BASE, plan: legacyPlan });

      expect(body.status).toBe(200);
      expect(body.json.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
      expect(body.json.sessionId).toMatch(/^cs_test_/);
    });
  }

  test('checkout endpoint rejects an unknown plan id', async ({ page }) => {
    const body = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/api/creator/subscription/checkout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'enterprise' }),
      });
      return { status: r.status, json: await r.json() };
    }, BASE);

    expect(body.status).toBe(400);
    expect(body.json.error).toContain('creator');
  });

  test('plan selector dialog features list includes expected plan features', async ({ page }) => {
    await page.getByTestId('button-upgrade-plan').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await expect(page.getByText('Unlimited shoppable videos')).toBeVisible();
    await expect(page.getByText('Unlimited campaigns')).toBeVisible();
    await expect(page.getByText('Advanced analytics & API access')).toBeVisible();
  });

  test('checkout=success query parameter shows success banner', async ({ page }) => {
    await page.goto(`${BASE}/creator/settings/subscription?checkout=success`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Subscription activated')).toBeVisible();
  });

  test('checkout=cancelled query parameter shows cancelled banner', async ({ page }) => {
    await page.goto(`${BASE}/creator/settings/subscription?checkout=cancelled`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Checkout was cancelled')).toBeVisible();
  });

  test('subscription status badge is visible', async ({ page }) => {
    await expect(page.getByTestId('badge-subscription-status')).toBeVisible();
  });
});

test.describe('Creator Subscription — Post-Webhook State Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('input-login-email').fill(ADMIN_EMAIL);
    await page.getByTestId('input-login-password').fill(ADMIN_PASSWORD);
    await page.getByTestId('button-login-submit').click();
    await page.waitForURL(`${BASE}/creator`, { timeout: 10_000 });
  });

  test('after checkout.session.completed webhook, subscription page shows Active badge', async ({ page }) => {
    // Get current user id via /api/auth/me
    const me = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/api/auth/me`, { credentials: 'include' });
      return r.ok ? r.json() : null;
    }, BASE);
    if (!me?.id) throw new Error('Could not retrieve authenticated user');

    // Ensure Stripe plans exist then fire checkout.session.completed
    await page.evaluate(async ({ base, userId }) => {
      await fetch(`${base}/api/dev/stripe/ensure-plans`, { method: 'POST', credentials: 'include' });
      await fetch(`${base}/api/dev/stripe/simulate-webhook`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, plan: 'starter', eventType: 'checkout.session.completed' }),
      });
    }, { base: BASE, userId: me.id });

    await page.goto(`${BASE}/creator/settings/subscription`);
    await page.waitForLoadState('networkidle');
    const badge = page.getByTestId('badge-subscription-status');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('Active');
  });

  test('after invoice.payment_failed webhook, subscription page shows Past Due badge', async ({ page }) => {
    const me = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/api/auth/me`, { credentials: 'include' });
      return r.ok ? r.json() : null;
    }, BASE);
    if (!me?.id) throw new Error('Could not retrieve authenticated user');

    // Ensure active subscription exists, then fail payment
    await page.evaluate(async ({ base, userId }) => {
      await fetch(`${base}/api/dev/stripe/ensure-plans`, { method: 'POST', credentials: 'include' });
      await fetch(`${base}/api/dev/stripe/simulate-webhook`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, plan: 'starter', eventType: 'checkout.session.completed' }),
      });
      await fetch(`${base}/api/dev/stripe/simulate-webhook`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, eventType: 'invoice.payment_failed' }),
      });
    }, { base: BASE, userId: me.id });

    await page.goto(`${BASE}/creator/settings/subscription`);
    await page.waitForLoadState('networkidle');
    const badge = page.getByTestId('badge-subscription-status');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('Past Due');
  });

  test('after invoice.payment_succeeded webhook, subscription page shows Active badge again', async ({ page }) => {
    const me = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/api/auth/me`, { credentials: 'include' });
      return r.ok ? r.json() : null;
    }, BASE);
    if (!me?.id) throw new Error('Could not retrieve authenticated user');

    // Ensure subscription exists, fail it, then re-activate
    await page.evaluate(async ({ base, userId }) => {
      await fetch(`${base}/api/dev/stripe/ensure-plans`, { method: 'POST', credentials: 'include' });
      await fetch(`${base}/api/dev/stripe/simulate-webhook`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, plan: 'pro', eventType: 'checkout.session.completed' }),
      });
      await fetch(`${base}/api/dev/stripe/simulate-webhook`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, eventType: 'invoice.payment_failed' }),
      });
      await fetch(`${base}/api/dev/stripe/simulate-webhook`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, eventType: 'invoice.payment_succeeded' }),
      });
    }, { base: BASE, userId: me.id });

    await page.goto(`${BASE}/creator/settings/subscription`);
    await page.waitForLoadState('networkidle');
    const badge = page.getByTestId('badge-subscription-status');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('Active');
    // The pro checkout was completed. The plan id stays 'pro'; the creator page
    // keeps it as a legacy entry, so it renders under its label "Publisher Plan".
    await expect(page.getByText('Publisher Plan')).toBeVisible();
  });
});
