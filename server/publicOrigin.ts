import type { Request } from "express";

/**
 * The origin to put in anything a person or another site will use.
 *
 * ── Why `req.get("host")` is wrong here ──────────────────────────────────────
 * Vercel serves the app and rewrites /api/* and /embed/* to Railway as a FRESH
 * OUTBOUND REQUEST. Railway therefore sees its own hostname in the Host header,
 * not ours. So every URL built from the request came out as
 *
 *     https://backend-production-93717.up.railway.app/...
 *
 * This was found in the playlist embed, whose bootstrap script told browsers to
 * fetch the next script from Railway. But the same expression builds the signup
 * and invitation links that go out in email, and those matter more: the session
 * cookie is host-only to www.mtrlzd.com (see the note in server/index.ts), so
 * someone who registers through a Railway link gets a session bound to a host
 * they will never visit again — signed in, then apparently signed out, with
 * nothing to explain it. That is the exact failure the apex-to-www redirect was
 * added to prevent, arriving by a different route.
 *
 * PUBLIC_ORIGIN overrides for other deployments; the fallback is the canonical
 * host, which is also where Stripe posts and where the cookie is bound.
 */
const CANONICAL = "https://www.mtrlzd.com";

export function publicOrigin(req?: Request): string {
  const configured = process.env.PUBLIC_ORIGIN || process.env.PUBLIC_EMBED_ORIGIN;
  if (configured) return configured.replace(/\/$/, "");

  // In development there is no proxy in front, so the request host IS the
  // public one and hard-coding production would break every local link.
  if (process.env.NODE_ENV !== "production" && req) {
    return `${req.protocol}://${req.get("host")}`;
  }
  return CANONICAL;
}
