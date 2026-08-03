/**
 * Set a known password on the demo accounts, for walking a client through each
 * user type.
 *
 * The password is read from DEMO_PASSWORD in the environment — never passed as a
 * command-line argument, because arguments land in shell history and in the
 * process list where any other user on the machine can read them.
 *
 *   DEMO_PASSWORD='something-you-choose' railway run --service Postgres -- \
 *     sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npx tsx script/set-demo-passwords.ts'
 *
 * It also sets email_verified, because login is hard-blocked until an account is
 * verified (server/authRoutes.ts) and a demo cannot wait on an inbox.
 *
 * DELIBERATELY NARROW: it will only touch the accounts named in DEMO_ACCOUNTS
 * below, and it refuses to touch an admin. Resetting a real admin's password
 * from a script is how you lock yourself out of your own platform mid-demo —
 * the admin password is managed separately, through ADMIN_PASSWORD and the
 * seeder in server/authRoutes.ts.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { hashPassword } from "../server/auth";

/** The non-admin demo accounts, one per user type the client will walk through. */
const DEMO_ACCOUNTS = [
  { email: "e2etest@test.com", role: "creator" },
  { email: "codelibrary21@gmail.com", role: "brand" },
  { email: "affiliate@test.com", role: "publisher / affiliate" },
];

(async () => {
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 8) {
    console.error("Set DEMO_PASSWORD (at least 8 characters) in the environment.");
    console.error("Do NOT pass it as an argument — arguments are visible in the process list.");
    process.exit(1);
  }

  const hashed = await hashPassword(password);

  for (const acct of DEMO_ACCOUNTS) {
    const found: any = await db.execute(
      sql`SELECT id, is_admin FROM users WHERE lower(email) = lower(${acct.email})`,
    );
    const row = (found.rows ?? found)[0];

    if (!row) {
      console.log(`  SKIP  ${acct.email} — no such account`);
      continue;
    }
    if (row.is_admin) {
      // Guard, not an oversight: see the header.
      console.log(`  SKIP  ${acct.email} — is an admin, refusing to reset`);
      continue;
    }

    await db.execute(sql`
      UPDATE users
         SET password = ${hashed}, email_verified = true
       WHERE id = ${row.id}`);
    console.log(`  OK    ${acct.email.padEnd(32)} (${acct.role})`);
  }

  console.log("\nAll three now share the password you supplied. Verified, so they can log in.");
  console.log("Change or disable them after the demo — these are shared credentials.");
  process.exit(0);
})().catch((e) => {
  console.error("failed:", e.message);
  process.exit(1);
});
