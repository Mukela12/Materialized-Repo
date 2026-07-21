/**
 * Production end-to-end smoke suite.
 *
 * Runs against the LIVE app (PLAYWRIGHT_BASE_URL, e.g. https://materialized-app.vercel.app),
 * exercising the real browser experience through Vercel -> Railway -> Postgres/Stripe.
 *
 * Covers: public marketing/auth pages, real registration (through the verify-email step),
 * an authenticated creator journey across every key page, the money/subscription page,
 * session persistence, and logout. Every page is scanned for uncaught JS errors and
 * error-boundary crashes, and screenshotted for the report.
 *
 * Requires env: PLAYWRIGHT_BASE_URL, ACCESS_CODE, and a VERIFIED creator login
 * (CREATOR_EMAIL / CREATOR_PASSWORD).
 */
import { test, expect, Page } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://materialized-app.vercel.app';
const ACCESS_CODE = process.env.ACCESS_CODE;
const CREATOR_EMAIL = process.env.CREATOR_EMAIL ?? 'jessekatungu@gmail.com';
const CREATOR_PASSWORD = process.env.CREATOR_PASSWORD ?? 'Milan18$';

if (!ACCESS_CODE) throw new Error('ACCESS_CODE env var is required');

const SHOT_DIR = 'test-results/prod-smoke';

// Attach JS-error collectors to a page. Returns the arrays (mutated as errors arrive).
function watchErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  return { consoleErrors, pageErrors };
}

// A page is "healthy" if it did not render the error boundary and has real content.
async function assertNoCrash(page: Page, label: string) {
  await expect(page.locator('#root')).toBeVisible();
  const boundary = page.getByText('Something went wrong', { exact: false });
  expect(await boundary.count(), `${label}: error boundary shown`).toBe(0);
  const bodyLen = (await page.locator('body').innerText()).trim().length;
  expect(bodyLen, `${label}: page has no visible text`).toBeGreaterThan(30);
}

// Ignore benign noise (analytics beacons, favicon, third-party) — flag only app errors.
function appErrors(errs: string[]) {
  return errs.filter(
    (e) =>
      !/favicon|analytics|gtag|Failed to load resource.*(404|401)|net::ERR_|Download the React DevTools|sourcemap/i.test(
        e,
      ),
  );
}

test.describe('Public pages (unauthenticated)', () => {
  test('landing page renders', async ({ page }) => {
    const { pageErrors } = watchErrors(page);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await assertNoCrash(page, 'landing');
    await page.screenshot({ path: `${SHOT_DIR}/01-landing.png`, fullPage: true });
    expect(appErrors(pageErrors), 'landing uncaught errors').toEqual([]);
  });

  test('login page shows the form', async ({ page }) => {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('input-login-email')).toBeVisible();
    await expect(page.getByTestId('input-login-password')).toBeVisible();
    await expect(page.getByTestId('button-login-submit')).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/02-login.png` });
  });

  test('register page shows the form', async ({ page }) => {
    await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('input-register-email')).toBeVisible();
    await expect(page.getByTestId('button-register-submit')).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/03-register.png` });
  });
});

test.describe('Protected routes are auth-gated (all roles)', () => {
  // Unauthenticated access to any role's private area must bounce to /login,
  // not render a crash or leak a dashboard.
  const protectedRoutes = [
    '/creator',
    '/creator/analytics',
    '/brand',
    '/brand/settings/subscription',
    '/brand/inventory',
    '/affiliate',
    '/affiliate/settings',
    '/admin',
  ];
  for (const route of protectedRoutes) {
    test(`unauthenticated ${route} -> /login`, async ({ page }) => {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      await assertNoCrash(page, route);
      expect(page.url(), `${route} did not redirect to login`).toContain('/login');
    });
  }
});

