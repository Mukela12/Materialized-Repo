/**
 * The one-time admin setup fee.
 *
 * ── The client's rule ────────────────────────────────────────────────────────
 * "No user, except for Creators, gets an entirely free account, there is always
 * the one-time Admin Fee." So Brands and Publishers owe $29 once, whichever door
 * they came in by; Creators never owe it.
 *
 * ── Why it needed building ───────────────────────────────────────────────────
 * The fee existed only as a line item inside a subscription checkout. A voucher
 * holder's whole offer is "no subscription until the date", so they never
 * reached that checkout and never paid. With 202 festival codes going to Brands
 * and Publishers, that was the entire fee revenue for those accounts.
 *
 * ── Why role and not plan ────────────────────────────────────────────────────
 * Entitlement elsewhere keys off subscription STATUS rather than tier, and the
 * client's rule is stated in terms of who the account is, not what they bought.
 * Role is the thing that decides.
 */

export type FeeRole = "creator" | "brand" | "affiliate" | string;

export interface SetupFeeUser {
  role?: FeeRole | null;
  setupFeePaid?: boolean | null;
  isAdmin?: boolean | null;
}

/** Creators are exempt. Everyone else owes it once. */
export function oweableRole(role: FeeRole | null | undefined): boolean {
  return role === "brand" || role === "affiliate";
}

/** Still outstanding: an oweable role that has not settled it. */
export function owesSetupFee(user: SetupFeeUser): boolean {
  if (user?.isAdmin) return false;
  if (!oweableRole(user?.role)) return false;
  return !user?.setupFeePaid;
}

/**
 * Wording for the two audiences.
 *
 * A Publisher is called a Publisher in the product; `affiliate` is the internal
 * role name and has leaked into user-facing copy before.
 */
export function setupFeeAudience(role: FeeRole | null | undefined): string {
  return role === "affiliate" ? "Publisher" : role === "brand" ? "Brand" : "account";
}
