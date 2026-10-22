/**
 * The admin Activity tab (22 Oct 2026): what a page view may carry, and that
 * it never carries more than the page. Tokens in reset and verify links, query
 * strings and full referrer URLs must not reach the table.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanPageView, pageOf, referrerHostOf, windowDays } from "../../server/activityRules";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

const ok = { visitorId: "3f2a9c1e-77aa-4b1c-9d2e-0a1b2c3d4e5f", sessionId: "abcdEFGH1234", path: "/register" };

describe("pageOf", () => {
  it("keeps the page and drops the query and hash", () => {
    expect(pageOf("/register?code=MTZ-ABCD-EFGH&role=brand")).toBe("/register");
    expect(pageOf("/help#faq")).toBe("/help");
  });

  it("never stores a token from a reset, verify or invite link", () => {
    expect(pageOf("/reset-password/9b1f0c22aa77secret")).toBe("/reset-password/:token");
    expect(pageOf("/verify-email/abc123def456")).toBe("/verify-email/:token");
    expect(pageOf("/affiliate/accept/xyz789secret")).toBe("/affiliate/accept/:token");
    expect(pageOf("/brand-authorize/tok_123456")).toBe("/brand-authorize/:token");
  });

  it("folds ids so one page counts as one page", () => {
    expect(pageOf("/brand/campaigns/3f2a9c1e-77aa-4b1c-9d2e-0a1b2c3d4e5f")).toBe("/brand/campaigns/:id");
    expect(pageOf("/brand/campaigns/123456")).toBe("/brand/campaigns/:id");
  });

  it("refuses anything that is not a path", () => {
    expect(pageOf("https://evil.example/x")).toBeNull();
    expect(pageOf("")).toBeNull();
    expect(pageOf(42)).toBeNull();
  });

  it("caps the length", () => {
    expect(pageOf("/" + "a".repeat(500))!.length).toBe(160);
  });
});

describe("referrerHostOf", () => {
  it("keeps only the site, never the path or query", () => {
    expect(referrerHostOf("https://www.Instagram.com/p/abc?token=secret")).toBe("www.instagram.com");
    expect(referrerHostOf("not a url")).toBeNull();
    expect(referrerHostOf("")).toBeNull();
  });
});

describe("cleanPageView", () => {
  it("accepts a well-formed view and canonicalises the code", () => {
    expect(cleanPageView({ ...ok, device: "mobile", code: "mtz-abcd-efgh", referrer: "https://l.instagram.com/x" })).toEqual({
      visitorId: ok.visitorId, sessionId: ok.sessionId, path: "/register",
      referrerHost: "l.instagram.com", device: "mobile", code: "MTZABCDEFGH",
    });
  });

  it("drops a view with a missing or malformed id", () => {
    expect(cleanPageView({ ...ok, visitorId: undefined })).toBeNull();
    expect(cleanPageView({ ...ok, sessionId: "short" })).toBeNull();
    expect(cleanPageView({ ...ok, visitorId: "x'; drop table users;--" })).toBeNull();
    expect(cleanPageView({ ...ok, path: "nope" })).toBeNull();
  });

  it("ignores an unknown device and an oversized code", () => {
    const v = cleanPageView({ ...ok, device: "toaster", code: "X".repeat(41) })!;
    expect(v.device).toBeNull();
    expect(v.code).toBeNull();
  });
});

describe("windowDays", () => {
  it("is 7, 30 or 90, and 7 for anything else", () => {
    expect(windowDays("30")).toBe(30);
    expect(windowDays(90)).toBe(90);
    expect(windowDays("365")).toBe(7);
    expect(windowDays(undefined)).toBe(7);
  });
});

describe("wiring", () => {
  const auth = read("server/authRoutes.ts");
  const routes = read("server/routes.ts");

  it("counts every way a session starts: login, email confirmation, voucher signup", () => {
    expect(auth.match(/recordLogin\(user\.id\)/g)?.length).toBe(3);
    expect(auth).toMatch(/recordSignup\(user\.id\)/);
  });

  it("a stats write can never fail a sign-in", () => {
    for (const m of auth.matchAll(/record(Login|Signup)\(user\.id\)(.{0,10})/g)) expect(m[2]).toMatch(/^\.catch/);
  });

  it("the report is admin only", () => {
    expect(routes).toMatch(/app\.get\("\/api\/admin\/activity", requireAdmin,/);
  });

  it("admins are left out of the figures", () => {
    const a = read("server/activity.ts");
    expect(a).toMatch(/a\.is_admin/);
    expect(a).toMatch(/where not u\.is_admin/);
  });

  it("the tracker honours Global Privacy Control and Do Not Track", () => {
    expect(read("client/src/lib/activity.ts")).toMatch(/globalPrivacyControl === true \|\| n\.doNotTrack === "1"/);
  });

  it("the cookie policy lists both storage keys", () => {
    const c = read("client/src/pages/cookies.tsx");
    expect(c).toMatch(/name: "mtrlzd-vid"/);
    expect(c).toMatch(/name: "mtrlzd-sid"/);
  });
});
