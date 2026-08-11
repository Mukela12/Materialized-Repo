/**
 * Public URLs must name the canonical host, not the one that served the request.
 *
 * ── How this was found ───────────────────────────────────────────────────────
 * Vercel serves the app and rewrites /api/* and /embed/* to Railway as a fresh
 * outbound request, so Railway sees ITS OWN hostname in the Host header. The
 * playlist embed's bootstrap script duly told browsers to fetch the next script
 * from backend-production-93717.up.railway.app.
 *
 * The embed was the visible symptom. The same expression built the signup and
 * invitation links that go out by email, and those matter more: the session
 * cookie is host-only to www.mtrlzd.com, so anyone registering through a
 * Railway link would get a session bound to a host they never visit again —
 * signed in, then apparently signed out, with nothing to explain it. That is
 * precisely the failure the apex-to-www redirect exists to prevent, arriving
 * by a different route.
 */
import { describe, it, expect, afterEach } from "vitest";
import { publicOrigin } from "../../server/publicOrigin";

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });

/** A request as Railway sees it after Vercel has rewritten to it. */
const proxied = { protocol: "https", get: () => "backend-production-93717.up.railway.app" } as any;

describe("in production", () => {
  it("never returns the origin that served the request", () => {
    process.env.NODE_ENV = "production";
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.PUBLIC_EMBED_ORIGIN;
    const out = publicOrigin(proxied);
    expect(out).not.toContain("railway");
    expect(out).toBe("https://www.mtrlzd.com");
  });

  it("works with no request at all, for jobs that send email", () => {
    process.env.NODE_ENV = "production";
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.PUBLIC_EMBED_ORIGIN;
    expect(publicOrigin()).toBe("https://www.mtrlzd.com");
  });

  it("honours PUBLIC_ORIGIN, so another deployment is not stuck with ours", () => {
    process.env.NODE_ENV = "production";
    process.env.PUBLIC_ORIGIN = "https://staging.example.com/";
    // Trailing slash stripped, or every URL built from it has a double slash.
    expect(publicOrigin(proxied)).toBe("https://staging.example.com");
  });
});

describe("in development", () => {
  it("uses the request host, because there is no proxy in front", () => {
    process.env.NODE_ENV = "development";
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.PUBLIC_EMBED_ORIGIN;
    const local = { protocol: "http", get: () => "localhost:5111" } as any;
    expect(publicOrigin(local)).toBe("http://localhost:5111");
  });

  it("still prefers an explicit override", () => {
    process.env.NODE_ENV = "development";
    process.env.PUBLIC_ORIGIN = "https://tunnel.example.com";
    const local = { protocol: "http", get: () => "localhost:5111" } as any;
    expect(publicOrigin(local)).toBe("https://tunnel.example.com");
  });
});
