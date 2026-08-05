/**
 * Mint a batch of vouchers from the command line.
 *
 * WHY THIS EXISTS, when the admin screen already does it
 *   The screen is the normal way. This is for the case where someone needs
 *   codes before they can reach the screen — a partner waiting on a call, a
 *   demo in an hour — and for minting on a machine that is not signed in.
 *
 *   It goes through the SAME storage calls the route uses, so a code minted
 *   here is indistinguishable from one minted in the UI: same generator, same
 *   collision handling, same columns. Nothing here reaches into the table by
 *   hand.
 *
 * DRY RUN BY DEFAULT
 *   Prints what it would create and writes nothing. Pass --commit to mint.
 *   Vouchers grant free accounts; accidentally minting a hundred of them
 *   because a flag was implied rather than typed is not a recoverable mistake.
 *
 * USAGE
 *   railway run --service Postgres -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" \
 *     npx tsx script/mint-vouchers.ts --count 10 --for "GTM — UK preview" \
 *     --to "Bethanie" --commit'
 */
import { storage } from "../server/storage";
import { mintCodes, MAX_BATCH } from "../server/vouchers";
import { randomUUID } from "node:crypto";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
}

async function main() {
  const commit = process.argv.includes("--commit");
  const count = Math.max(1, Math.min(Number(arg("count", "1")), MAX_BATCH));
  const label = arg("for") ?? null;
  const assignedTo = arg("to") ?? null;
  const role = arg("role", "creator")!;
  const grantType = (arg("grant", "free_access") as "free_access" | "waive_setup_fee");
  const each = Number(arg("each", "1"));

  if (!["creator", "brand", "affiliate", "any"].includes(role)) {
    console.error(`--role must be creator, brand, affiliate or any (got "${role}")`);
    process.exit(1);
  }

  console.log(`\n  ${count} voucher(s)`);
  console.log(`  for          ${label ?? "(no label)"}`);
  console.log(`  given to     ${assignedTo ?? "(nobody yet)"}`);
  console.log(`  grants       ${grantType === "free_access" ? "free access, no subscription" : "waives the setup fee"}`);
  console.log(`  usable by    ${role === "any" ? "any account type" : role + "s only"}`);
  console.log(`  each usable  ${each} time(s)\n`);

  if (!commit) {
    console.log("  DRY RUN — nothing written. Re-run with --commit to mint.\n");
    process.exit(0);
  }

  const codes = await mintCodes(count, async (c) => !!(await storage.getVoucherByCode(c)));
  const batchId = count > 1 ? randomUUID() : null;

  for (const code of codes) {
    await storage.createVoucher({
      code, label, grantType, brandUserId: null,
      roleRestriction: role === "any" ? null : role,
      maxRedemptions: each, expiresAt: null, createdBy: null,
      batchId, assignedTo,
    });
    console.log(`  ${code}`);
  }

  console.log(`\n  Minted ${codes.length}. Visible at /admin?tab=vouchers.\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Failed:", e?.message ?? e);
  process.exit(1);
});
