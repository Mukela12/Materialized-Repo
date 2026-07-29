/**
 * API response serializers — strip fields that must never reach the client.
 *
 * User rows carry the password hash and email-verification token/expiry. Those are
 * for server-side use only (login, verification) and must not be serialized into any
 * API response. Kept dependency-free so it's trivially unit-testable.
 */

/** Remove credential/verification fields from a user before sending it to a client. */
export function sanitizeUser<T extends Record<string, any>>(
  user: T,
): Omit<T, "password" | "emailVerificationToken" | "emailVerificationExpires"> {
  const { password, emailVerificationToken, emailVerificationExpires, ...safe } = user;
  return safe;
}

/**
 * Remove admin-only inventory-grant metadata from a brand before it leaves an
 * unauthenticated route.
 *
 * `GET /api/brands` and `GET /api/brands/:id` require no session, and Drizzle
 * selects every declared column — so when migration 0011 added the admin-grant
 * columns they immediately began serving them to anyone:
 *
 *   - `inventoryAccessNote`      free text an admin writes, e.g. an invoice ref
 *   - `inventoryAccessGrantedBy` an internal user id for the acting admin
 *   - `inventoryAccessUntil`     would let anyone enumerate which brands are on a
 *                                paid window and the date each one lapses
 *
 * Admin surfaces read `GET /api/admin/brands` instead, which is behind
 * requireAdmin and intentionally returns the full row.
 */
export function toPublicBrand<T extends Record<string, any>>(
  brand: T,
): Omit<T, "inventoryAccessUntil" | "inventoryAccessGrantedBy" | "inventoryAccessNote"> {
  const { inventoryAccessUntil, inventoryAccessGrantedBy, inventoryAccessNote, ...visible } = brand;
  return visible;
}
