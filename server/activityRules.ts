/**
 * The rules for what a page view may contain, kept apart from the database so
 * they can be tested on their own. See server/activity.ts for the why.
 */
import { canonicalCode } from "./vouchers";

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * The path as a page, not a URL: no query string, no hash, ids folded to
 * ":id" so "/embed/<uuid>" counts as one page, capped in length.
 */
export function pageOf(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/")) return null;
  const path = raw.split(/[?#]/)[0]
    .replace(UUID, ":id")
    .replace(/\/\d{3,}(?=\/|$)/g, "/:id")
    .replace(/\/(reset-password|verify-email|accept|brand-authorize)\/[^/]+/g, "/$1/:token")
    .slice(0, 160);
  return path || "/";
}

/** Just the site someone came from, never the full URL (it can carry tokens). */
export function referrerHostOf(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const h = new URL(raw).hostname.toLowerCase();
    return h.slice(0, 100) || null;
  } catch {
    return null;
  }
}

export interface PageViewIn {
  visitorId?: unknown; sessionId?: unknown; path?: unknown; referrer?: unknown; device?: unknown; code?: unknown;
}

/** A page view as it will be stored, or null if it isn't one. */
export function cleanPageView(b: PageViewIn) {
  const visitorId = typeof b.visitorId === "string" && ID.test(b.visitorId) ? b.visitorId : null;
  const sessionId = typeof b.sessionId === "string" && ID.test(b.sessionId) ? b.sessionId : null;
  const path = pageOf(b.path);
  if (!visitorId || !sessionId || !path) return null;
  const device = b.device === "mobile" || b.device === "tablet" || b.device === "desktop" ? b.device : null;
  const code = typeof b.code === "string" && b.code.length <= 40 ? canonicalCode(b.code) : "";
  return { visitorId, sessionId, path, referrerHost: referrerHostOf(b.referrer), device, code: code || null };
}

/** The window the admin is looking at, in days: 7, 30 or 90. */
export function windowDays(raw: unknown): number {
  const n = Number(raw);
  return n === 30 || n === 90 ? n : 7;
}

