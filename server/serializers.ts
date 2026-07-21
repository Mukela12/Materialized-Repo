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
