/**
 * Real Stripe Checkout E2E — Test card completion on Stripe hosted page
 *
 * These tests open the actual Stripe Checkout URL (checkout.stripe.com),
 * fill in Stripe test card 4242 4242 4242 4242, submit the form, and verify:
 *   1. Stripe redirects back to the app's success URL
 *   2. The "Subscription activated" success banner is displayed
 *
 * Test card: 4242 4242 4242 4242 | Exp 12/34 | CVC 424
 *
 * ENVIRONMENT NOTE:
 * Stripe hosted checkout renders payment fields directly on checkout.stripe.com.
 * Card fields may use Stripe Elements iframes; we use frameLocator to target them.
 */
import { test, expect, Page } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5000';
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;
const ACCESS_CODE = process.env.ACCESS_CODE;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !ACCESS_CODE) {
  throw new Error('TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, and ACCESS_CODE environment variables are required');
}

async function loginUser(page: Page, email: string, password: string, redirectPath: string): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('input-login-email').fill(email);
  await page.getByTestId('input-login-password').fill(password);
  await page.getByTestId('button-login-submit').click();
  await page.waitForURL(`${BASE}${redirectPath}`, { timeout: 15_000 });
}

async function getCheckoutSession(
  page: Page,
  plan: 'starter' | 'pro',
  role: 'creator' | 'brand'
): Promise<{ url: string; sessionId: string }> {
  const endpoint = role === 'creator'
    ? '/api/creator/subscription/checkout'
    : '/api/brand/subscription/checkout';

  const data: { url?: string; sessionId?: string } = await page.evaluate(
    async ({ base, endpoint, plan }: { base: string; endpoint: string; plan: string }) => {
      const res = await fetch(`${base}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Checkout request failed: ${res.status}`);
      return res.json();
    },
    { base: BASE, endpoint, plan }
  );

  if (!data.url || !data.sessionId) {
    throw new Error(`Invalid checkout response: ${JSON.stringify(data)}`);
  }
  return { url: data.url, sessionId: data.sessionId };
}

async function getSessionMetadata(
  page: Page,
  sessionId: string
): Promise<{ mode: string; status: string; metadata: Record<string, string>; line_items: Array<{ amount_total: number; price?: { metadata?: Record<string, string> } }> }> {
  return page.evaluate(
    async ({ base, sessionId }: { base: string; sessionId: string }) => {
      const r = await fetch(`${base}/api/dev/stripe/checkout-session/${sessionId}`, { credentials: 'include' });
      if (!r.ok) throw new Error(`Session fetch failed: ${r.status}`);
      return r.json();
    },
    { base: BASE, sessionId }
  );
}

async function fillStripeCheckoutCard(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');

  const cardNumberInput = page.frameLocator('iframe[title="Secure card number input frame"]')
    .locator('input[autocomplete="cc-number"], input[name="cardnumber"], input[placeholder*="1234"]')
    .first();

  const isEmbedded = await cardNumberInput.count().then(n => n > 0);

  if (isEmbedded) {
    await cardNumberInput.waitFor({ timeout: 20_000 });
    await cardNumberInput.fill('4242424242424242');

    const expiryInput = page.frameLocator('iframe[title="Secure expiration date input frame"]')
      .locator('input[autocomplete="cc-exp"], input[name="exp-date"]')
      .first();
    await expiryInput.fill('1234');

    const cvcInput = page.frameLocator('iframe[title="Secure CVC input frame"]')
      .locator('input[autocomplete="cc-csc"], input[name="cvc"]')
      .first();
    await cvcInput.fill('424');
  } else {
    const directCard = page.locator(
      'input[placeholder="1234 1234 1234 1234"], input[placeholder*="card number"], input[autocomplete="cc-number"]'
    ).first();
    await directCard.waitFor({ timeout: 20_000 });
    await directCard.fill('4242424242424242');

    const directExpiry = page.locator(
      'input[placeholder="MM / YY"], input[placeholder="MM/YY"], input[autocomplete="cc-exp"]'
    ).first();
    await directExpiry.fill('1234');

    const directCvc = page.locator(
      'input[placeholder="CVC"], input[placeholder="CVV"], input[autocomplete="cc-csc"]'
    ).first();
    await directCvc.fill('424');
  }
}

