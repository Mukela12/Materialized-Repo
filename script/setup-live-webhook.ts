/**
 * Create the Stripe webhook endpoint, from the API rather than the dashboard.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The client was asked to create this by hand and could not, through no fault
 * of her own. Stripe redesigned the page into an "event destination" wizard
 * whose Suggested tab pre-selects nineteen `v2.core.*` events — the Accounts v2
 * namespace, which shares almost nothing with the v1 events this server
 * handles. Two of the ten needed were in the list she was shown. She spent two
 * days on it between demo calls.
 *
 * The wizard also offers Snapshot vs Thin payload. THIN IS SILENTLY FATAL
 * HERE: every handler in webhookHandlers.ts reads `event.data.object`, and a
 * thin payload does not carry it. Those events pass signature verification,
 * do nothing, and are reported as delivered — a green tick in the dashboard
 * over subscriptions that never activate.
 *
 * `webhookEndpoints.create` has neither trap. It makes a v1 snapshot endpoint,
 * with exactly the events named here, and nothing to misclick.
 *
 * ── THE SIGNING SECRET ───────────────────────────────────────────────────────
 * Returned once, at creation, and never again. This script does NOT print it.
 * It writes it straight into Railway and prints a masked confirmation, so the
 * secret never lands in a terminal transcript, a scrollback buffer, or a chat
 * message. Pass --print only if you are deliberately putting it somewhere else.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────
 *   Dry run (default — writes nothing, anywhere):
 *     railway run --service backend -- npx tsx script/setup-live-webhook.ts
 *
 *   For real:
 *     railway run --service backend -- npx tsx script/setup-live-webhook.ts --commit
 *
 * Run it with the keys of whichever account you are cutting over to. It reads
 * the account it is pointed at and says so before doing anything.
 */
import { getUncachableStripeClient, getStripeSecretKey } from "../server/stripeClient";
import { execFileSync } from "node:child_process";

/**
 * The events this server handles.
 *
 * MUST match the switch in server/webhookHandlers.ts. An event registered here
 * but unhandled is harmless noise; an event HANDLED but not registered is a
 * feature that silently never runs — a subscription that never activates, a
 * payout that is never recorded. Adding a case there means adding it here.
 */
const EVENTS = [
  "checkout.session.completed",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "charge.refunded",
  "charge.dispute.created",
  "payout.paid",
  "payout.failed",
  "account.updated",
  /**
   * The clawback path. Handled BEFORE the switch in dispatchStripeEvent, which
   * is precisely why it was missed when this list was first written out by
   * hand — reading the switch alone does not show it. Without it registered, a
   * reversed transfer never reaches the code that reverses the commission, and
   * the money stays paid out.
   *
   * `transfer.failed` is matched defensively in the dispatcher but is not a
   * registerable event type, so it is deliberately absent here.
   */
  "transfer.reversed",
] as const;

const URL = process.env.WEBHOOK_URL ?? "https://www.mtrlzd.com/api/webhooks/stripe";
const COMMIT = process.argv.includes("--commit");
const PRINT = process.argv.includes("--print");

const mask = (s: string) => `${s.slice(0, 8)}…${s.slice(-4)} (${s.length} chars)`;

async function main() {
  const stripe = await getUncachableStripeClient();
  const secret = await getStripeSecretKey();
  const live = secret.startsWith("sk_live");

  const account: any = await stripe.accounts.retrieve();
  console.log("\nACCOUNT");
  console.log("-".repeat(64));
  console.log(`  id            ${account.id}`);
  console.log(`  name          ${account.business_profile?.name ?? account.settings?.dashboard?.display_name ?? "—"}`);
  console.log(`  mode          ${live ? "LIVE — real money" : "TEST — no real money"}`);
  console.log(`  charges       ${account.charges_enabled ? "enabled" : "DISABLED"}`);
  console.log(`  payouts       ${account.payouts_enabled ? "enabled" : "DISABLED"}`);

  // Connect is what pays creators. It is a separate activation from ordinary
  // card payments, and the one most likely to be missed on a fresh account.
  const transfers = account.capabilities?.transfers;
  console.log(`  transfers     ${transfers ?? "NOT REQUESTED — Connect payouts will not work"}`);

  const existing = await stripe.webhookEndpoints.list({ limit: 100 });
  const clash = existing.data.filter((e) => e.url === URL && e.status !== "disabled");

  console.log("\nENDPOINT");
  console.log("-".repeat(64));
  console.log(`  url           ${URL}`);
  console.log(`  events        ${EVENTS.length}`);
  for (const e of EVENTS) console.log(`                  ${e}`);

  if (clash.length) {
    // Two live endpoints on one URL means every event is delivered twice, and
    // only one of the two secrets can be configured — so half of them fail
    // their signature check and the other half double-fire.
    console.log(`\n  ! ${clash.length} endpoint(s) already point at this URL:`);
    for (const e of clash) console.log(`      ${e.id}  (${e.status})`);
    console.log("    Delete them in the dashboard before creating another, or");
    console.log("    every event arrives twice and one copy fails its signature.");
    if (COMMIT) {
      console.log("\n  Refusing to create a duplicate. Nothing written.\n");
      process.exit(1);
    }
  }

  if (!COMMIT) {
    console.log("\n  DRY RUN — nothing created. Re-run with --commit.\n");
    return;
  }

  const created = await stripe.webhookEndpoints.create({
    url: URL,
    enabled_events: EVENTS as unknown as string[],
    description: "MTRLZD platform — created by script/setup-live-webhook.ts",
  });

  console.log(`\n  created       ${created.id}`);

  const signing = (created as any).secret as string | undefined;
  if (!signing) {
    console.log("  ! Stripe returned no signing secret. Copy it from the dashboard.");
    return;
  }

  if (PRINT) {
    console.log(`  secret        ${signing}`);
  } else {
    try {
      // --skip-deploys so all three keys can be changed together and the
      // service restarted once, rather than booting mid-swap with a live
      // secret key and a stale webhook secret.
      execFileSync("railway", [
        "variables", "--service", "backend", "--skip-deploys",
        "--set", `STRIPE_WEBHOOK_SECRET=${signing}`,
      ], { stdio: "pipe" });
      console.log(`  secret        written to Railway — ${mask(signing)}`);
      console.log("\n  Now set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY in the");
      console.log("  same update, then redeploy once. Changing them one at a time");
      console.log("  leaves a window where events fail every signature check.");
    } catch {
      console.log("  ! Could not write to Railway. Re-run with --print to get it,");
      console.log("    or copy it from the Stripe dashboard now — it is shown once.");
    }
  }
  console.log();
}

main().catch((e) => {
  console.error("\nFAILED:", e?.message ?? e, "\n");
  process.exit(1);
});
