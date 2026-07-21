/**
 * Authorization helpers for user-scoped resources.
 *
 * A user-scoped resource (a user's payouts, an affiliate's commission ledger) must
 * only be read by that same user or by an admin — never by an unauthenticated caller
 * or a different user. Kept dependency-free so the rule is trivially unit-testable
 * and can be reused by route middleware.
 */

export interface Actor {
  id: string;
  isAdmin?: boolean | null;
}

/** True iff `actor` may access a resource owned by `targetUserId` (owner or admin). */
export function canAccessUserResource(
  actor: Actor | null | undefined,
  targetUserId: string,
): boolean {
  if (!actor) return false;
  if (actor.isAdmin) return true;
  return actor.id === targetUserId;
}
