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
 * show "Listed". A brand browses it once it has paid at least one $49
 * publishing fee (`hasPaidPublishingFee`), so the library stays hidden from a
 * brand that has only signed up.
 */
export function canBrowseLibrary(
  actor: { role?: string | null; isAdmin?: boolean | null } | null | undefined,
  hasPaidPublishingFee = false,
): boolean {
  if (!actor) return false;
  if (actor.isAdmin) return true;
  if (actor.role === "affiliate") return true;
  return actor.role === "brand" && hasPaidPublishingFee;
}

/**
 * Who may type a link straight into a video's carousel.
 *
 * The client, 10 Nov 2026: only her Bethanie / Editorial login, for MTRLZD's
 * own marketing (the sign-up page, MTRLZD.com). Everyone else adds products
 * from a brand's inventory (tagged from the Marketplace, or the brand's own
 * store connected by API key), so every sale carries the tracking that pays
 * people. "If everyone had access to add a URL randomly, it could end up in a
 * complete fiasco." Team accounts are admins, and her login is one of them.
 */
export function canAddFreeLinks(actor: { isAdmin?: boolean | null } | null | undefined): boolean {
  return !!actor?.isAdmin;
}
