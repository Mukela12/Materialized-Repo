/**
 * Pre-flight for the Stripe test -> live cutover.
 *
 * Read-only. Run it before the switch to see what needs clearing, and again
 * after to confirm the switch actually took. It answers the questions that are
 * easy to get wrong from memory and expensive to get wrong with real money.
 *
 *   railway run --service backend -- npx tsx script/preflight-livemode.ts
 *
 * Pair with the DB half, which needs the Postgres service's own URL:
 *
 *   railway run --service Postgres -- sh -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" npx tsx script/preflight-livemode.ts --db'
 *
 * See docs/LIVE_CUTOVER.md for what to do about anything it flags.
 */
import { getStripeSecretKey, getStripePublishableKey } from '../server/stripeClient';

const DB_ONLY = process.argv.includes('--db');

function line(label: string, value: string, ok: boolean | null = null) {
  const mark = ok === null ? ' ' : ok ? '+' : '!';
  console.log(` ${mark} ${label.padEnd(38)} ${value}`);
}

async function stripeChecks() {
  console.log('\nSTRIPE\n' + '-'.repeat(60));

  let secret: string;
  try {
    secret = await getStripeSecretKey();
  } catch {
    line('secret key', 'NOT CONFIGURED', false);
    return;
  }

  const live = secret.startsWith('sk_live');
  line('mode', live ? 'LIVE — real money' : 'TEST — no real money', null);

  let pk: string | null = null;
  try { pk = await getStripePublishableKey(); } catch { /* optional */ }
  if (pk) {
    const pkLive = pk.startsWith('pk_live');
    line('publishable key mode', pkLive ? 'live' : 'test', pkLive === live);
    if (pkLive !== live) {
      console.log('     -> MISMATCH. The server refuses to boot on this combination.');
    }
  }

  const hasWebhookSecret = !!process.env.STRIPE_WEBHOOK_SECRET;
  line('STRIPE_WEBHOOK_SECRET', hasWebhookSecret ? 'set' : 'MISSING', hasWebhookSecret);
  if (hasWebhookSecret) {
    console.log('     -> Only ONE secret is supported. It must belong to the endpoint');
    console.log('        registered in THIS mode, or every event fails signature checks.');
  }

  // The price catalogue is per-mode: switching keys means an empty catalogue.
  const { stripeService } = await import('../server/stripeService');
  const { PLAN_KEYS } = await import('../shared/plans');
  console.log('\n  price catalogue in this mode:');
  for (const plan of PLAN_KEYS) {
    try {
      line(`  plan "${plan}"`, await stripeService.findOrCreateSubscriptionPrice(plan), true);
    } catch (e: any) {
      line(`  plan "${plan}"`, `FAILED — ${e.message}`, false);
    }
  }
  try {
    line('  setup fee', await stripeService.findOrCreateSetupFeePrice(), true);
  } catch (e: any) {
    line('  setup fee', `FAILED — ${e.message}`, false);
  }
  console.log('     -> These are created on demand. Running this warms them, so the');
  console.log('        first real customer is not the one who discovers a problem.');
}

async function dbChecks() {
  console.log('\nDATABASE — Stripe ids that belong to the OLD mode\n' + '-'.repeat(60));
  const { db } = await import('../server/db');
  const { sql } = await import('drizzle-orm');

  const count = async (q: any): Promise<number> => {
    const r: any = await db.execute(q);
    return Number((r.rows?.[0] ?? r[0])?.count ?? 0);
  };

  const customers = await count(sql`SELECT count(*)::int FROM users WHERE stripe_customer_id IS NOT NULL`);
  const connects  = await count(sql`SELECT count(*)::int FROM users WHERE stripe_connect_account_id IS NOT NULL`);
  const onboarded = await count(sql`SELECT count(*)::int FROM users WHERE stripe_connect_onboarded = true`);
  const subs      = await count(sql`SELECT count(*)::int FROM brand_subscriptions WHERE stripe_subscription_id IS NOT NULL`);
  const mints     = await count(sql`SELECT count(*)::int FROM token_ledger WHERE reason = 'brand_conversion'`);

  line('users.stripe_customer_id', String(customers), customers === 0);
  if (customers) console.log('     -> A stale id is never re-created: checkout and portal both do');
  console.log(customers ? '        `if (!customerId)`, so a dead value is reused forever. NULL them.' : '');

  line('users.stripe_connect_account_id', String(connects), connects === 0);
  if (connects) {
    console.log('     -> HARD LOCK: /api/stripe/connect/create returns the stored id on');
    console.log('        presence alone without calling Stripe, so there is no path in the');
    console.log('        app to mint a live account. NULL these and reset onboarded.');
  }
  line('users.stripe_connect_onboarded', String(onboarded), onboarded === 0);
  line('brand_subscriptions w/ stripe id', String(subs), subs === 0);
  if (subs) console.log('     -> Decide per row: cancel, or leave entitled with nobody paying.');

  line('token_ledger brand_conversion', String(mints), mints === 0);
  if (mints) {
    console.log('     -> The unique index is keyed on source_brand_id ALONE, deliberately');
    console.log('        NOT scoped by mode. Any brand that minted in test can never mint');
    console.log('        again in live — a real $49 permanently denied to a creator.');
  }
}

(async () => {
  console.log('='.repeat(60));
  console.log(' STRIPE LIVE-MODE PREFLIGHT');
  console.log('='.repeat(60));
  if (DB_ONLY) await dbChecks();
  else await stripeChecks();
  console.log('\nNothing above was modified. See docs/LIVE_CUTOVER.md.\n');
  process.exit(0);
})().catch(e => { console.error('preflight failed:', e.message); process.exit(1); });
