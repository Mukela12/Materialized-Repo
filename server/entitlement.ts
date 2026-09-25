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
/**
 * The client's 25 Sep 2026 reversal, verbatim: "for the purpose of onboarding
 * without delays, without second thoughts by users, mtrzld will absorb the
 * overage charges for brands and creators through to December 31st 2026."
 *
 * Implemented as a WINDOW, not a deletion: redemption and trial signup keep
 * stamping overage_card_required, and this date is the only thing standing
 * between the stamp and enforcement. On 1 January 2027 the requirement wakes
 * up BY ITSELF for every stamped account that never vaulted a card — the
 * policy resumes without a deploy, and flipping it early or extending it is
 * one date. 05:00 UTC so "through December 31st" holds in every timezone the
 * client's users are in, same convention as voucher expiries.
 */
export const OVERAGE_ABSORPTION_UNTIL = new Date("2027-01-01T05:00:00Z");

export function owesCardOnFile(user: EntitlementUser, now: Date = new Date()): boolean {
  if (user?.isAdmin) return false;
  if (now.getTime() < OVERAGE_ABSORPTION_UNTIL.getTime()) return false;
  return !!user?.overageCardRequired && !user?.cardOnFile;
}

/**
 * Every non-voucher signup starts with this many days of full access — the
 * client's CapCut-style onboarding: "FREE 14-Day Trial no credit card
 * required (button/announcement). And install this on the backend."
 */
export const TRIAL_DAYS = 14;

export function isEntitled(
  user: EntitlementUser,
  sub: EntitlementSubscription | null | undefined,
  now: Date = new Date(),
): boolean {
  if (user?.isAdmin) return true;
  /**
   * An unlapsed free window DEFERS the setup fee rather than following it.
   * The fee-first ordering was deliberate in September ("no Brand or
   * Publisher account is ever entirely free"), but a trial that greets a
   * brand with a $29 paywall is not "onboarding without delays, without
   * second thoughts" — so during a trial or voucher window the fee waits,
   * and the moment the window lapses it is the first obligation back. The
   * fee is deferred, never waived: setup_fee_paid stays false throughout.
   */
  if (hasFreeAccess(user, now)) return !owesCardOnFile(user, now);
  if (owesSetupFee(user)) return false;
  if (sub && (sub.status === "active" || sub.status === "trialing")) return true;
  return false;
}
