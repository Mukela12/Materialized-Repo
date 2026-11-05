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

/**
 * Who may browse the whole Global Video Library.
 *
 * The client, 5 Nov 2026: publishers are the profile the library is for.
 * Creators only ever put their own videos in (the $49 import), so they see
 * their own listings and nothing else, which is all the import sheet needs to
 * show "Listed". Brands still browse it to build playlists.
 */
export function canBrowseLibrary(actor: { role?: string | null; isAdmin?: boolean | null } | null | undefined): boolean {
  if (!actor) return false;
  if (actor.isAdmin) return true;
  return actor.role === "affiliate" || actor.role === "brand";
}
