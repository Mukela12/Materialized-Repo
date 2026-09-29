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
