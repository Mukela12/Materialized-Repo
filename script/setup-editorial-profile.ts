/**
 * Set up the permanent-free editorial Creator profile.
 *
 * WHY THIS IS NOT JUST "TICK freeAccess"
 *   The account was already free — but by ACCIDENT. The upload gate reads
 *   `user.isAdmin || user.freeAccess || <subscription>` (server/routes.ts), so
 *   an admin bypasses every cap simply for being an admin. That conflates two
 *   unrelated things: the right to administer the platform, and not paying for
 *   it. The day admin rights move, the editorial account silently starts
 *   hitting the one-video trial cap with no explanation.
 *
 *   So freeAccess is set EXPLICITLY. It then holds on its own merits, and
 *   `isAdmin` goes back to meaning only what it says.
 *
 * WHAT IT DOES NOT DO
 *   It does not attach a card. The client asked to link a personal card for
 *   overage, and a card can only be vaulted by the cardholder entering it —
 *   never by a script, and never by me. The route that makes that possible
 *   (POST /api/billing/payment-method/setup, Stripe Checkout in setup mode) is
 *   new; before it, a free account had no way to hold a payment method at all.
 *   The link is printed at the end for the account owner to complete.
 *
 * USAGE — prints the plan and changes nothing unless APPLY=1:
 *
 *   railway run --service Postgres -- \
 *     sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npx tsx script/setup-editorial-profile.ts'
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

/** The account to make permanently free. Narrow by design — one email. */
const EMAIL = process.env.EDITORIAL_EMAIL || "missbethanieashton@gmail.com";

/**
 * The name shoppable editorials are published under.
 *
 * It was "Admin", which is what the bootstrap seeder names the account it
 * creates. That is fine for a login and wrong for a byline — every editorial
 * this account publishes carries it, and it appears on library cards next to
 * real creator names.
 *
 * Safe to change permanently: the seeder only sets displayName on the CREATE
 * path (server/authRoutes.ts). Its update path touches password, isAdmin and
 * emailVerified only, so re-enabling seeding would not rename this back.
 */
const DISPLAY_NAME = process.env.EDITORIAL_NAME || "MTRLZD Editorial";

(async () => {
  const apply = process.env.APPLY === "1";
  console.log(apply ? "MODE: APPLY\n" : "MODE: DRY RUN — set APPLY=1 to write\n");

  const { rows } = await db.execute(sql`
    select id, email, display_name, role, is_admin, free_access,
           (stripe_customer_id is not null) as has_card_customer
    from users where email = ${EMAIL}`);

  const user = rows[0] as any;
  if (!user) {
    console.error(`No account found for ${EMAIL}.`);
    process.exit(1);
  }

  console.log(`account          ${user.email}  (${user.id})`);
  console.log(`display name     ${user.display_name}${user.display_name !== DISPLAY_NAME ? `  <- will become "${DISPLAY_NAME}"` : ""}`);
  console.log(`role             ${user.role}`);
  console.log(`is admin         ${user.is_admin}`);
  console.log(`free access      ${user.free_access}  ${user.free_access ? "" : "<- will be set"}`);
  console.log(`payment method   ${user.has_card_customer ? "customer exists" : "none — owner must add one"}`);

  if (user.role !== "creator") {
    console.log(`\nNOTE: role is "${user.role}", not creator. Not changing it — that is a`);
    console.log(`decision about what this account IS, not about whether it pays.`);
  }

  const needsFree = !user.free_access;
  const needsRename = user.display_name !== DISPLAY_NAME;

  if (!needsFree && !needsRename) {
    console.log("\nAlready set up. Nothing to do.");
  } else if (apply) {
    if (needsFree) {
      await db.execute(sql`update users set free_access = true where id = ${user.id}`);
      console.log("\n✓ free_access set — now explicit rather than inherited from isAdmin");
    }
    if (needsRename) {
      await db.execute(sql`update users set display_name = ${DISPLAY_NAME} where id = ${user.id}`);
      console.log(`✓ display name "${user.display_name}" -> "${DISPLAY_NAME}"`);
    }
  } else {
    if (needsFree) console.log("\nWould set free_access = true.");
    if (needsRename) console.log(`Would rename "${user.display_name}" -> "${DISPLAY_NAME}".`);
  }

  if (apply) {
    const { rows: after } = await db.execute(sql`
      select display_name, free_access, is_admin from users where id = ${user.id}`);
    const a = after[0] as any;
    console.log(`\nverified: name="${a.display_name}" free_access=${a.free_access} is_admin=${a.is_admin}`);
  }

  console.log(`
NEXT, AND ONLY THE ACCOUNT OWNER CAN DO IT
  Sign in as ${EMAIL} and add a card for overage at:
      Account -> Payment method   (or POST /api/billing/payment-method/setup)
  It opens Stripe Checkout in setup mode: the card is vaulted and made the
  invoice default, with nothing charged. Free access is unaffected — it only
  means there is something to bill if usage ever exceeds the allowance.

  A card cannot be added by a script. Whoever owns the card enters it.`);

  await (db as any).$client.end?.();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