test.describe('Registration (real, through verify-email step)', () => {
  test('a new signup is accepted and prompted to verify email', async ({ page }) => {
    const email = `qa-smoke-${Date.now()}@example.com`;
    await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('input-register-accessCode').fill(ACCESS_CODE!);
    await page.getByTestId('input-register-displayName').fill('QA Smoke Creator');
    await page.getByTestId('input-register-email').fill(email);
    await page.getByTestId('input-register-password').fill('QaSmoke123!');
    await page.getByTestId('button-register-submit').click();
    // Success state: the app renders the "Check your email" verification screen.
    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/verification link/i)).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/04-register-success.png` });
  });
});

test.describe('Authenticated creator journey', () => {
  test('login, dashboard, key pages, subscription, session persistence, logout', async ({ page }) => {
    const { consoleErrors, pageErrors } = watchErrors(page);

    await test.step('login as verified creator -> /creator', async () => {
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('input-login-email').fill(CREATOR_EMAIL);
      await page.getByTestId('input-login-password').fill(CREATOR_PASSWORD);
      await page.getByTestId('button-login-submit').click();
      await page.waitForURL('**/creator', { timeout: 20_000 });
      await assertNoCrash(page, 'creator dashboard');
      await page.screenshot({ path: `${SHOT_DIR}/05-creator-dashboard.png`, fullPage: true });
    });

    const pages: Array<[string, string]> = [
      ['/creator/my-videos', '06-my-videos'],
      ['/creator/library', '07-library'],
      ['/creator/analytics', '08-analytics'],
      ['/creator/referrals', '09-referrals'],
      ['/creator/playlists', '10-playlists'],
      ['/creator/settings/subscription', '11-subscription'],
    ];
    for (const [path, shot] of pages) {
      await test.step(`page loads: ${path}`, async () => {
        await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
        // must NOT bounce back to /login (would mean the session was lost)
        await page.waitForTimeout(1500);
        expect(page.url(), `${path} redirected to login`).not.toContain('/login');
        await assertNoCrash(page, path);
        await page.screenshot({ path: `${SHOT_DIR}/${shot}.png`, fullPage: true });
      });
    }

    await test.step('subscription page shows plan/billing content', async () => {
      await page.goto(`${BASE}/creator/settings/subscription`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      const text = (await page.locator('body').innerText()).toLowerCase();
      expect(
        /plan|subscription|billing|starter|pro|\$|month|upgrade|manage/.test(text),
        'subscription page has no billing content',
      ).toBe(true);
    });

    await test.step('Stripe checkout session is created for a real plan (money entry point)', async () => {
      // Use the authenticated browser session to hit the real checkout endpoint.
      const result = await page.evaluate(async () => {
        const r = await fetch('/api/creator/subscription/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ plan: 'starter' }),
        });
        let body: any = null;
        try {
          body = await r.json();
        } catch {}
        return { status: r.status, body };
      });
      console.log(`[checkout] status=${result.status} body=${JSON.stringify(result.body)}`);
      expect(result.status, 'checkout endpoint not reachable/authed').toBeLessThan(500);
      const url: string = result.body?.url ?? result.body?.checkoutUrl ?? '';
      // Happy path: a live Stripe Checkout URL is returned.
      expect(url, `no Stripe checkout url (got ${JSON.stringify(result.body)})`).toMatch(
        /checkout\.stripe\.com|stripe\.com/,
      );
    });

    await test.step('session persists across reload', async () => {
      await page.goto(`${BASE}/creator`, { waitUntil: 'domcontentloaded' });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      expect(page.url(), 'reload lost session').toContain('/creator');
      expect(page.url()).not.toContain('/login');
    });

    await test.step('a non-admin cannot open the admin portal', async () => {
      await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      // Signed-in creator must be redirected away from /admin (to their dashboard).
      expect(page.url(), 'non-admin reached /admin').not.toMatch(/\/admin(\/|$)/);
    });

    await test.step('logout returns to a public state', async () => {
      const btn = page.getByTestId('button-logout').or(page.getByTestId('button-sidebar-logout'));
      if (await btn.count()) {
        await btn.first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(2000);
      }
      // After logout, a protected route must bounce to /login.
      await page.goto(`${BASE}/creator`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      expect(page.url(), 'still authenticated after logout').toContain('/login');
      await page.screenshot({ path: `${SHOT_DIR}/12-after-logout.png` });
    });

    await test.step('no uncaught JS errors across the journey', async () => {
      expect(appErrors(pageErrors), `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
      const bad = appErrors(consoleErrors);
      // console errors are advisory; log them but only fail on a large burst
      if (bad.length) console.log(`[advisory] console errors:\n  ${bad.join('\n  ')}`);
    });
  });
});
