/**
 * Vouchers — issuing them, and deciding whether one may be redeemed.
 *
 * Replaces a single string in an environment variable: the same code for
 * everyone, uncapped, never expiring, recording nothing, revocable only by
 * rotating it for everybody at once. It could not express the offer it was
 * needed for — 20 free creator accounts, tied to the brand who earned them.
 *
 * ── A wrong code must SAY SO ─────────────────────────────────────────────────
 * The old registration path compared the string and, on a mismatch, silently
 * created an ordinary account. A creator handed a voucher by their brand would
 * type it, get a normal trial, and have no idea anything had gone wrong — and
 * neither would the brand, until they asked why their people had no access.
 * Every refusal below therefore carries a reason the caller can show.
 *
 * ── Why the cap is not checked here ──────────────────────────────────────────
 * `checkRedeemable` deliberately takes the redemption count as an argument
 * rather than fetching it. Counting and then inserting is a read-modify-write,
 * and twenty creators given the same code do not redeem one at a time — they
 * redeem at once, and a naive count hands out 21, 22, 25. The count must be read
 * inside the same transaction that writes, under a lock. This function is the
 * pure part; storage.redeemVoucher is where the guarantee lives.
 */
import { randomBytes } from "crypto";

export interface VoucherRecord {
  id: string;
  code: string;
  grantType: "free_access" | "waive_setup_fee";
  brandUserId: string | null;
  roleRestriction: string | null;
  maxRedemptions: number | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export type RedeemRefusal =
  | { ok: false; reason: "not_found"; message: string }
  | { ok: false; reason: "revoked"; message: string }
  | { ok: false; reason: "expired"; message: string }
  | { ok: false; reason: "exhausted"; message: string }
  | { ok: false; reason: "wrong_role"; message: string };

export type RedeemCheck = { ok: true; voucher: VoucherRecord } | RedeemRefusal;

/**
 * Characters chosen so a code read aloud or off a screen cannot be mistyped:
 * no O/0, no I/1/L, no U/V confusion. A brand will be reading these to people.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTWXYZ23456789";

/**
 * Generate a voucher code.
 *
 * Random rather than sequential: sequential codes can be guessed from one
 * example, and these grant free accounts. Grouped in fours for readability.
 */
export function generateVoucherCode(prefix = "MTZ", groups = 3): string {
  const bytes = randomBytes(groups * 4);
  let out = "";
  for (let i = 0; i < groups * 4; i++) {
    if (i > 0 && i % 4 === 0) out += "-";
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${prefix}-${out}`;
}

/** Compare the way a human types: case-insensitive, spaces ignored. */
export function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * May this voucher be redeemed, by this role, right now?
 *
 * `redemptionCount` MUST come from inside the redeeming transaction — see the
 * module note. Passing a count read earlier makes the cap advisory.
 */
export function checkRedeemable(
  voucher: VoucherRecord | null,
  opts: { role: string; redemptionCount: number; now?: Date },
): RedeemCheck {
  const now = opts.now ?? new Date();

  if (!voucher) {
    return { ok: false, reason: "not_found", message: "That voucher code was not recognised." };
  }
  if (voucher.revokedAt) {
    return { ok: false, reason: "revoked", message: "That voucher is no longer active." };
  }
  // Read-time expiry: no scheduler decides this, the comparison does.
  if (voucher.expiresAt && voucher.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired", message: "That voucher has expired." };
  }
  if (voucher.roleRestriction && voucher.roleRestriction !== opts.role) {
    return {
      ok: false, reason: "wrong_role",
      message: `That voucher can only be used for a ${voucher.roleRestriction} account.`,
    };
  }
  if (voucher.maxRedemptions != null && opts.redemptionCount >= voucher.maxRedemptions) {
    return {
      ok: false, reason: "exhausted",
      message: "That voucher has already been used the maximum number of times.",
    };
  }
  return { ok: true, voucher };
}

/** What a successful redemption grants the new account. */
export function grantsOf(voucher: VoucherRecord): { freeAccess: boolean; waiveSetupFee: boolean } {
  return {
    freeAccess: voucher.grantType === "free_access",
    waiveSetupFee: voucher.grantType === "waive_setup_fee",
  };
}

/** Seats left, for showing a brand how many of their twenty remain. */
export function seatsRemaining(voucher: VoucherRecord, redemptionCount: number): number | null {
  if (voucher.maxRedemptions == null) return null; // uncapped
  return Math.max(0, voucher.maxRedemptions - redemptionCount);
}

/** The most codes one mint may create. A batch of 80 is the real case. */
export const MAX_BATCH = 200;

/** How many times a generated code may collide before we give up on it. */
const COLLISION_RETRIES = 5;

/**
 * Mint N distinct codes.
 *
 * Why distinct codes rather than one code with 80 redemptions: a shared code
 * cannot be traced to a recipient, cannot be revoked for one of them, and once
 * forwarded is forwarded everywhere. The client's case is handing a partner
 * codes to distribute across their network — "who used which" is the whole
 * question they will ask afterwards. The shared-code shape still exists; it is
 * quantity 1 with a redemption cap.
 *
 * Collisions are regenerated rather than thrown, so a batch of 80 does not fail
 * because the 61st code clashed with something issued last month.
 */
export async function mintCodes(
  quantity: number,
  exists: (code: string) => Promise<boolean>,
  generate: () => string = generateVoucherCode,
): Promise<string[]> {
  const n = Math.max(1, Math.min(Math.floor(quantity) || 1, MAX_BATCH));
  const codes: string[] = [];
  // Codes minted in THIS batch are not in the database yet, so `exists` cannot
  // see them. Without this a repeating generator would return duplicates that
  // only fail later, at insert, halfway through the batch.
  const taken = new Set<string>();

  for (let i = 0; i < n; i++) {
    let code = normaliseCode(generate());
    let attempts = 0;
    while (taken.has(code) || (await exists(code))) {
      if (++attempts > COLLISION_RETRIES) {
        throw new Error("Could not generate a unique voucher code");
      }
      code = normaliseCode(generate());
    }
    taken.add(code);
    codes.push(code);
  }
  return codes;
}
