import { owesSetupFee, type SetupFeeUser } from "./setupFee";

/**
 * Does this account currently have access without paying?
 *
 * ── Why this is one function ─────────────────────────────────────────────────
 * The rule lived inline at two call sites as
 *
 *   user.isAdmin || !!user.freeAccess || (sub && (active || trialing))
 *
 * and `freeAccess` was permanent: a voucher set it true and nothing ever set it
 * back. The client is handing out 216 free-access codes at four events, so that
 * was 216 accounts that would never be billed — not a trial, a permanent comp.
 *
 * Her intent is a subscription-free period that ENDS on a fixed date, after
 * which the account converts to the monthly fee. Expressing that inline in two
 * places would have been two chances to forget the date comparison, and the
 * failure mode is silent: forgetting it means free forever, and nobody
 * complains about not being charged.
 */

export interface EntitlementUser extends SetupFeeUser {
  isAdmin?: boolean | null;
  overageCardRequired?: boolean | null;
  cardOnFile?: boolean | null;
  freeAccess?: boolean | null;
  freeAccessUntil?: Date | string | null;
}

export interface EntitlementSubscription {
  status?: string | null;
}

/**
 * Free access that has not lapsed.
 *
 * NULL `freeAccessUntil` means no end date — a manual comp from the admin Users
 * tab, which is deliberately open-ended. A date in the past means the free
 * period is over and the account needs a subscription like anyone else; the
 * flag itself is left alone so the history of why they were free stays legible.
 */
export function hasFreeAccess(user: EntitlementUser, now: Date = new Date()): boolean {
  if (!user?.freeAccess) return false;
  const until = user.freeAccessUntil;
  if (until == null) return true;
  const end = until instanceof Date ? until : new Date(until);
  if (Number.isNaN(end.getTime())) return true; // unparseable: fail open, never lock out a paying-free user
  return end.getTime() > now.getTime();
}

/**
 * The single entitlement rule.
 *
 * Admin, or (the setup fee settled AND either unlapsed free access or a live
 * subscription).
 *
 * The fee is a PRECONDITION rather than an alternative: the client's rule is
 * that no Brand or Publisher account is ever entirely free, so a voucher covers
 * the subscription and never the fee. Creators are exempt from the fee, so for
 * them this reduces to the old rule.
 */
/**
 * A voucher account that has not yet vaulted a card.
 *
 * The client's rule, verbatim: overage accountability "is the single
 * requirement of having free access to our software." The requirement flag is
 * stamped only at voucher redemption, so manual comps and every account that
 * predates the rule pass through untouched. A live subscription also satisfies
 * it — subscribing captured a card by definition.
 */
export function owesCardOnFile(user: EntitlementUser): boolean {
  if (user?.isAdmin) return false;
  return !!user?.overageCardRequired && !user?.cardOnFile;
}

export function isEntitled(
  user: EntitlementUser,
  sub: EntitlementSubscription | null | undefined,
  now: Date = new Date(),
): boolean {
  if (user?.isAdmin) return true;
  if (owesSetupFee(user)) return false;
  if (sub && (sub.status === "active" || sub.status === "trialing")) return true;
  if (hasFreeAccess(user, now)) return !owesCardOnFile(user);
  return false;
}
