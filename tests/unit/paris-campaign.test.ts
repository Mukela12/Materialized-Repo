/**
 * Paris Creator Week (27 Oct 2026): the claim form's rules, the passes it mints
 * and the email that carries them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parisSignupSchema } from "../../shared/paris-campaign";
import { campaignPassesEmail } from "../../server/emailService";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const ok = { fullName: "Ines", email: "Ines@Example.com", platform: "instagram", creatorHandle: "@ines.paris", friendHandle: "camille_style" };

describe("claim form", () => {
  it("accepts a normal claim and tidies it", () => {
    expect(parisSignupSchema.parse(ok)).toMatchObject({ email: "ines@example.com", creatorHandle: "ines.paris", friendHandle: "camille_style" });
  });
  it("refuses the same handle twice, links instead of handles, and bad Instagram dots", () => {
    expect(parisSignupSchema.safeParse({ ...ok, friendHandle: "ines.paris" }).success).toBe(false);
    expect(parisSignupSchema.safeParse({ ...ok, friendHandle: "https://instagram.com/x" }).success).toBe(false);
    expect(parisSignupSchema.safeParse({ ...ok, creatorHandle: "ines..paris" }).success).toBe(false);
    expect(parisSignupSchema.safeParse({ ...ok, platform: "tiktok", creatorHandle: "ines..paris" }).success).toBe(true);
  });
});

describe("the passes", () => {
  const src = read("server/parisCampaign.ts");
  it("are real single-use creator vouchers tagged Paris Creator Week, 30 days free, 14 days to activate", () => {
    expect(src).toMatch(/partner: "Paris Creator Week"/);
    expect(src).toMatch(/freeDays: 30/);
    expect(src).toMatch(/activationDays: 14/);
    expect(src).toMatch(/'free_access', 'creator', 1, \$\{PARIS\.freeDays\}/);
  });
  it("both passes and the claim are written together", () => {
    expect(src).toMatch(/db\.transaction\(async \(tx\) =>/);
  });
  it("the page and the homepage tab are wired", () => {
    expect(read("client/src/App.tsx")).toMatch(/<Route path="\/paris-creator-week" component=\{ParisCreatorWeek\} \/>/);
    expect(read("client/src/pages/landing.tsx")).toMatch(/data-testid="link-paris-creator-week-tab"/);
    expect(read("server/routes.ts")).toMatch(/registerParisCampaignRoutes\(app\)/);
  });
});

describe("the email", () => {
  const e = campaignPassesEmail({
    to: "ines@example.com", firstName: "Ines <b>", campaignName: "Paris Creator Week",
    creatorCode: "PCW-AAAA-BBBB-CCCC", friendCode: "PCW-DDDD-EEEE-FFFF", friendHandle: "camille_style",
    expiresAt: new Date("2026-11-09T12:00:00Z"), freeDays: 30,
    creatorUrl: "https://www.mtrlzd.com/register?code=PCW-AAAA-BBBB-CCCC", friendUrl: "https://www.mtrlzd.com/register?code=PCW-DDDD-EEEE-FFFF",
  });
  it("carries both codes and both links, and the deadline", () => {
    for (const s of ["PCW-AAAA-BBBB-CCCC", "PCW-DDDD-EEEE-FFFF", "@camille_style", "9 November"]) expect(e.text).toContain(s);
    expect(e.html).toContain("Activate My Pass");
  });
  it("escapes what people typed", () => {
    expect(e.html).not.toContain("<b>");
  });
});
