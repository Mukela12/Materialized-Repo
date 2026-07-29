/**
 * Viewer identity — the basis of a defensible billable view.
 *
 * Before this existed, analytics_events had no notion of who a viewer was, so
 * one page reload was one billable view. These pin the properties the
 * deduplication depends on; if any of them stops holding, the number Materialized
 * bills on stops meaning anything.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { viewerHash, isUniqueViolation } from "../../server/viewerIdentity";

/** Minimal Express-request shape — only what viewerHash actually reads. */
function req(opts: { ip?: string; fwd?: string; ua?: string } = {}) {
  return {
    ip: opts.ip,
    headers: {
      ...(opts.fwd ? { "x-forwarded-for": opts.fwd } : {}),
      ...(opts.ua ? { "user-agent": opts.ua } : {}),
    },
    socket: {},
  } as any;
}

const DAY1 = new Date("2026-07-29T10:00:00Z");
const DAY1_LATE = new Date("2026-07-29T23:59:59Z");
const DAY2 = new Date("2026-07-30T00:00:01Z");

let saved: string | undefined;
beforeEach(() => { saved = process.env.SESSION_SECRET; process.env.SESSION_SECRET = "test-salt"; });
afterEach(() => { if (saved === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = saved; });

describe("viewerHash", () => {
  it("is stable for the same viewer within a UTC day — this is what collapses reloads", () => {
    const a = viewerHash(req({ ip: "1.2.3.4", ua: "Mozilla/5.0" }), DAY1);
    const b = viewerHash(req({ ip: "1.2.3.4", ua: "Mozilla/5.0" }), DAY1_LATE);
    expect(a).toBe(b);
    expect(a).toBeTruthy();
  });

  it("rotates at midnight UTC, so tomorrow is billable again with no scheduled job", () => {
    const d1 = viewerHash(req({ ip: "1.2.3.4", ua: "Mozilla/5.0" }), DAY1_LATE);
    const d2 = viewerHash(req({ ip: "1.2.3.4", ua: "Mozilla/5.0" }), DAY2);
    expect(d1).not.toBe(d2);
  });

  it("separates different viewers on the same connection-ish inputs", () => {
    const a = viewerHash(req({ ip: "1.2.3.4", ua: "Chrome" }), DAY1);
    const b = viewerHash(req({ ip: "1.2.3.5", ua: "Chrome" }), DAY1);
    const c = viewerHash(req({ ip: "1.2.3.4", ua: "Safari" }), DAY1);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("takes the FIRST x-forwarded-for entry — the client, not the proxies", () => {
    // Vercel -> Railway means two hops; req.ip is the last one and is useless here.
    const viaProxies = viewerHash(req({ fwd: "9.9.9.9, 10.0.0.1, 10.0.0.2", ua: "UA" }), DAY1);
    const direct = viewerHash(req({ ip: "9.9.9.9", ua: "UA" }), DAY1);
    expect(viaProxies).toBe(direct);
  });

  it("never returns the raw IP — it is a digest, not an identifier", () => {
    const h = viewerHash(req({ ip: "203.0.113.7", ua: "UA" }), DAY1)!;
    expect(h).not.toContain("203.0.113.7");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("FAILS OPEN with no salt — null means 'record it, do not deduplicate'", () => {
    delete process.env.SESSION_SECRET;
    expect(viewerHash(req({ ip: "1.2.3.4", ua: "UA" }), DAY1)).toBeNull();
  });

  it("FAILS OPEN with no derivable IP", () => {
    expect(viewerHash(req({ ua: "UA" }), DAY1)).toBeNull();
  });

  it("a missing user-agent still yields a usable hash", () => {
    expect(viewerHash(req({ ip: "1.2.3.4" }), DAY1)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changing the salt re-buckets everyone — the documented cost of rotation", () => {
    const before = viewerHash(req({ ip: "1.2.3.4", ua: "UA" }), DAY1);
    process.env.SESSION_SECRET = "rotated";
    expect(viewerHash(req({ ip: "1.2.3.4", ua: "UA" }), DAY1)).not.toBe(before);
  });
});

describe("isUniqueViolation", () => {
  it("recognises Postgres 23505, which the route treats as 'already counted'", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("does not swallow other errors", () => {
    for (const e of [{ code: "23503" }, new Error("boom"), null, undefined, {}]) {
      expect(isUniqueViolation(e)).toBe(false);
    }
  });
});
