import { test, expect, type Page, type Browser } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5000';

// Admin credentials — set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD env vars before running
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;
const ACCESS_CODE = process.env.ACCESS_CODE;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !ACCESS_CODE) {
  throw new Error('TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, and ACCESS_CODE environment variables are required. Set them before running E2E tests.');
}

// Brand-specific test credentials — registered once per test run via API
const BRAND_EMAIL = `brand-e2e-${Date.now()}@example.com`;
const BRAND_PASSWORD = 'BrandE2E123!';

let brandUserId: string | null = null;

async function registerBrandUser() {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: BRAND_EMAIL,
      password: BRAND_PASSWORD,
      displayName: 'Brand E2E Test',
      role: 'brand',
      accessCode: ACCESS_CODE,
    }),
  });
  if (res.ok) {
    const data = await res.json();
    brandUserId = data.id ?? data.user?.id ?? null;
  }
  return res.ok || res.status === 409;
}

async function loginAsBrand(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('input-login-email').fill(BRAND_EMAIL);
  await page.getByTestId('input-login-password').fill(BRAND_PASSWORD);
  await page.getByTestId('button-login-submit').click();
  await page.waitForURL(`${BASE}/brand`, { timeout: 10_000 });
}

test.describe('Brand Subscription Page — Unauthenticated', () => {
  test('redirects to /login when not authenticated', async ({ page }) => {
    await page.goto(`${BASE}/brand/settings/subscription`);
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/login');
  });
});

