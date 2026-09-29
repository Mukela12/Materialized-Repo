/**
 * Read routes that answered anyone (QA pass, 29 Sep 2026).
 *
 * An audit of every handler with no sign-in check found brand campaigns
 * (budgets, publishers) readable for any brandId, a video's publishers with
 * their commission rates and tracking codes, a publisher's embed sites, and
 * creator invitations (names, emails) of whichever brand was first in the
 * table, which is also what every signed-in brand was shown. The brand
 * Campaigns page asked without a brandId and always got 400, so it was empty.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const routes = code("server/routes.ts");

function handler(method: string, path: string): string {
  const start = routes.indexOf(`app.${method}("${path}"`);
  expect(start, `${method} ${path} exists`).toBeGreaterThan(-1);
  const next = routes.indexOf("\n  app.", start + 10);
  return routes.slice(start, next === -1 ? undefined : next);
}

describe("brand-side reads need the brand's owner (or an admin)", () => {
  it("campaign lists and stats are scoped to the caller's brands", () => {
    for (const path of ["/api/campaigns", "/api/campaigns/stats"]) {
      const body = handler("get", path);
      expect(body, path).toMatch(/const actor = await actorOr401\(req, res\);/);
      expect(body, path).toMatch(/await readableBrandIds\(req, res, actor\)/);
    }
  });

  it("the Campaigns page's own request (no brandId) is answered, not refused", () => {
    expect(handler("get", "/api/campaigns")).not.toMatch(/Brand ID required/);
  });

  it("a single campaign and its detail need its brand's owner", () => {
    expect(handler("get", "/api/campaigns/:id")).toMatch(/await readableCampaign\(req, res\)/);
    expect(handler("get", "/api/campaigns/:id/detail")).toMatch(/await readableCampaign\(req, res\)/);
    expect(routes).toMatch(/if \(brand\?\.ownerId !== actor\.id\) \{ res\.status\(403\)/);
  });

  it("creator invitations are the caller's own brand's, never the first brand in the table", () => {
    const body = handler("get", "/api/brands/creator-invites");
    expect(body).toMatch(/await readableBrandIds\(req, res, actor\)/);
    expect(body).not.toMatch(/brands\[0\]/);
  });

  it("asking for another brand's data is refused unless admin", () => {
    expect(routes).toMatch(/if \(actor\.isAdmin \|\| owned\.includes\(asked\)\) return \[asked\];\s*res\.status\(403\)/);
  });
});

describe("publisher and video data", () => {
  it("a video's publishers (rates, codes, earnings) need the video's editor", () => {
    expect(handler("get", "/api/videos/:id/affiliates")).toMatch(/await videoEditorOr403\(req, res\)/);
  });

  it("a publisher's embed sites are theirs or an admin's", () => {
    expect(routes).toMatch(/app\.get\("\/api\/embed-deployments\/:affiliateId", requireSelfOrAdmin\("affiliateId"\)/);
  });
});

describe("links checked when the page opens", () => {
  it("reset and invite links can be checked without revealing whose they are", () => {
    const auth = code("server/authRoutes.ts");
    expect(auth).toMatch(/app\.get\("\/api\/auth\/reset-password\/:token"/);
    const check = handler("get", "/api/affiliates/accept/:token");
    expect(check).not.toMatch(/email/);
    expect(auth.slice(auth.indexOf('app.get("/api/auth/reset-password/:token"'), auth.indexOf('app.post("/api/auth/reset-password"'))).not.toMatch(/email/);
  });

  it("both pages check on open", () => {
    expect(code("client/src/pages/reset-password.tsx")).toMatch(/fetch\(`\/api\/auth\/reset-password\/\$\{encodeURIComponent\(token\)\}`\)/);
    expect(code("client/src/pages/affiliate-accept.tsx")).toMatch(/fetch\(`\/api\/affiliates\/accept\/\$\{encodeURIComponent\(token\)\}`\)/);
  });

  it("checking a link does not use up the email-send allowance", () => {
    const index = code("server/index.ts");
    expect(index).toMatch(/req\.method === "POST" \? limiter\(req, res, next\) : next\(\)/);
    expect(index).toMatch(/onlyPost\(emailSendLimiter\),\s*authLimiter,/);
  });
});

describe("every brand account has a brand (found in QA, 29 Sep)", () => {
  it("sign-up creates the brand for a brand account", () => {
    const auth = code("server/authRoutes.ts");
    expect(auth).toMatch(/if \(role === "brand"\) \{\s*const brand = await ensureOwnBrand\(user\)/);
  });

  it("only brand accounts get one, one per account even under concurrent first requests", () => {
    const helper = code("server/brandAccount.ts");
    expect(helper).toMatch(/if \(user\.role !== "brand"\) return null;/);
    expect(helper).toMatch(/pg_advisory_xact_lock\(hashtext\(\$\{"own-brand:" \+ user\.id\}\)\)/);
    expect(helper).toMatch(/if \(existing\) return existing;/);
  });

  it("the routes that need a brand make one instead of answering 'No brand available'", () => {
    const n = (routes.match(/if \(!brandId && actor\) await ensureOwnBrand\(actor\);/g) ?? []).length;
    expect(n).toBe(3); // add product, invite a creator, invite creators in bulk
  });

  it("existing brand accounts without one are backfilled", () => {
    const sql = read("migrations/0038_brand_for_every_brand_account.sql");
    expect(sql).toMatch(/WHERE u\.role = 'brand'\s+AND NOT EXISTS \(SELECT 1 FROM brands b WHERE b\.owner_id = u\.id\)/);
  });
});

describe("a brand can rename itself", () => {
  it("only its owner or an admin, with a sane length", () => {
    const body = handler("patch", "/api/brands/:id");
    expect(body).toMatch(/if \(!actor\?\.isAdmin && brand\.ownerId !== uid\) return res\.status\(403\)/);
    expect(body).toMatch(/name\.length < 2 \|\| name\.length > 80/);
  });

  it("'mine' is not swallowed as a brand id", () => {
    expect(routes).toMatch(/const BRAND_LITERAL_ROUTES = \[[^\]]*"mine"[^\]]*\];/);
  });

  it("brand accounts see the name card on their profile", () => {
    expect(code("client/src/pages/profile.tsx")).toMatch(/\{user\?\.role === "brand" && <BrandNameCard \/>\}/);
  });
});

describe("health check", () => {
  it("is a real route that pings the database, registered before anything can shadow it", () => {
    const start = routes.indexOf("export async function registerRoutes(");
    const health = routes.indexOf('app.get("/api/health"');
    expect(health).toBeGreaterThan(start);
    expect(routes.indexOf("\n  app.", start)).toBe(routes.lastIndexOf("\n", health));
    expect(handler("get", "/api/health")).toMatch(/pool\.query\("SELECT 1"\)/);
    expect(handler("get", "/api/health")).toMatch(/res\.status\(503\)/);
  });
});

describe("brand Subscription page (crashed for every brand, 5 Aug to 29 Sep)", () => {
  it("prices the plan by its key, not the plan object", async () => {
    const page = code("client/src/pages/brand-settings-subscription.tsx");
    expect(page).toMatch(/<PricingEstimator plan=\{currentPlan\.id as PlanKey\}/);
    expect(page).not.toMatch(/plan=\{\(currentPlan as any\)/);
    const { PLAN_ALLOWANCES } = await import("../../shared/plans");
    for (const id of ["starter", "pro", "creator"]) expect(PLAN_ALLOWANCES[id as "starter"]).toBeDefined();
  });
});
