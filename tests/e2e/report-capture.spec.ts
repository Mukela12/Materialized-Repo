/**
 * QA report capture — screenshots every page for each role against the LIVE app,
 * flagging pages that crash (error boundary) or throw console/page errors.
 * Not a normal test; run explicitly with the report creds. Writes PNGs + a JSON
 * status file to REPORT_DIR.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://materialized-app.vercel.app';
const DIR = process.env.REPORT_DIR ?? 'test-results/qa-report';
fs.mkdirSync(DIR, { recursive: true });

const ACCOUNTS = {
  creator: { email: process.env.CREATOR_EMAIL!, password: process.env.CREATOR_PASSWORD!, home: '/creator', pages: [
    ['dashboard', '/creator'],
    ['my-videos', '/creator/my-videos'],
    ['video-library', '/creator/library'],
    ['playlists', '/creator/playlists'],
    ['wishlist', '/creator/wishlist'],
    ['analytics', '/creator/analytics'],
    ['crm', '/creator/crm'],
    ['affiliates', '/creator/affiliates'],
    ['referrals', '/creator/referrals'],
    ['brand-kit', '/creator/brand-kit'],
    ['rewards', '/creator/rewards'],
    ['profile', '/creator/profile'],
    ['mailbox', '/creator/mailbox'],
    ['more', '/creator/more'],
    ['help', '/creator/help'],
    ['subscription', '/creator/settings/subscription'],
  ] },
  brand: { email: process.env.BRAND_EMAIL!, password: process.env.BRAND_PASSWORD!, home: '/brand', pages: [
    ['dashboard', '/brand'],
    ['inventory', '/brand/inventory'],
    ['creators', '/brand/creators'],
    ['campaigns', '/brand/campaigns'],
    ['analytics', '/brand/analytics'],
    ['video-library', '/brand/library'],
    ['playlists', '/brand/playlists'],
    ['wishlist', '/brand/wishlist'],
    ['brand-kit', '/brand/brand-kit'],
    ['mailbox', '/brand/mailbox'],
    ['profile', '/brand/profile'],
    ['settings', '/brand/settings'],
    ['subscription', '/brand/settings/subscription'],
    ['billing-history', '/brand/settings/billing-history'],
    ['transactions', '/brand/settings/transactions'],
    ['payout', '/brand/settings/payout'],
    ['billing-address', '/brand/settings/billing-address'],
    ['api-key', '/brand/settings/api-key'],
    ['help', '/brand/help'],
  ] },
  affiliate: { email: process.env.AFFILIATE_EMAIL!, password: process.env.AFFILIATE_PASSWORD!, home: '/affiliate', pages: [
    ['dashboard', '/affiliate'],
    ['video-library', '/affiliate/library'],
    ['campaigns', '/affiliate/campaigns'],
    ['analytics', '/affiliate/analytics'],
    ['playlists', '/affiliate/playlists'],
    ['wishlist', '/affiliate/wishlist'],
    ['brand-kit', '/affiliate/brand-kit'],
    ['mailbox', '/affiliate/mailbox'],
    ['settings-payout', '/affiliate/settings'],
    ['help', '/affiliate/help'],
  ] },
} as const;

test.use({ viewport: { width: 1440, height: 1000 } });

const results: any[] = [];

function isAppError(t: string) {
  return !/favicon|analytics|gtag|Failed to load resource|net::ERR_|React DevTools|sourcemap|Manifest|preload/i.test(t);
}

async function login(page: Page, email: string, password: string, home: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('input-login-email').fill(email);
  await page.getByTestId('input-login-password').fill(password);
  await page.getByTestId('button-login-submit').click();
  await page.waitForURL(`**${home}`, { timeout: 20000 });
}

test.describe('public', () => {
  for (const [name, path] of [['landing', '/'], ['login', '/login'], ['register', '/register']] as const) {
    test(`public-${name}`, async ({ page }) => {
      const errs: string[] = [];
      page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      const crash = await page.getByText('Something went wrong', { exact: false }).count();
      await page.screenshot({ path: `${DIR}/public-${name}.png` });
      results.push({ role: 'public', name, path, crash: crash > 0, errors: errs.filter(isAppError) });
    });
  }
});

for (const [role, cfg] of Object.entries(ACCOUNTS)) {
  test.describe(role, () => {
    test(`${role}-all-pages`, async ({ page }) => {
      test.setTimeout(180000);
      test.skip(!cfg.email || !cfg.password, `${role} creds missing`);
      await login(page, cfg.email, cfg.password, cfg.home);
      for (const [name, path] of cfg.pages) {
        const errs: string[] = [];
        const onC = (m: any) => m.type() === 'error' && errs.push(m.text());
        const onE = (e: any) => errs.push(e.message);
        page.on('console', onC); page.on('pageerror', onE);
        await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2200);
        const bouncedToLogin = page.url().includes('/login');
        const crash = await page.getByText('Something went wrong', { exact: false }).count();
        await page.screenshot({ path: `${DIR}/${role}-${name}.png` });
        results.push({ role, name, path, bouncedToLogin, crash: crash > 0, errors: errs.filter(isAppError) });
        page.off('console', onC); page.off('pageerror', onE);
      }
    });
  });
}

test.afterAll(async () => {
  fs.writeFileSync(`${DIR}/status.json`, JSON.stringify(results, null, 2));
});
