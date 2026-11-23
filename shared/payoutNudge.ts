/**
 * Who the "Get your payouts ready" nudge is for.
 *
 * The earning roles only: creators and Publishers, who are paid commissions
 * through Stripe Connect. Publishers are stored with role "affiliate"; there is
 * no third value. Brands are not nudged (their Connect setup is asked for in
 * the selling flow), and neither are admins.
 *
 * One rule, read by both sides: the server uses it to answer
 * GET /api/payouts/nudge, and the banner uses it to decide whether to ask at
 * all, so an account outside the audience never sends the request.
 */
export function isPayoutNudgeAudience(
  user: { role?: string | null; isAdmin?: boolean | null } | null | undefined,
): boolean {
  if (!user || user.isAdmin) return false;
  return user.role === "creator" || user.role === "affiliate";
}
