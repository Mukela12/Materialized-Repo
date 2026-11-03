/**
 * Invite campaigns (3 Nov 2026): the client's list of people with no account,
 * invited a set number a day, each with their own free pass.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULTS, checkContact, checkSettings, contactTypeOf, daysToFinish, inviteVoucher, nextSendAt, renderInvite,
  shareThisRun, startOfUtcDay, startProblem, signupUrl, unknownCampaignFields, SEND_WINDOW_UTC,
} from "../../server/inviteCampaigns";

const at = (iso: string) => new Date(iso);

describe("contacts", () => {
  it("reads the words people use for each type", () => {
    expect(contactTypeOf("Creator")).toBe("creator");
    expect(contactTypeOf("influencers")).toBe("creator");
    expect(contactTypeOf(" Brand ")).toBe("brand");
    expect(contactTypeOf("designer")).toBe("brand");
    expect(contactTypeOf("publisher")).toBeNull();
    expect(contactTypeOf("")).toBeNull();
  });

  it("lowercases the email and falls back to the upload's type", () => {
    const c = checkContact({ name: "  Ana   Rivera ", email: " Ana@Example.COM ", type: "" }, "creator");
    expect(c).toEqual({ ok: true, contact: { name: "Ana Rivera", email: "ana@example.com", type: "creator", company: null } });
  });

  it("refuses a bad email or a type it can't read", () => {
    expect(checkContact({ email: "not-an-email", type: "creator" }, null)).toMatchObject({ ok: false, error: "Email doesn't look right" });
    expect(checkContact({ email: "a@b.co", type: "agency" }, "creator")).toMatchObject({ ok: false });
    expect(checkContact({ email: "a@b.co" }, null)).toMatchObject({ ok: false, error: "No type: creator or brand" });
  });
});

describe("pacing", () => {
  it("sends nothing outside the sending hours", () => {
    expect(shareThisRun(at("2026-11-06T13:00:00Z"), 50, 0)).toBe(0);
    expect(shareThisRun(at(`2026-11-06T${SEND_WINDOW_UTC.to}:00:00Z`), 50, 0)).toBe(0);
  });

  it("spreads the day's number over the runs left", () => {
    // 8 runs from 14:00 to 21:00: 50 a day goes 7, 7, 6, ...
    const now = at("2026-11-06T14:00:00Z");
    expect(shareThisRun(now, 50, 0)).toBe(7);
    let sent = 0;
    for (let h = SEND_WINDOW_UTC.from; h < SEND_WINDOW_UTC.to; h++) {
      sent += shareThisRun(at(`2026-11-06T${String(h).padStart(2, "0")}:00:00Z`), 50, sent);
    }
    expect(sent).toBe(50);
  });

  it("still sends the whole day's number when started late in the day", () => {
    expect(shareThisRun(at("2026-11-06T20:00:00Z"), 50, 0)).toBe(25);
    expect(shareThisRun(at("2026-11-06T21:00:00Z"), 50, 25)).toBe(25);
    expect(shareThisRun(at("2026-11-06T21:00:00Z"), 50, 50)).toBe(0);
  });

  it("knows when the next send is", () => {
    expect(nextSendAt(at("2026-11-06T09:30:00Z"), 50, 0).toISOString()).toBe("2026-11-06T14:00:00.000Z");
    expect(nextSendAt(at("2026-11-06T15:10:00Z"), 50, 10).toISOString()).toBe("2026-11-06T16:00:00.000Z");
    expect(nextSendAt(at("2026-11-06T15:10:00Z"), 50, 50).toISOString()).toBe("2026-11-07T14:00:00.000Z");
    expect(nextSendAt(at("2026-11-06T21:30:00Z"), 50, 20).toISOString()).toBe("2026-11-07T14:00:00.000Z");
  });

  it("counts days and the UTC day", () => {
    expect(daysToFinish(800, 50)).toBe(16);
    expect(daysToFinish(801, 50)).toBe(17);
    expect(startOfUtcDay(at("2026-11-06T23:59:00Z")).toISOString()).toBe("2026-11-06T00:00:00.000Z");
  });
});

describe("settings", () => {
  const good = { ...DEFAULTS, postalAddress: "ONE30M LLC\n1 Main St, Town, FL 00000" };

  it("accepts the defaults and joins address lines", () => {
    const v = checkSettings(good as any);
    expect("error" in v).toBe(false);
    expect((v as any).postalAddress).toBe("ONE30M LLC, 1 Main St, Town, FL 00000");
  });

  it("refuses unknown merge fields, bad numbers and a bad reply-to", () => {
    expect(checkSettings({ ...good, creatorBody: "Hi {{First}}" } as any)).toMatchObject({ error: expect.stringContaining("{{First}}") });
    expect(checkSettings({ ...good, dailyLimit: 0 } as any)).toMatchObject({ error: expect.any(String) });
    expect(checkSettings({ ...good, dailyLimit: 500 } as any)).toMatchObject({ error: expect.any(String) });
    expect(checkSettings({ ...good, replyTo: "nope" } as any)).toMatchObject({ error: expect.any(String) });
    expect(checkSettings({ ...good, name: "A: B" } as any)).toMatchObject({ error: expect.any(String) });
    expect(unknownCampaignFields("{{FirstName}} {{CompanyName}} {{Oops}}")).toEqual(["Oops"]);
  });

  it("won't start without a list or a postal address", () => {
    expect(startProblem({ postalAddress: "x" }, 0)).toMatch(/Upload the list/);
    expect(startProblem({ postalAddress: null }, 10)).toMatch(/postal address/);
    expect(startProblem({ postalAddress: "x" }, 10)).toBeNull();
  });
});

describe("the email", () => {
  const settings = { ...DEFAULTS, postalAddress: "ONE30M LLC, 1 Main St" };
  const base = { settings, code: "MTZ-AAAA-BBBB-CCCC", useBy: at("2026-12-07T00:00:00Z"), origin: "https://www.mtrlzd.com/", unsubscribeUrl: "https://www.mtrlzd.com/unsubscribe/tok" };

  it("greets a creator by first name and carries their pass, link, code and the way out", () => {
    const r = renderInvite({ ...base, contact: { name: "Ana Rivera", email: "ana@example.com", type: "creator", company: null } });
    expect(r.subject).toBe("Ana, a free Creator Pass for MTRLZD");
    expect(r.html).toContain("Hi Ana,");
    expect(r.html).toContain("Your free Creator Pass: 30 days of MTRLZD free. Use it by December 6.");
    expect(r.signupUrl).toBe("https://www.mtrlzd.com/register?code=MTZ-AAAA-BBBB-CCCC&role=creator");
    expect(r.html).toContain(r.signupUrl.replace(/&/g, "&amp;"));
    expect(r.html).toContain("MTZ-AAAA-BBBB-CCCC");
    expect(r.html).toContain('href="https://www.mtrlzd.com/unsubscribe/tok"');
    expect(r.html).toContain("ONE30M LLC, 1 Main St");
    expect(r.html).not.toMatch(/<img/);
    expect(r.text).toContain("Unsubscribe".toLowerCase());
    expect(r.text).toContain(r.signupUrl);
  });

  it("doesn't greet a brand by the first word of its brand name", () => {
    const r = renderInvite({ ...base, contact: { name: "Fashion Week Brooklyn", email: "media@fwb.com", type: "brand", company: null } });
    expect(r.html).toContain("Hi there,");
    expect(r.text).toContain("We'd love Fashion Week Brooklyn to try it");
    expect(r.subject).toBe("A free Brand Pass for Fashion Week Brooklyn on MTRLZD");
    expect(r.signupUrl).toContain("role=brand");
  });

  it("greets the person when a brand row has a Company column", () => {
    const r = renderInvite({ ...base, contact: { name: "Sam Lee", email: "sam@acme.com", type: "brand", company: "Acme Studio" } });
    expect(r.html).toContain("Hi Sam,");
    expect(r.text).toContain("We'd love Acme Studio to try it");
  });

  it("escapes what people typed", () => {
    const r = renderInvite({ ...base, contact: { name: "<b>Eve</b>", email: "eve@example.com", type: "creator", company: null } });
    expect(r.html).not.toContain("<b>Eve</b>");
  });

  it("builds a signup link with the code encoded", () => {
    expect(signupUrl("https://x.com", "A B", "brand")).toBe("https://x.com/register?code=A%20B&role=brand");
  });
});

describe("the pass", () => {
  it("is single use, for that kind of account, with the campaign as its partner", () => {
    const now = at("2026-11-06T15:00:00Z");
    const v = inviteVoucher({
      code: "MTZ-1", campaignId: "c1", campaignName: "Beth's list", now, createdBy: "admin1",
      contact: { name: "Sam", email: "sam@acme.com", type: "brand", company: "Acme" },
      settings: { creatorFreeDays: 30, brandFreeDays: 45, useWithinDays: 30 },
    });
    expect(v).toMatchObject({
      code: "MTZ-1", partner: "Beth's list", grantType: "free_access", roleRestriction: "brand", maxRedemptions: 1,
      freeDays: 45, batchId: "campaign:c1", assignedTo: "sam@acme.com", label: "Beth's list: Sam",
    });
    expect(v.expiresAt.toISOString()).toBe("2026-12-06T15:00:00.000Z");
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

  it("claims each person before sending and re-uses a retry's pass", () => {
    const store = read("server/inviteCampaignStore.ts");
    expect(store).toMatch(/set status = 'sending'[\s\S]*for update skip locked/);
    expect(store).toContain("A retry reuses the pass minted the first time.");
  });

  it("leaves out anyone with an account or who unsubscribed before", () => {
    const store = read("server/inviteCampaignStore.ts");
    expect(store).toContain('"has_account"');
    expect(store).toContain('"unsubscribed"');
    expect(store).toMatch(/markNoLongerInvitable/);
  });

  it("keeps an invite opt-out in force for the journeys", () => {
    expect(read("server/journeyStore.ts")).toMatch(/invite_contacts ic where ic\.email = lower\(u\.email\) and ic\.opted_out_at is not null/);
  });

  it("sends with one-click unsubscribe headers and runs hourly", () => {
    const mail = read("server/emailService.ts");
    expect(mail).toMatch(/sendCampaignInvites[\s\S]*List-Unsubscribe-Post/);
    expect(read("server/index.ts")).toMatch(/name: "invite-campaigns",\s*schedule: process\.env\.INVITE_CAMPAIGN_CRON \|\| "0 \* \* \* \*"/);
  });
});
