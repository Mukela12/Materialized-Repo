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

describe("the admin list of claims", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  it("shows a pass as joined once used, open until its activation date, then expired", async () => {
    const { passState } = await import("../../server/parisCampaign");
    expect(passState("2026-11-05T09:00:00Z", "2026-11-04T00:00:00Z", now)).toBe("joined");
    expect(passState(null, "2026-11-12T00:00:00Z", now)).toBe("open");
    expect(passState(null, "2026-11-10T12:00:00Z", now)).toBe("expired");
  });
  it("shapes a row with both passes, the friend's account and video counts", async () => {
    const { shapeClaim } = await import("../../server/parisCampaign");
    const row = shapeClaim({
      id: "c1", created_at: "2026-11-01T10:00:00Z", first_name: "Ines", email: "ines@example.com", platform: "instagram",
      creator_handle: "ines.paris", friend_handle: "camille_style", activate_by: "2026-11-15T10:00:00Z",
      c_code: "PCW-AAAA", c_joined_at: "2026-11-02T08:00:00Z", c_user_id: "u1", c_name: "Ines", c_videos: 2,
      f_code: "PCW-BBBB", f_joined_at: null, f_user_id: null, f_name: null, f_videos: 0,
    }, now);
    expect(row.creator).toMatchObject({ code: "PCW-AAAA", state: "joined", userId: "u1", videos: 2 });
    expect(row.friend).toMatchObject({ code: "PCW-BBBB", state: "open", joinedAt: null, videos: 0 });
    expect(row.activateBy).toBe("2026-11-15T10:00:00.000Z");
  });
  it("is admin only", () => {
    expect(read("server/routes.ts")).toMatch(/app\.get\("\/api\/admin\/paris-creator-week", requireAdmin/);
  });
});
