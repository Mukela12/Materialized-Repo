/**
 * Demo-readiness capture — the surfaces shipped on 17–18 Aug, none of which
 * have ever been clicked.
 *
 * Written as a CAPTURE, not a gate: it records what it finds and screenshots
 * every screen rather than failing on the first surprise, because the point is
 * to look at the result and judge it.
 *
 * Credentials come from the environment and are never written down here:
 *   QA_EMAIL / QA_PASSWORD    an account with role=creator AND is_admin
 *   PLAYWRIGHT_BASE_URL       defaults to production
 *
 * Run:
 *   QA_EMAIL=… QA_PASSWORD=… npx playwright test tests/e2e/demo-readiness.spec.ts
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://www.mtrlzd.com';
const DIR = process.env.REPORT_DIR ?? 'test-results/demo-readiness';
fs.mkdirSync(DIR, { recursive: true });

const EMAIL = process.env.QA_EMAIL;
const PASSWORD = process.env.QA_PASSWORD;

/** Beth's upload, the one she reported as missing. */
const BETH_VIDEO = '5e6ea996-a48c-4b9d-ac3d-96d4000a2cca';

const findings: any[] = [];
const note = (step: string, data: Record<string, any>) => {
  findings.push({ step, ...data });
  console.log(`[${step}] ${JSON.stringify(data)}`);
};

function watchErrors(page: Page, bag: string[]) {
  page.on('console', (m) => m.type() === 'error' && bag.push(m.text()));
  page.on('pageerror', (e) => bag.push(e.message));
}

const realError = (t: string) =>
  !/favicon|analytics|gtag|Failed to load resource|net::ERR_|React DevTools|sourcemap|Manifest|preload/i.test(t);

test.use({ viewport: { width: 1440, height: 1000 } });

test('demo readiness capture', async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, 'QA_EMAIL and QA_PASSWORD must be set');
  test.setTimeout(240000);

  const errors: string[] = [];
  watchErrors(page, errors);

  // ── Sign in ───────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('input-login-email').fill(EMAIL!);
  await page.getByTestId('input-login-password').fill(PASSWORD!);
  await page.getByTestId('button-login-submit').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  note('login', { landedOn: new URL(page.url()).pathname });

  // ── 1. My Campaigns: is Beth's video there, and does the card show a frame? ─
  await page.goto(`${BASE}/creator/my-videos`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${DIR}/01-my-campaigns.png`, fullPage: true });

  const cards = await page.locator('[data-testid^="card-video-"]').count();
  const imgs = await page.locator('[data-testid^="card-video-"] img').count();
  note('my-campaigns', { cards, cardsWithImage: imgs, greyPlaceholders: cards - imgs });

  // ── 2. The video detail sheet + Timeline Overlays ──────────────────────────
  const bethCard = page.getByTestId(`card-video-${BETH_VIDEO}`);
  if (await bethCard.count()) {
    await bethCard.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${DIR}/02-detail-sheet.png`, fullPage: true });
    const composer = await page.getByTestId('button-toggle-add-overlay').count();
    note('detail-sheet', { opened: true, overlayComposerPresent: composer > 0 });
    if (composer) {
      await page.getByTestId('button-toggle-add-overlay').click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${DIR}/03-overlay-form.png` });
      note('overlay-form', {
        productUrlField: await page.getByTestId('input-overlay-url').count(),
        nameField: await page.getByTestId('input-overlay-name').count(),
        priceField: await page.getByTestId('input-overlay-price').count(),
      });
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  } else {
    note('detail-sheet', { opened: false, reason: "Beth's card not found" });
  }

  // ── 3. Embed modal: does the code box actually overlap the video? ──────────
  await page.goto(`${BASE}/creator/my-videos`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const embedBtn = page.locator('[data-testid^="button-embed-"]').first();
  if (await embedBtn.count()) {
    await embedBtn.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${DIR}/04-embed-modal.png`, fullPage: true });
    const geo = await page.evaluate(() => {
      const frame = document.querySelector('[role="dialog"] iframe') as HTMLElement | null;
      const code = document.querySelector('[role="dialog"] textarea') as HTMLElement | null;
      if (!frame || !code) return { frame: !!frame, code: !!code };
      const a = frame.getBoundingClientRect(), b = code.getBoundingClientRect();
      const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      return {
        frame: [Math.round(a.x), Math.round(a.y), Math.round(a.width), Math.round(a.height)],
        code: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
        overlapPx: Math.round(overlapX * overlapY),
        OVERLAPS: overlapX > 0 && overlapY > 0,
      };
    });
    note('embed-modal', geo);
    await page.keyboard.press('Escape');
  } else {
    note('embed-modal', { found: false });
  }

  // ── 4. Admin: vouchers (PARTNER column + the dates applied tonight) ────────
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${DIR}/05-admin.png`, fullPage: true });
  const noAccess = await page.getByText('This page needs an admin account', { exact: false }).count();
  note('admin', { reached: noAccess === 0, url: new URL(page.url()).pathname });

  if (!noAccess) {
    const vouchTab = page.getByRole('button', { name: /voucher/i }).first();
    if (await vouchTab.count()) {
      await vouchTab.click();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${DIR}/06-admin-vouchers.png`, fullPage: true });
      note('vouchers', {
        partnerColumn: await page.getByRole('columnheader', { name: /partner/i }).count(),
        partnerInputs: await page.locator('[data-testid^="input-partner-"]').count(),
        rows: await page.locator('[data-testid^="voucher-"]').count(),
      });
    }

    // ── 5. Money Ops → Invoices, the screen built today ─────────────────────
    const moneyTab = page.getByRole('button', { name: /money/i }).first();
    if (await moneyTab.count()) {
      await moneyTab.click();
      await page.waitForTimeout(1500);
      const invoicesTab = page.getByTestId('money-subtab-invoices');
      if (await invoicesTab.count()) {
        await invoicesTab.click();
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `${DIR}/07-admin-invoices.png`, fullPage: true });
        note('invoices', {
          tabPresent: true,
          toolbar: await page.getByTestId('admin-fee-invoices-toolbar').count(),
          emptyState: await page.getByTestId('fee-invoices-empty').count(),
        });
      } else {
        note('invoices', { tabPresent: false });
      }
    }
  }

  note('console-errors', { count: errors.filter(realError).length, sample: errors.filter(realError).slice(0, 6) });
});

test.afterAll(() => {
  fs.writeFileSync(`${DIR}/findings.json`, JSON.stringify(findings, null, 2));
  console.log(`\nWrote ${DIR}/findings.json and screenshots.`);
});
