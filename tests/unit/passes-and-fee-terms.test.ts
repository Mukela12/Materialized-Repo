/**
 * Creator passes per brand, and the marketplace-fee agreement (client, 29 Sep
 * 2026): "10 creator passes per brand from Brooklyn, with X creator passes
 * remaining" and "the prompt to agree to 15% marketplace fee".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const routes = code("server/routes.ts");
const auth = code("server/authRoutes.ts");

describe("creator passes", () => {
  it("a brand's own limit wins over the platform default", () => {
    expect(routes).toMatch(/const limit = brand\?\.invitePassLimit \?\? inviteCapPerBrand\(\);/);
  });

  it("the sign-up code's passes become the brand's limit, and a lost voucher takes them back", () => {
    expect(auth).toMatch(/voucherCreatorPasses = check\.voucher\.creatorPasses \?\? null;/);
    expect(auth).toMatch(/if \(brand && voucherCreatorPasses != null\) \{\s*await storage\.updateBrand\(brand\.id, \{ invitePassLimit: voucherCreatorPasses \}/);
    expect(auth).toMatch(/updateBrand\(own\.id, \{ invitePassLimit: null \}/);
  });

  it("the code keeps its passes when read and when created (fields are listed one by one)", () => {
    const storage = code("server/storage.ts");
    expect(storage).toMatch(/creatorPasses: row\.creatorPasses \?\? null,/);
    expect(storage).toMatch(/creatorPasses: v\.creatorPasses \?\? null,\s*partner: v\.partner \?\? null,/);
  });

  it("changing a code's passes reaches brands already signed up with it", () => {
    expect(code("server/storage.ts")).toMatch(/UPDATE brands b\s+SET invite_pass_limit = \$\{action\.passes\}/);
  });

  it("brands see what they have left, and it refreshes after each invite", () => {
    expect(routes).toMatch(/app\.get\("\/api\/brands\/invite-passes"/);
    expect(routes).toMatch(/"invite-passes"\]/); // not shadowed by /api/brands/:id
    expect(code("client/src/pages/brand-creators.tsx")).toMatch(/<CreatorPassesLeft/);
    expect(code("client/src/pages/brand-dashboard.tsx")).toMatch(/<CreatorPassesLeft/);
    expect((code("client/src/pages/brand-creators.tsx").match(/queryKey: \["\/api\/brands\/invite-passes"\]/g) ?? []).length).toBe(2);
  });

  it("Brooklyn's brand codes carry 10", () => {
    const sql = read("migrations/0040_creator_passes_and_fee_terms.sql");
    expect(sql).toMatch(/SET creator_passes = 10\s+WHERE role_restriction = 'brand'\s+AND \(label ILIKE '%brooklyn%' OR assigned_to ILIKE '%brooklyn%'\)/);
  });
});

describe("the marketplace-fee agreement", () => {
  it("a brand can't sign up without agreeing, and the rate agreed to is recorded", () => {
    expect(auth).toMatch(/if \(role === "brand" && acceptFeeTerms !== true\) \{/);
    expect(auth).toMatch(/feeTermsAcceptedAt: new Date\(\), feeTermsPct: feePct\.toFixed\(2\)/);
  });

  it("the wording states what the fee covers and what it doesn't", () => {
    const ui = code("client/src/components/FeeTerms.tsx");
    for (const phrase of ["in-video checkout", "card processing (merchant) fees", "commission to the publishers who share your videos", "doesn't include what you already pay your own influencers"]) {
      expect(ui).toContain(phrase);
    }
  });

  it("brands who haven't agreed to the CURRENT rate are asked once, and can't dismiss it", () => {
    const ui = code("client/src/components/FeeTerms.tsx");
    expect(ui).toMatch(/return !user\.feeTermsAcceptedAt \|\| Number\(user\.feeTermsPct\) !== Number\(terms\.marketplaceFeePct\);/);
    expect(ui).toMatch(/onEscapeKeyDown=\{\(e\) => e\.preventDefault\(\)\}/);
    expect(code("client/src/App.tsx")).toMatch(/<FeeTermsGate \/>/);
  });

  it("the first-run tour waits for it", () => {
    expect(code("client/src/components/FirstRunTour.tsx")).toMatch(/if \(!user\?\.id \|\| user\.isAdmin \|\| !user\.createdAt \|\| feePending\) return;/);
  });

  it("the sign-up form requires the tick for brands only", () => {
    expect(code("client/src/pages/register.tsx")).toMatch(/\.refine\(\(d\) => d\.role !== "brand" \|\| d\.acceptFeeTerms === true/);
  });
});
