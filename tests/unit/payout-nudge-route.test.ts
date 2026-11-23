/**
 * GET /api/payouts/nudge was answered "403 Forbidden" on every page load.
 *
 * Seen 23 Nov 2026 on /brand, /brand/creators and /brand/brand-kit as four
 * console errors per page. The cause was not the brand account: Express matches
 * routes in declaration order, and `/api/payouts/:userId` (guarded by
 * requireSelfOrAdmin) is declared about 5,600 lines above `/api/payouts/nudge`,
 * so "nudge" was read as a user id and refused for every account that is not an
 * admin. Creators and Publishers got the same 403, which means the "Get your
 * payouts ready" banner had never shown for anyone.
 *
 * Two fixes, both pinned here:
 *   1. the :userId route hands the literal names on to their own routes;
 *   2. the banner only asks for the accounts the nudge is for (creators and
 *      Publishers), so a brand or an admin sends no request at all.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPayoutNudgeAudience } from "../../shared/payoutNudge";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const ROUTES = read("server/routes.ts");

describe("who the payout nudge is for", () => {
  it("creators and Publishers (stored as affiliate)", () => {
    expect(isPayoutNudgeAudience({ role: "creator", isAdmin: false })).toBe(true);
    expect(isPayoutNudgeAudience({ role: "affiliate", isAdmin: false })).toBe(true);
    expect(isPayoutNudgeAudience({ role: "creator" })).toBe(true);
  });

  it("never a brand", () => {
    expect(isPayoutNudgeAudience({ role: "brand", isAdmin: false })).toBe(false);
  });

  it("never an admin, whatever their role", () => {
    for (const role of ["creator", "affiliate", "brand"]) {
      expect(isPayoutNudgeAudience({ role, isAdmin: true }), role).toBe(false);
    }
  });

  it("nobody while the account is still loading or signed out", () => {
    expect(isPayoutNudgeAudience(undefined)).toBe(false);
    expect(isPayoutNudgeAudience(null)).toBe(false);
    expect(isPayoutNudgeAudience({})).toBe(false);
    expect(isPayoutNudgeAudience({ role: "publisher" })).toBe(false);
  });
});

describe("the banner does not ask for accounts outside the audience", () => {
  const banner = read("client/src/components/PayoutNudgeBanner.tsx");

  it("the request is switched off unless the signed-in account is in the audience", () => {
    expect(banner).toContain("const inAudience = isPayoutNudgeAudience(user);");
    const query = banner.slice(banner.indexOf('queryKey: ["/api/payouts/nudge"]'));
    expect(query.slice(0, query.indexOf("});"))).toContain("enabled: inAudience");
  });

  it("a cached answer from an earlier sign-in cannot show it either", () => {
    expect(banner).toContain("if (dismissed || !inAudience || !data?.needed) return null;");
  });

  it("the server answers with the same rule", () => {
    const at = ROUTES.indexOf('app.get("/api/payouts/nudge"');
    const handler = ROUTES.slice(at, at + 2000);
    expect(handler).toContain("const inAudience = isPayoutNudgeAudience(user);");
    expect(handler).toContain("needed: inAudience &&");
  });
});

describe("/api/payouts/:userId does not eat /api/payouts/nudge", () => {
  const idAt = ROUTES.indexOf('app.get("/api/payouts/:userId"');

  it("the :userId route hands the literal names on before its guard runs", () => {
    expect(idAt).toBeGreaterThan(-1);
    const route = ROUTES.slice(idAt, idAt + 500);
    const handOff = route.indexOf('if (PAYOUT_LITERAL_ROUTES.includes(req.params.userId)) return next("route");');
    const guard = route.indexOf('requireSelfOrAdmin("userId")');
    expect(handOff, "hand-off present").toBeGreaterThan(-1);
    expect(guard, "guard present").toBeGreaterThan(-1);
    // Before the guard: after it, "nudge" has already been refused with 403.
    expect(handOff).toBeLessThan(guard);
  });

  it("every literal GET declared after it is on the hand-off list", () => {
    const listAt = ROUTES.indexOf("const PAYOUT_LITERAL_ROUTES");
    expect(listAt).toBeGreaterThan(-1);
    expect(listAt).toBeLessThan(idAt);
    const listed = ROUTES.slice(listAt, idAt);

    const literals = [...ROUTES.matchAll(/app\.get\(\s*"\/api\/payouts\/([a-z][a-z0-9-]*)"/g)]
      .filter((m) => (m.index ?? 0) > idAt)
      .map((m) => m[1]);
    expect(literals).toContain("nudge");
    for (const seg of literals) {
      expect(listed, `GET /api/payouts/${seg} is declared after :userId and would be refused with 403`).toContain(`"${seg}"`);
    }
  });
});

/**
 * The same mistake anywhere else in the file. A literal route declared after a
 * parameterised one with the same method and shape is only reachable if the
 * parameterised route hands it off through a *_LITERAL_ROUTES list.
 */
describe("no literal route in server/routes.ts sits unreachable behind a parameterised one", () => {
  type Route = { method: string; path: string; at: number };
  const routes: Route[] = [...ROUTES.matchAll(/app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)].map((m) => ({
    method: m[1],
    path: m[2],
    at: m.index ?? 0,
  }));

  const matches = (pattern: string, path: string) => {
    const a = pattern.split("/");
    const b = path.split("/");
    return a.length === b.length && a.every((seg, i) => seg.startsWith(":") || seg === b[i]);
  };

  it("finds the routes it is meant to check", () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it("each one is on its parameterised route's hand-off list", () => {
    const unreachable: string[] = [];
    for (const literal of routes) {
      if (literal.path.includes(":")) continue;
      for (const param of routes) {
        if (param.at >= literal.at || param.method !== literal.method || !param.path.includes(":")) continue;
        if (!matches(param.path, literal.path)) continue;

        // The literal's name where the parameter sits, e.g. "nudge" for :userId.
        const names = param.path.split("/")
          .map((seg, i) => (seg.startsWith(":") ? literal.path.split("/")[i] : null))
          .filter((s): s is string => s !== null);
        const handler = ROUTES.slice(param.at, param.at + 500);
        const list = handler.match(/([A-Z_]+_LITERAL_ROUTES)\.includes\(req\.params\.\w+\)/)?.[1];
        const declared = list ? ROUTES.match(new RegExp(`const ${list} = \\[([^\\]]*)\\]`))?.[1] ?? "" : "";
        if (!names.some((n) => declared.includes(`"${n}"`))) {
          unreachable.push(`${literal.method.toUpperCase()} ${literal.path} is behind ${param.path}`);
        }
      }
    }
    expect(unreachable).toEqual([]);
  });
});
