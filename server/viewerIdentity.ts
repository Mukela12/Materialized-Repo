/**
 * Viewer identity for deduplicating billable views.
 *
 * The problem this solves: analytics_events had no notion of who a viewer is,
 * so one page reload was one billable view. Any pricing built on that number is
 * indefensible — a creator could refresh their own video to inflate a brand's
 * bill, and an ordinary viewer opening a page twice would be charged for twice.
 *
 * WHAT THIS IS
 *   An opaque, salted, per-day HMAC of the things that identify a browser to a
 *   server without cooperation from it: source IP and user-agent. The UTC date
 *   is mixed in, so the value rotates at midnight and the uniqueness constraint
 *   "one view per viewer per video per day" needs no day column and no job to
 *   expire anything.
 *
 * WHAT THIS IS NOT
 *   Not a tracking identifier. It is one-way, never returned to any client,
 *   never logged, and stops being linkable to a person once the day rolls over.
 *   The raw IP is never stored — only the digest. That is deliberate: this
 *   exists to avoid double-billing, and holding anything more would be
 *   collecting personal data for a purpose that does not need it.
 *
 * WHAT IT DOES NOT DEFEND AGAINST
 *   Someone determined to inflate views can rotate IPs and user-agents. This
 *   raises the cost of accidental and casual inflation — reloads, prefetch,
 *   multiple tabs, a CDN retrying a beacon — which is the overwhelming majority
 *   of it. Deliberate fraud needs the anomaly ceiling planned for the billing
 *   phase, where a period wildly out of line with an account's own history is
 *   held for a human rather than charged.
 */
import crypto from "crypto";
import type { Request } from "express";

/**
 * Salt for the digest.
 *
 * SESSION_SECRET is reused deliberately rather than adding another required
 * variable: it is already mandatory (server/index.ts refuses to boot without it
 * in production), already secret, and already rotated when credentials are.
 *
 * Rotating it re-buckets every viewer, which for one day means some viewers are
 * counted twice. That is the correct trade — a rotation is rare, and the
 * alternative is a second secret that nobody remembers to rotate at all.
 */
function salt(): string | null {
  return process.env.SESSION_SECRET ?? null;
}

/**
 * Best-effort client IP.
 *
 * Behind Vercel -> Railway there are two proxies, so req.ip reflects the last
 * hop rather than the viewer. x-forwarded-for's FIRST entry is the original
 * client; later entries are the proxies that added themselves.
 *
 * A caller can forge this header. That is acceptable here: forging it changes
 * which bucket a view lands in, and the worst case is a view that should have
 * been deduplicated is counted — the same outcome as having no identity at all,
 * which is where we started. It cannot be used to suppress someone else's view,
 * because a collision would have to reproduce the exact IP, user-agent and day.
 */
function clientIp(req: Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  const first = raw?.split(",")[0]?.trim();
  return first || req.ip || req.socket?.remoteAddress || null;
}

/** UTC date as YYYY-MM-DD. UTC, not local, so the boundary is the same everywhere. */
function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Derive the dedup key for this request, or null if it cannot be derived.
 *
 * Returns null when there is no salt configured or no usable IP. Null is a
 * meaningful value, not a failure: the partial unique index ignores NULL
 * viewer_hash, so the event is still recorded — it simply is not deduplicated.
 * Failing open is right, because losing a real view is worse than counting a
 * duplicate, and the alternative would be dropping analytics whenever an
 * environment variable is missing.
 */
export function viewerHash(req: Request, now: Date = new Date()): string | null {
  const key = salt();
  const ip = clientIp(req);
  if (!key || !ip) return null;

  const ua = String(req.headers["user-agent"] ?? "");
  return crypto
    .createHmac("sha256", key)
    .update(`${ip}\n${ua}\n${utcDay(now)}`)
    .digest("hex");
}

/** Postgres unique-violation. Signals "already counted", not a failure. */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}