async function submitCheckoutAndAssertRedirect(page: Page, successUrlSubstring: string): Promise<void> {
  const submitBtn = page.getByRole('button', { name: /pay|subscribe|continue/i }).first();
  await expect(submitBtn).toBeEnabled({ timeout: 10_000 });

  await Promise.all([
    page.waitForURL(url => url.toString().includes(successUrlSubstring), { timeout: 60_000 }),
    submitBtn.click(),
  ]);

  expect(page.url()).toContain(successUrlSubstring);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Subscription activated')).toBeVisible({ timeout: 15_000 });
}

test.describe('Stripe Checkout — Creator Starter', () => {
  test.setTimeout(120_000);

  test('checkout session is valid Stripe URL with correct plan metadata', async ({ page }) => {
    await loginUser(page, ADMIN_EMAIL!, ADMIN_PASSWORD!, '/creator');

    const { url, sessionId } = await getCheckoutSession(page, 'starter', 'creator');

    expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(sessionId).toMatch(/^cs_test_/);

    const session = await getSessionMetadata(page, sessionId);
    expect(session.mode).toBe('subscription');
    expect(session.status).toBe('open');
    expect(session.metadata?.plan).toBe('starter');
    expect(session.line_items?.[0]?.amount_total).toBe(24900);
  });

  test('complete Starter checkout with test card → redirect → success banner', async ({ page }) => {
    await loginUser(page, ADMIN_EMAIL!, ADMIN_PASSWORD!, '/creator');

    const { url } = await getCheckoutSession(page, 'starter', 'creator');

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    expect(page.url()).toContain('stripe.com');

    await fillStripeCheckoutCard(page);
    await submitCheckoutAndAssertRedirect(page, 'creator/settings/subscription');
    expect(page.url()).toContain('checkout=success');
  });
});

test.describe('Stripe Checkout — Creator Pro', () => {
  test.setTimeout(120_000);

  test('checkout session is valid Stripe URL with correct Pro plan metadata', async ({ page }) => {
    await loginUser(page, ADMIN_EMAIL!, ADMIN_PASSWORD!, '/creator');

    const { url, sessionId } = await getCheckoutSession(page, 'pro', 'creator');

    expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(sessionId).toMatch(/^cs_test_/);

    const session = await getSessionMetadata(page, sessionId);
    expect(session.mode).toBe('subscription');
    expect(session.status).toBe('open');
    expect(session.metadata?.plan).toBe('pro');
    expect(session.line_items?.[0]?.amount_total).toBe(49900);
    expect(session.line_items?.[0]?.price?.metadata?.plan).toBe('pro');
  });

  test('complete Pro checkout with test card → redirect → success banner', async ({ page }) => {
    await loginUser(page, ADMIN_EMAIL!, ADMIN_PASSWORD!, '/creator');

    const { url } = await getCheckoutSession(page, 'pro', 'creator');

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    expect(page.url()).toContain('stripe.com');

    await fillStripeCheckoutCard(page);
    await submitCheckoutAndAssertRedirect(page, 'creator/settings/subscription');
    expect(page.url()).toContain('checkout=success');
  });
});

