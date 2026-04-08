import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5000';
const ACCESS_CODE = process.env.ACCESS_CODE;

if (!ACCESS_CODE) {
  throw new Error('ACCESS_CODE environment variable is required');
}

// Affiliate-specific test credentials — registered once per test run via API
const AFFILIATE_EMAIL = `affiliate-e2e-${Date.now()}@example.com`;
const AFFILIATE_PASSWORD = 'AffiliateE2E123!';

let affiliateUserId: string | null = null;

async function registerAffiliateUser() {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: AFFILIATE_EMAIL,
      password: AFFILIATE_PASSWORD,
      displayName: 'Affiliate E2E Test',
      role: 'affiliate',
      accessCode: ACCESS_CODE,
    }),
  });
  if (res.ok) {
    const data = await res.json();
    affiliateUserId = data.id ?? data.user?.id ?? null;
  }
  return res.ok || res.status === 409;
}

test.describe('Affiliate Settings — Unauthenticated / Demo View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/affiliate/settings`);
    await page.waitForLoadState('networkidle');
  });

  test('renders Payout Settings heading', async ({ page }) => {
    await expect(page.getByTestId('text-page-title')).toBeVisible();
    await expect(page.getByTestId('text-page-title')).toHaveText('Payout Settings');
  });

  test('renders Account Overview card with email and commission rate', async ({ page }) => {
    await expect(page.getByText('Account Overview')).toBeVisible();
    await expect(page.getByTestId('text-user-email')).toBeVisible();
    await expect(page.getByTestId('text-commission-rate')).toBeVisible();
  });

  test('renders Payout Account card', async ({ page }) => {
    await expect(page.getByText('Payout Account')).toBeVisible();
    await expect(page.getByText('Connect your bank account to receive affiliate commissions')).toBeVisible();
  });

  test('renders Payout Schedule card with monthly frequency', async ({ page }) => {
    await expect(page.getByText('Payout Schedule')).toBeVisible();
    await expect(page.getByText('Monthly')).toBeVisible();
  });

  test('shows Create Payout Account or Complete Onboarding button based on connect status', async ({ page }) => {
    const createBtn = page.getByTestId('button-create-payout-account');
    const onboardBtn = page.getByTestId('button-complete-onboarding');
    const payoutsActive = page.getByText('Payouts Active');

    const createVisible = await createBtn.isVisible().catch(() => false);
    const onboardVisible = await onboardBtn.isVisible().catch(() => false);
    const payoutsVisible = await payoutsActive.isVisible().catch(() => false);

    expect(createVisible || onboardVisible || payoutsVisible).toBe(true);
  });

  test('GET /api/stripe/connect/status returns connected and onboarded booleans', async ({ request }) => {
    const response = await request.get(`${BASE}/api/stripe/connect/status`);
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body).toHaveProperty('connected');
    expect(body).toHaveProperty('onboarded');
    expect(typeof body.connected).toBe('boolean');
    expect(typeof body.onboarded).toBe('boolean');
  });
});

test.describe('Affiliate Settings — Authenticated Affiliate User — Stripe Connect Onboarding', () => {
  test.beforeAll(async () => {
    await registerAffiliateUser();
  });

  test('Create Payout Account then Complete Onboarding redirects to Stripe Connect URL', async ({ page }) => {
    // Log in as the affiliate user
    await page.goto(`${BASE}/login`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('input-login-email').fill(AFFILIATE_EMAIL);
    await page.getByTestId('input-login-password').fill(AFFILIATE_PASSWORD);
    await page.getByTestId('button-login-submit').click();
    await page.waitForURL(`${BASE}/affiliate`, { timeout: 10_000 });

    await page.goto(`${BASE}/affiliate/settings`);
    await page.waitForLoadState('networkidle');

    // Step 1: If not yet connected, click "Create Payout Account"
    const createBtn = page.getByTestId('button-create-payout-account');
    if (await createBtn.isVisible()) {
      const [createRes] = await Promise.all([
        page.waitForResponse(
          r => r.url().includes('/api/stripe/connect/create') && r.request().method() === 'POST',
          { timeout: 15_000 }
        ),
        createBtn.click(),
      ]);
      expect(createRes.status()).toBe(200);
      // Wait for UI to refresh and show "Complete Onboarding" button
      await page.waitForLoadState('networkidle');
    }

    // Step 2: Click "Complete Onboarding" — intercept the popup/redirect URL
    const onboardBtn = page.getByTestId('button-complete-onboarding');
    await expect(onboardBtn).toBeVisible({ timeout: 10_000 });

    // Intercept the onboarding API response to verify the Stripe Connect URL
    const [onboardRes] = await Promise.all([
      page.waitForResponse(
        r => r.url().includes('/api/stripe/connect/onboarding') && r.request().method() === 'POST',
        { timeout: 15_000 }
      ),
      onboardBtn.click(),
    ]);

    expect(onboardRes.status()).toBe(200);
    const onboardBody = await onboardRes.json();
    expect(onboardBody).toHaveProperty('url');
    expect(typeof onboardBody.url).toBe('string');
    // Stripe Express onboarding URL must contain connect.stripe.com
    expect(onboardBody.url).toMatch(/^https:\/\/connect\.stripe\.com\//);
  });

  test('Connect status API returns connected=true after account creation', async ({ page }) => {
    if (!affiliateUserId) test.skip(true, 'Affiliate user ID not captured during registration');

    await page.goto(`${BASE}/login`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('input-login-email').fill(AFFILIATE_EMAIL);
    await page.getByTestId('input-login-password').fill(AFFILIATE_PASSWORD);
    await page.getByTestId('button-login-submit').click();
    await page.waitForURL(`${BASE}/affiliate`, { timeout: 10_000 });

    const res = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/api/stripe/connect/status`, { credentials: 'include' });
      return r.json();
    }, BASE);

    expect(res).toHaveProperty('connected');
    expect(res).toHaveProperty('onboarded');
    // After Create Payout Account was called in the prior test, connected should be true
    expect(res.connected).toBe(true);
    expect(typeof res.onboarded).toBe('boolean');
  });
});
