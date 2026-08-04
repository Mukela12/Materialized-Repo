/**
 * How auth rate limiting is keyed.
 *
 * Measured against production on 4 Aug 2026: requests arriving through
 * www.mtrlzd.com carry NO stable client IP. Vercel rewrites /api/* to Railway as
 * a fresh outbound request without forwarding the caller's address. Five
 * identical logins through Vercel returned RateLimit-Remaining 49, 49, 48, 48,
 * 49; the same five straight to Railway returned 49, 48, 47, 46, 45.
 *
 * An IP-keyed limiter is therefore close to useless on the path real users take.
 * Keying on the targeted email protects the account actually under attack, and
 * holds however many addresses the attacker has.
 */
import { describe, it, expect } from "vitest";

/** Mirrors clientIp / emailKey in server/index.ts. */
function clientIp(req: any): string {
  const xff = req.headers?.["x-forwarded-for"];
  const first = Array.isArray(xff) ? xff[0] : (xff || "").split(",")[0].trim();
  return first || req.ip || "unknown";
}
function emailKey(req: any): string {
  const raw = (req.body?.email ?? "").toString().trim().toLowerCase();
  return raw || clientIp(req);
}

const req = (body: any, headers: any = {}, ip?: string) => ({ body, headers, ip });

describe("emailKey — per-account limiting", () => {
  it("buckets by the targeted account, so one IP cannot be evaded by rotating IPs", () => {
    const a = emailKey(req({ email: "victim@example.com" }, { "x-forwarded-for": "1.1.1.1" }));
    const b = emailKey(req({ email: "victim@example.com" }, { "x-forwarded-for": "2.2.2.2" }));
    expect(a).toBe(b);
  });

  it("normalises case and whitespace — Victim@ and victim@ are one account", () => {
    expect(emailKey(req({ email: "  Victim@Example.COM " }))).toBe("victim@example.com");
  });

  it("keeps separate accounts in separate buckets", () => {
    expect(emailKey(req({ email: "a@x.com" }))).not.toBe(emailKey(req({ email: "b@x.com" })));
  });

  it("falls back to IP when no email is supplied", () => {
    expect(emailKey(req({}, { "x-forwarded-for": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(emailKey(req({ email: "" }, {}, "8.8.8.8"))).toBe("8.8.8.8");
  });

  it("falls back to IP when the body is missing entirely — the mount-order trap", () => {
    // If these limiters are ever mounted before express.json(), req.body is
    // undefined and every request silently collapses to the IP key, which is
    // exactly the protection this replaced. They are mounted after the parser.
    expect(emailKey({ headers: { "x-forwarded-for": "7.7.7.7" } })).toBe("7.7.7.7");
  });

  it("does not throw on a non-string email", () => {
    expect(() => emailKey(req({ email: { evil: true } }))).not.toThrow();
    expect(() => emailKey(req({ email: 12345 }))).not.toThrow();
  });
});

describe("clientIp", () => {
  it("takes the leftmost x-forwarded-for entry", () => {
    expect(clientIp(req({}, { "x-forwarded-for": "5.5.5.5, 10.0.0.1, 10.0.0.2" }))).toBe("5.5.5.5");
  });

  it("falls back to req.ip, then to a constant", () => {
    expect(clientIp(req({}, {}, "6.6.6.6"))).toBe("6.6.6.6");
    expect(clientIp(req({}, {}))).toBe("unknown");
  });
});