test.describe('Stripe Checkout — Creator redirect banners', () => {
  test.setTimeout(30_000);

  test('cancel URL shows "Checkout was cancelled" banner', async ({ page }) => {
    await loginUser(page, ADMIN_EMAIL!, ADMIN_PASSWORD!, '/creator');
    await page.goto(`${BASE}/creator/settings/subscription?checkout=cancelled`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Checkout was cancelled')).toBeVisible({ timeout: 10_000 });
  });

  test('success URL shows "Subscription activated" banner', async ({ page }) => {
    await loginUser(page, ADMIN_EMAIL!, ADMIN_PASSWORD!, '/creator');
    await page.goto(`${BASE}/creator/settings/subscription?checkout=success`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Subscription activated')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Stripe Checkout — Brand Starter', () => {
  test.setTimeout(120_000);

  let brandEmail: string;
  const brandPassword = 'BrandCheckoutE2E123!';

  test.beforeAll(async () => {
    brandEmail = `brand-checkout-e2e-${Date.now()}@example.com`;
    const res = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: brandEmail,
        password: brandPassword,
        displayName: 'Brand Checkout E2E',
        role: 'brand',
        username: `brand_checkout_${Date.now()}`,
        accessCode: ACCESS_CODE,
      }),
    });
    expect(res.ok || res.status === 409, `brand registration status ${res.status}`).toBeTruthy();
  });

  test('Brand Starter checkout session is valid Stripe URL with correct plan metadata', async ({ page }) => {
    await loginUser(page, brandEmail, brandPassword, '/brand');

    const { url, sessionId } = await getCheckoutSession(page, 'starter', 'brand');

    expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(sessionId).toMatch(/^cs_test_/);

    const session = await getSessionMetadata(page, sessionId);
    expect(session.mode).toBe('subscription');
    expect(session.status).toBe('open');
    expect(session.metadata?.plan).toBe('starter');
    expect(session.line_items?.[0]?.amount_total).toBe(24900);
  });

  test('complete Brand Starter checkout with test card → redirect → success banner', async ({ page }) => {
    await loginUser(page, brandEmail, brandPassword, '/brand');

    const { url } = await getCheckoutSession(page, 'starter', 'brand');

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    expect(page.url()).toContain('stripe.com');

    await fillStripeCheckoutCard(page);
    await submitCheckoutAndAssertRedirect(page, 'brand/settings/subscription');
    expect(page.url()).toContain('checkout=success');
  });

  test('Brand cancel URL shows "Checkout was cancelled" banner', async ({ page }) => {
    await loginUser(page, brandEmail, brandPassword, '/brand');
    await page.goto(`${BASE}/brand/settings/subscription?checkout=cancelled`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Checkout was cancelled')).toBeVisible({ timeout: 10_000 });
  });

  test('Brand success URL shows "Subscription activated" banner', async ({ page }) => {
    await loginUser(page, brandEmail, brandPassword, '/brand');
    await page.goto(`${BASE}/brand/settings/subscription?checkout=success`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Subscription activated')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Stripe Checkout — Brand Pro', () => {
  test.setTimeout(120_000);

  let brandEmail: string;
  const brandPassword = 'BrandProCheckoutE2E123!';

  test.beforeAll(async () => {
    brandEmail = `brand-pro-checkout-${Date.now()}@example.com`;
    const res = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: brandEmail,
        password: brandPassword,
        displayName: 'Brand Pro Checkout E2E',
        role: 'brand',
        username: `brand_pro_${Date.now()}`,
        accessCode: ACCESS_CODE,
      }),
    });
    expect(res.ok || res.status === 409, `brand pro registration status ${res.status}`).toBeTruthy();
  });

  test('Brand Pro checkout session is valid Stripe URL with correct Pro plan metadata', async ({ page }) => {
    await loginUser(page, brandEmail, brandPassword, '/brand');

    const { url, sessionId } = await getCheckoutSession(page, 'pro', 'brand');

    expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(sessionId).toMatch(/^cs_test_/);

    const session = await getSessionMetadata(page, sessionId);
    expect(session.mode).toBe('subscription');
    expect(session.status).toBe('open');
    expect(session.metadata?.plan).toBe('pro');
    expect(session.line_items?.[0]?.amount_total).toBe(49900);
    expect(session.line_items?.[0]?.price?.metadata?.plan).toBe('pro');
  });

  test('complete Brand Pro checkout with test card → redirect → success banner', async ({ page }) => {
    await loginUser(page, brandEmail, brandPassword, '/brand');

    const { url } = await getCheckoutSession(page, 'pro', 'brand');

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    expect(page.url()).toContain('stripe.com');

    await fillStripeCheckoutCard(page);
    await submitCheckoutAndAssertRedirect(page, 'brand/settings/subscription');
    expect(page.url()).toContain('checkout=success');
  });
});
