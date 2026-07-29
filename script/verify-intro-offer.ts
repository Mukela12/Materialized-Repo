/**
 * Verify the introductory-offer checkout against a REAL Stripe account.
 *
 * Unit tests pin the session parameters we send. They cannot answer the question
 * the whole design rests on: after the customer pays the setup fee, does Stripe
 * actually keep the card and make it the subscription's default payment method?
 * If it does not, every later overage invoice finalises unpaid while the UI
 * reports success — so this is checked against Stripe rather than assumed.
 *
 * Run with the server's env injected so no key is ever printed or pasted:
 *
 *   railway run --service backend -- npx tsx script/verify-intro-offer.ts create
 *     → creates a throwaway customer + checkout session, prints the URL
 *
 *   railway run --service backend -- npx tsx script/verify-intro-offer.ts check <customerId>
 *     → after paying with test card 4242…, reports what Stripe actually stored
 *
 * REFUSES TO RUN ON A LIVE KEY. This creates customers and charges cards; doing
 * that against live data by accident is not recoverable, so the guard is a hard
 * exit rather than a warning.
 */
import { getUncachableStripeClient, getStripeSecretKey } from '../server/stripeClient';
import { stripeService } from '../server/stripeService';
import { SETUP_FEE, TRIAL_DAYS } from '../shared/plans';

async function assertTestMode() {
  const key = await getStripeSecretKey();
  if (!key.startsWith('sk_test')) {
    console.error('REFUSING TO RUN: STRIPE_SECRET_KEY is not a test key.');
    console.error('This script creates customers and charges cards.');
    process.exit(1);
  }
  console.log('✓ Stripe is in TEST mode\n');
}

async function create() {
  await assertTestMode();
  const stripe = await getUncachableStripeClient();

  const customer = await stripe.customers.create({
    email: `intro-offer-check-${Date.now()}@example.test`,
    name: 'Intro Offer Verification',
    metadata: { purpose: 'verify-intro-offer', disposable: 'true' },
  });
  console.log(`customer: ${customer.id}`);

  const session = await stripeService.createTrialWithSetupFeeCheckout(
    customer.id,
    'creator',
    'https://www.mtrlzd.com/creator/settings/subscription?checkout=success',
    'https://www.mtrlzd.com/creator/settings/subscription?checkout=cancelled',
    { userId: 'verification', plan: 'creator', offer: 'trial' },
  );

  console.log(`\nexpecting: $${SETUP_FEE.amount / 100} today, then ${TRIAL_DAYS} days free`);
  console.log(`amount_total: ${session.amount_total} (minor units)`);
  console.log(`mode: ${session.mode}`);
  console.log(`\nCHECKOUT_URL=${session.url}`);
  console.log(`CUSTOMER_ID=${customer.id}`);
}

async function check(customerId: string) {
  await assertTestMode();
  const stripe = await getUncachableStripeClient();

  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) throw new Error('customer deleted');

  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 5 });
  const sub = subs.data[0];
  const invoices = await stripe.invoices.list({ customer: customerId, limit: 10 });
  const methods = await stripe.paymentMethods.list({ customer: customerId, type: 'card' });

  const defaultPm =
    (customer.invoice_settings?.default_payment_method as string | null) ?? null;
  const subDefaultPm = (sub?.default_payment_method as string | null) ?? null;

  console.log('=== SUBSCRIPTION ===');
  console.log(`status:        ${sub?.status ?? 'NONE'}`);
  if (sub?.trial_end) {
    const days = Math.round((sub.trial_end * 1000 - Date.now()) / 86_400_000);
    console.log(`trial_end:     ${new Date(sub.trial_end * 1000).toISOString()} (~${days} days)`);
  }

  console.log('\n=== THE SETUP FEE ===');
  for (const inv of invoices.data) {
    console.log(`invoice ${inv.id}: total=${inv.total} status=${inv.status} paid=${inv.paid}`);
  }

  console.log('\n=== CARD ON FILE (the question this script exists for) ===');
  console.log(`payment methods attached:            ${methods.data.length}`);
  console.log(`customer.default_payment_method:     ${defaultPm ?? 'NOT SET'}`);
  console.log(`subscription.default_payment_method: ${subDefaultPm ?? 'NOT SET'}`);

  // createSurplusInvoice builds a STANDALONE invoice (stripe.invoices.create
  // against the customer, not the subscription). A standalone invoice paying
  // `charge_automatically` resolves its card from the CUSTOMER default — it
  // cannot reach the subscription's. So subDefaultPm being set is NOT sufficient.
  console.log(
    `\nsubscription invoices:  ${subDefaultPm ? 'OK' : 'WOULD FAIL'} (uses subscription default)`,
  );
  console.log(
    `overage invoices:       ${defaultPm ? 'OK' : 'WOULD FAIL'} (uses CUSTOMER default)`,
  );
  console.log('\nRun `overage <customerId>` to settle this empirically.');
}

/**
 * Bill a real $1 overage against this customer and report whether it collected.
 *
 * This is the claim worth testing rather than reasoning about: whether the card
 * captured at checkout can actually be charged by the surplus path, which is the
 * whole commercial premise of "card on file for overage only".
 */
async function overage(customerId: string) {
  await assertTestMode();
  const stripe = await getUncachableStripeClient();

  const invoice = await stripeService.createSurplusInvoice(customerId, 1, 'Overage collectability check');
  console.log(`created invoice ${invoice.id}: status=${invoice.status} total=${invoice.total}`);

  // auto_advance settles asynchronously; give Stripe a moment then re-read.
  await new Promise(r => setTimeout(r, 6000));
  const settled = await stripe.invoices.retrieve(invoice.id);

  console.log(`after settling  ${settled.id}: status=${settled.status} amount_paid=${settled.amount_paid}`);
  console.log(
    `\nVERDICT: overage ${settled.status === 'paid' ? 'COLLECTS' : 'DOES NOT COLLECT'}` +
    (settled.status === 'paid' ? '' : ` — invoice sits '${settled.status}' and nobody is charged`),
  );
}

const [cmd, arg] = process.argv.slice(2);
const run = cmd === 'create' ? create() : cmd === 'check' ? check(arg) : cmd === 'overage' ? overage(arg) : Promise.reject(new Error('usage: create | check <customerId> | overage <customerId>'));
run.catch(e => { console.error(e.message); process.exit(1); });