test.describe('Brand Subscription Page — Authenticated Brand User', () => {
  test.beforeAll(async () => {
    await registerBrandUser();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsBrand(page);
    await page.goto(`${BASE}/brand/settings/subscription`);
    await page.waitForLoadState('networkidle');
  });

  test('renders subscription heading', async ({ page }) => {
    await expect(page.getByText('Subscription')).toBeVisible();
    await expect(page.getByText('Your current plan and billing')).toBeVisible();
  });

  test('renders plan card with price and status badge', async ({ page }) => {
    await expect(page.getByText('Starter Plan').or(page.getByText('Pro Plan'))).toBeVisible();
    const pricePattern = /€249|€499/;
    await expect(page.getByText(pricePattern)).toBeVisible();
  });

  test('renders upgrade plan and cancel-plan buttons', async ({ page }) => {
    await expect(page.getByTestId('button-upgrade-plan')).toBeVisible();
    await expect(page.getByTestId('button-cancel-plan')).toBeVisible();
  });

  test('renders subscription status badge', async ({ page }) => {
    await expect(page.getByTestId('badge-subscription-status')).toBeVisible();
  });

  test('surplus calculator shows sliders and a non-zero initial total', async ({ page }) => {
    await expect(page.getByText('Estimate overage charges')).toBeVisible();

    const surplusEl = page.getByTestId('text-total-surplus');
    await expect(surplusEl).toBeVisible();
    const surplusText = await surplusEl.textContent();
    // Sliders default to views=5000, minutes=60, publishers=3 → total > €0
    expect(surplusText).toMatch(/€\d+/);
    await expect(page.getByTestId('button-pay-surplus')).toBeEnabled();
  });

  test('surplus calculator shows rate information', async ({ page }) => {
    await expect(page.getByText('€0.05 / view')).toBeVisible();
    await expect(page.getByText('€0.15 / minute')).toBeVisible();
  });

  test('surplus calculator shows view/minute/publisher sliders with labels', async ({ page }) => {
    await expect(page.getByTestId('text-views-value')).toBeVisible();
    await expect(page.getByTestId('text-minutes-value')).toBeVisible();
    await expect(page.getByTestId('text-publishers-value')).toBeVisible();
  });

  test('opens plan selector dialog with Starter and Pro options', async ({ page }) => {
    await page.getByTestId('button-upgrade-plan').click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Choose your plan')).toBeVisible();

    await expect(page.getByText('Starter')).toBeVisible();
    await expect(page.getByText('€249')).toBeVisible();
    await expect(page.getByText('Pro')).toBeVisible();
    await expect(page.getByText('€499')).toBeVisible();

    await expect(page.getByTestId('button-select-plan-starter')).toBeVisible();
    await expect(page.getByTestId('button-select-plan-pro')).toBeVisible();
  });

  test('plan dialog shows "Popular" badge on Pro plan', async ({ page }) => {
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

  test('clicking Starter plan triggers checkout API and returns a Stripe URL', async ({ page }) => {
    const [response] = await Promise.all([
      page.waitForResponse(
        r => r.url().includes('/api/brand/subscription/checkout') && r.request().method() === 'POST',
        { timeout: 10_000 }
      ),
      (async () => {
        await page.getByTestId('button-upgrade-plan').click();
        await page.waitForTimeout(300);
        await page.getByTestId('button-select-plan-starter').click();
      })(),
    ]);

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('url');
    expect(typeof body.url).toBe('string');
    expect(body.url).toMatch(/^https:\/\//);
  });

  test('clicking Pro plan triggers checkout API and returns a Stripe URL with cs_test_ sessionId', async ({ page }) => {
    const [response] = await Promise.all([
      page.waitForResponse(
        r => r.url().includes('/api/brand/subscription/checkout') && r.request().method() === 'POST',
        { timeout: 10_000 }
      ),
      (async () => {
        await page.getByTestId('button-upgrade-plan').click();
        await page.waitForTimeout(300);
        await page.getByTestId('button-select-plan-pro').click();
      })(),
    ]);

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('url');
    expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(body).toHaveProperty('sessionId');
    expect(body.sessionId).toMatch(/^cs_test_/);
  });

  test('plan dialog shows included features for each plan', async ({ page }) => {
    await page.getByTestId('button-upgrade-plan').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await expect(page.getByText('5 active campaigns')).toBeVisible();
    await expect(page.getByText('Unlimited campaigns')).toBeVisible();
  });

  test('checkout=success shows subscription activated banner', async ({ page }) => {
    await page.goto(`${BASE}/brand/settings/subscription?checkout=success`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Subscription activated')).toBeVisible();
  });

  test('checkout=cancelled shows cancelled banner', async ({ page }) => {
    await page.goto(`${BASE}/brand/settings/subscription?checkout=cancelled`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Checkout was cancelled')).toBeVisible();
  });
});

test.describe('Brand Subscription — Post-Webhook State Verification', () => {
  test.beforeAll(async () => {
    await registerBrandUser();
  });

  test('after checkout.session.completed webhook, brand subscription page shows Active badge', async ({ browser }) => {
    if (!brandUserId) test.skip(true, 'Brand user ID not captured during registration');

    // --- Admin context: fire the webhook for the brand user ---
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await adminPage.goto(`${BASE}/login`);
    await adminPage.waitForLoadState('networkidle');
    await adminPage.getByTestId('input-login-email').fill(ADMIN_EMAIL);
    await adminPage.getByTestId('input-login-password').fill(ADMIN_PASSWORD);
    await adminPage.getByTestId('button-login-submit').click();
    await adminPage.waitForURL(`${BASE}/creator`, { timeout: 10_000 });

    await adminPage.evaluate(async ({ base, userId }) => {
      await fetch(`${base}/api/dev/stripe/ensure-plans`, { method: 'POST', credentials: 'include' });
      await fetch(`${base}/api/dev/stripe/simulate-webhook`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, plan: 'pro', eventType: 'checkout.session.completed' }),
      });
    }, { base: BASE, userId: brandUserId });

    await adminCtx.close();

    // --- Brand context: verify the UI shows Active badge and Pro Plan label ---
    const brandCtx = await browser.newContext();
    const brandPage = await brandCtx.newPage();
    await brandPage.goto(`${BASE}/login`);
    await brandPage.waitForLoadState('networkidle');
    await brandPage.getByTestId('input-login-email').fill(BRAND_EMAIL);
    await brandPage.getByTestId('input-login-password').fill(BRAND_PASSWORD);
    await brandPage.getByTestId('button-login-submit').click();
    await brandPage.waitForURL(`${BASE}/brand`, { timeout: 10_000 });

    await brandPage.goto(`${BASE}/brand/settings/subscription`);
    await brandPage.waitForLoadState('networkidle');

    const badge = brandPage.getByTestId('badge-subscription-status');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('Active');
    // Pro checkout was completed → UI must show "Pro Plan" label
    await expect(brandPage.getByText('Pro Plan')).toBeVisible();

    await brandCtx.close();
  });

  test('after invoice.payment_failed webhook, brand subscription page shows Past Due badge', async ({ browser }) => {
    if (!brandUserId) test.skip(true, 'Brand user ID not captured during registration');

    // Admin fires checkout.session.completed then invoice.payment_failed
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await adminPage.goto(`${BASE}/login`);
    await adminPage.waitForLoadState('networkidle');
    await adminPage.getByTestId('input-login-email').fill(ADMIN_EMAIL);
    await adminPage.getByTestId('input-login-password').fill(ADMIN_PASSWORD);
    await adminPage.getByTestId('button-login-submit').click();
    await adminPage.waitForURL(`${BASE}/creator`, { timeout: 10_000 });

    await adminPage.evaluate(async ({ base, userId }) => {
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
    }, { base: BASE, userId: brandUserId });

    await adminCtx.close();

    // Brand context: verify Past Due badge
    const brandCtx = await browser.newContext();
    const brandPage = await brandCtx.newPage();
    await brandPage.goto(`${BASE}/login`);
    await brandPage.waitForLoadState('networkidle');
    await brandPage.getByTestId('input-login-email').fill(BRAND_EMAIL);
    await brandPage.getByTestId('input-login-password').fill(BRAND_PASSWORD);
    await brandPage.getByTestId('button-login-submit').click();
    await brandPage.waitForURL(`${BASE}/brand`, { timeout: 10_000 });

    await brandPage.goto(`${BASE}/brand/settings/subscription`);
    await brandPage.waitForLoadState('networkidle');

    const badge = brandPage.getByTestId('badge-subscription-status');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('Past Due');

    await brandCtx.close();
  });
});
