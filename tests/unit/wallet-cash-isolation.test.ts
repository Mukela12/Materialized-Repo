/**
 * INVARIANT 1 — TOKENS ARE NEVER CASHABLE.
 *
 * This is a deliberately blunt, source-level test. It is not clever and it is not
 * meant to be: it fails loudly the moment someone wires the token wallet into the
 * cash path, which is exactly the regression that would cost real money.
 *
 * The cash path in this codebase is:
 *
 *   commission_transactions (status 'approved')
 *     -> storage.getCommissionsByStatus
 *     -> server/payouts.ts  planPayouts / executePayouts
 *     -> deps.transfer -> stripeService.createTransferCents -> stripe.transfers.create
 *     -> affiliate_payouts
 *
 * server/wallet.ts must not touch any of it. Comments are stripped before
 * matching, because the module doc NAMES those symbols on purpose — describing the
 * wall is not the same as putting a door in it.
 *
 * Also asserted: the ledger's only spend sinks are the three the client agreed to,
 * and there is no mutable balance column on `users`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '../..');
const walletSource = readFileSync(path.join(repoRoot, 'server/wallet.ts'), 'utf8');
// subscriptionSubsidy.ts is the module that actually TALKS TO STRIPE on the token
// path, so it must be covered by the same cash-out grep — otherwise adding
// stripe.transfers.create() there would keep CI green.
const subsidySource = readFileSync(path.join(repoRoot, 'server/subscriptionSubsidy.ts'), 'utf8');
const schemaSource = readFileSync(path.join(repoRoot, 'shared/schema.ts'), 'utf8');

/** Remove block and line comments so only executable source is matched. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const walletCode = stripComments(walletSource);
const subsidyCode = stripComments(subsidySource);

/** Every module on the token money path. Adding one here is deliberate. */
const guardedModules: Array<[name: string, code: string]> = [
  ['server/wallet.ts', walletCode],
  ['server/subscriptionSubsidy.ts', subsidyCode],
];

describe('the token modules are isolated from the cash path', () => {
  const forbiddenSymbols = [
    'affiliatePayouts',
    'affiliate_payouts',
    'commissionTransactions',
    'commission_transactions',
    'recordSaleCommissions',
    'clawbackSaleCommissions',
    'planPayouts',
    'executePayouts',
    'createTransfer',
    'createTransferCents',
    'transfers.create',
    'payouts.create',
    'stripeConnectAccountId',
  ];

  for (const [name, code] of guardedModules) {
    for (const symbol of forbiddenSymbols) {
      it(`${name} never references ${symbol}`, () => {
        expect(code).not.toContain(symbol);
      });
    }
  }

  const forbiddenImports = ['./payouts', './commissions', './stripeService', './stripeClient', './storage', './db'];
  for (const [name, code] of guardedModules) {
    for (const mod of forbiddenImports) {
      it(`${name} does not import ${mod}`, () => {
        // Catches `from './payouts'` and `import('./payouts')` alike.
        expect(code).not.toMatch(new RegExp(`['"]${mod.replace('.', '\\.')}['"]`));
      });
    }
  }

  it('imports nothing outside shared/ — no server module can smuggle a cash path in', () => {
    const imports = [...walletCode.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const imp of imports) {
      expect(imp.startsWith('@shared/')).toBe(true);
    }
  });

  it('states the non-cashability invariant in the module doc', () => {
    // The doc is load-bearing: it is what a reviewer reads first.
    expect(walletSource).toMatch(/TOKENS ARE NEVER CASHABLE/);
  });
});

describe('the ledger has only the agreed sinks', () => {
  it('defines exactly three spend reasons', () => {
    const block = walletCode.match(/export const SPEND_REASONS = \[([\s\S]*?)\]/);
    expect(block).toBeTruthy();
    const reasons = [...block![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(reasons).toEqual([
      'spend_library_listing',
      'spend_playlist',
      'spend_subscription_credit',
    ]);
  });

  it('adds no mutable token balance column to users (invariant 2)', () => {
    // A cached counter on `users` would be a read-modify-write and would lose
    // updates under concurrency — the exact bug the append-only ledger prevents.
    // (`emailVerificationToken` / `passwordResetTokenHash` are auth tokens, not
    // wallet tokens, hence the balance-specific patterns.)
    const usersTable = schemaSource.match(/export const users = pgTable\("users",\s*\{([\s\S]*?)\n\}\);/);
    expect(usersTable).toBeTruthy();
    expect(usersTable![1]).not.toMatch(/token_?balance/i);
    expect(usersTable![1]).not.toMatch(/wallet/i);
    expect(usersTable![1]).not.toMatch(/credit_?balance/i);
    // A column named exactly "token"/"tokens" (not "..._token", which is auth).
    expect(usersTable![1]).not.toMatch(/["']tokens?["']\)/i);
  });

  it('keys the one-token-per-brand unique index on the BRAND ALONE', () => {
    // Keying it on (brand, creator) is the $245-against-$249 bug.
    const idx = schemaSource.match(/brandConversionUniq: uniqueIndex\("token_ledger_brand_conversion_uniq"\)\s*\.on\(([^)]*)\)/);
    expect(idx).toBeTruthy();
    expect(idx![1].trim()).toBe('t.sourceBrandId');
  });
});
