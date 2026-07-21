/**
 * Authenticated brand + affiliate role passes against the LIVE app.
 *
 * Mirrors the creator journey in production-smoke.spec.ts for the other two roles:
 * login -> dashboard -> every key page -> money/settings -> session persistence ->
 * admin-block -> logout, scanning each page for uncaught JS errors and crashes.
 *
 * Requires env: PLAYWRIGHT_BASE_URL, and verified logins:
 *   BRAND_EMAIL / BRAND_PASSWORD, AFFILIATE_EMAIL / AFFILIATE_PASSWORD.
 */
import { test, expect, Page } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://materialized-app.vercel.app';
const SHOT_DIR = 'test-results/prod-roles';

const ROLES = {
  brand: {
    email: process.env.BRAND_EMAIL,
    password: process.env.BRAND_PASSWORD,
    home: '/brand',
    pages: [
      '/brand/inventory',
      '/brand/creators',
      '/brand/campaigns',
      '/brand/analytics',
      '/brand/library',
      '/brand/settings/subscription',
      '/brand/settings/payout',
      '/brand/settings/transactions',
      '/brand/mailbox',
    ],
    checkoutApi: '/api/brand/subscription/checkout',
  },
  affiliate: {
    email: process.env.AFFILIATE_EMAIL,
    password: process.env.AFFILIATE_PASSWORD,
    home: '/affiliate',
    pages: [
      '/affiliate/library',
      '/affiliate/campaigns',
      '/affiliate/analytics',
      '/affiliate/settings',
      '/affiliate/playlists',
      '/affiliate/mailbox',
    ],
    checkoutApi: null, // publishers don't subscribe; they onboard for payouts
  },
} as const;

function watchErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  return { consoleErrors, pageErrors };
}

async function assertNoCrash(page: Page, label: string) {
  await expect(page.locator('#root')).toBeVisible();
  expect(await page.getByText('Something went wrong', { exact: false }).count(), `${label}: error boundary`).toBe(0);
  const bodyLen = (await page.locator('body').innerText()).trim().length;
  expect(bodyLen, `${label}: no visible text`).toBeGreaterThan(30);
}

function appErrors(errs: string[]) {
  return errs.filter(
    (e) =>
      !/favicon|analytics|gtag|Failed to load resource.*(404|401)|net::ERR_|Download the React DevTools|sourcemap/i.test(
        e,
      ),
  );
}

for (const [role, cfg] of Object.entries(ROLES)) {
  test.describe(`Authenticated ${role} journey`, () => {
    test.skip(!cfg.email || !cfg.password, `${role.toUpperCase()}_EMAIL / _PASSWORD not set`);

    test(`login, dashboard, key pages, session, admin-block, logout`, async ({ page }) => {
      test.setTimeout(120_000); // long multi-page journey against a live app
      const { consoleErrors, pageErrors } = watchErrors(page);

      await test.step(`login -> ${cfg.home}`, async () => {
        await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('input-login-email').fill(cfg.email!);
        await page.getByTestId('input-login-password').fill(cfg.password!);
        await page.getByTestId('button-login-submit').click();
        await page.waitForURL(`**${cfg.home}`, { timeout: 20_000 });
        await assertNoCrash(page, `${role} dashboard`);
        await page.screenshot({ path: `${SHOT_DIR}/${role}-00-dashboard.png`, fullPage: true });
      });

      for (let i = 0; i < cfg.pages.length; i++) {
        const path = cfg.pages[i];
        await test.step(`page loads: ${path}`, async () => {
          await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(1500);
          expect(page.url(), `${path} bounced to login`).not.toContain('/login');
          await assertNoCrash(page, path);
          await page.screenshot({
            path: `${SHOT_DIR}/${role}-${String(i + 1).padStart(2, '0')}-${path.split('/').pop()}.png`,
            fullPage: true,
          });
        });
      }

      if (cfg.checkoutApi) {
        await test.step('Stripe checkout session is created (money entry point)', async () => {
          const result = await page.evaluate(async (api) => {
            const r = await fetch(api, {
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
          }, cfg.checkoutApi);
          console.log(`[${role} checkout] status=${result.status} body=${JSON.stringify(result.body)}`);
          expect(result.status, 'checkout not reachable/authed').toBeLessThan(500);
          const url: string = result.body?.url ?? result.body?.checkoutUrl ?? '';
          expect(url, `no Stripe url (got ${JSON.stringify(result.body)})`).toMatch(/stripe\.com/);
        });
      }

      await test.step('session persists across reload', async () => {
        await page.goto(`${BASE}${cfg.home}`, { waitUntil: 'domcontentloaded' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
        expect(page.url(), 'reload lost session').toContain(cfg.home);
      });

      await test.step('non-admin is kept out of /admin', async () => {
        await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
        expect(page.url(), `${role} reached /admin`).not.toMatch(/\/admin(\/|$)/);
      });

      await test.step('logout returns to public state', async () => {
        const btn = page.getByTestId('button-logout').or(page.getByTestId('button-sidebar-logout'));
        if (await btn.count()) {
          await btn.first().click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(2000);
        }
        await page.goto(`${BASE}${cfg.home}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        expect(page.url(), 'still authenticated after logout').toContain('/login');
      });

      await test.step('no uncaught JS errors across the journey', async () => {
        expect(appErrors(pageErrors), `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
        const bad = appErrors(consoleErrors);
        if (bad.length) console.log(`[advisory] ${role} console errors:\n  ${bad.join('\n  ')}`);
      });
    });
  });
}
