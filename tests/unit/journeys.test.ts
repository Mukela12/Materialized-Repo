/**
 * Email journeys (22 Oct 2026): when each email goes, to whom, and what it
 * says. The seeded copy came from a doc whose merge fields had been lost, so
 * the fallbacks matter as much as the fields.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONDITIONS, LATE_DAYS, REPEAT_GAP_DAYS, bodyToHtml, checkStepEdit, ctaUrl, decide, defaultSegment, dueAt, firstNameOf, merge,
  renderStep, unknownFields, type Facts, type Step,
} from "../../server/journeys";

const DAY = 86_400_000;
const t0 = new Date("2026-11-01T12:00:00Z");
const at = (days: number) => new Date(t0.getTime() + days * DAY);
const facts = (f: Partial<Facts> = {}): Facts => ({
  uploads: 0, brandTagged: false, products: 0, invitesSent: 0, invitesJoined: 0, inviteeUploads: 0,
  subscribed: false, lastSeenAt: null, ...f,
});
const step = (s: Partial<Step> = {}): Step => ({
  id: "s1", segment: "creators", position: 2, anchor: "signup", day: 1, condition: "always",
  subject: "Hi", body: "Hello", ctaLabel: null, ctaPath: null, enabled: true, ...s,
});
const clock = { createdAt: t0, freeAccessUntil: null as Date | null };

describe("timing", () => {
  it("counts days from sign-up", () => {
    expect(dueAt(step({ day: 3 }), clock)).toEqual(at(3));
  });

  it("counts from the end of the person's own free period, whatever its length", () => {
    const pass = { createdAt: t0, freeAccessUntil: at(60) };
    expect(dueAt(step({ anchor: "trial_end", day: -4 }), pass)).toEqual(at(56));
    const trial = { createdAt: t0, freeAccessUntil: at(14) };
    expect(dueAt(step({ anchor: "trial_end", day: 0 }), trial)).toEqual(at(14));
  });

  it("assumes 30 days for someone with no free period, as the doc does", () => {
    expect(dueAt(step({ anchor: "trial_end", day: -4 }), clock)).toEqual(at(26));
  });
});

describe("decide", () => {
  it("waits until the day", () => {
    expect(decide(step({ day: 1 }), clock, facts(), at(0.5))).toEqual({ action: "wait" });
    expect(decide(step({ day: 1 }), clock, facts(), at(1))).toEqual({ action: "send" });
  });

  it("sends when the condition holds, and waits while it might still", () => {
    const s = step({ condition: "invites_joined", day: 5 });
    expect(decide(s, clock, facts(), at(5.1))).toEqual({ action: "wait" });
    expect(decide(s, clock, facts({ invitesJoined: 1 }), at(6))).toEqual({ action: "send" });
  });

  it("gives up once it would arrive out of context", () => {
    const s = step({ condition: "invites_joined", day: 5 });
    expect(decide(s, clock, facts(), at(5 + LATE_DAYS + 0.1))).toEqual({ action: "skip", reason: "condition" });
    expect(decide(step({ day: 1 }), clock, facts(), at(1 + LATE_DAYS + 0.1))).toEqual({ action: "skip", reason: "late" });
  });

  it("a creator who already uploaded never gets 'upload your first video'", () => {
    const s = step({ condition: "no_upload", day: 1 });
    expect(decide(s, clock, facts({ uploads: 1 }), at(1 + LATE_DAYS + 1))).toEqual({ action: "skip", reason: "condition" });
  });

  it("paused emails and emails about missing features never go", () => {
    for (const s of [step({ enabled: false }), step({ condition: "needs_feature" })]) {
      expect(decide(s, clock, facts(), at(1.5)).action).toBe("wait");
      expect(decide(s, clock, facts(), at(10))).toEqual({ action: "skip", reason: "paused" });
    }
  });

  it("knows every condition it offers", () => {
    for (const [k, c] of Object.entries(CONDITIONS)) expect(typeof c.test(facts(), t0), k).toBe("boolean");
    expect(CONDITIONS.inactive_7d.test(facts({ lastSeenAt: at(-8) }), t0)).toBe(true);
    expect(CONDITIONS.inactive_7d.test(facts({ lastSeenAt: at(-1) }), t0)).toBe(false);
  });
});

describe("days-without-visiting reminders", () => {
  const nudge = step({ anchor: "inactive", day: 2 });
  const seen = (d: number) => ({ createdAt: t0, freeAccessUntil: null, lastSeenAt: at(d) });

  it("waits until someone has been away long enough, counting from their last visit", () => {
    expect(decide(nudge, seen(5), facts(), at(6))).toEqual({ action: "wait" });
    expect(decide(nudge, seen(5), facts(), at(7.1))).toEqual({ action: "send" });
  });

  it("is never skipped as late: someone away for weeks still gets it", () => {
    expect(decide(nudge, seen(0), facts(), at(40))).toEqual({ action: "send" });
  });

  it("goes again only after they came back and drifted off, and not within a week", () => {
    const sent = at(3);
    expect(decide(nudge, seen(1), facts(), at(20), sent)).toEqual({ action: "wait" });
    expect(decide(nudge, seen(5), facts(), at(8), sent)).toEqual({ action: "wait" });
    expect(decide(nudge, seen(5), facts(), at(3 + REPEAT_GAP_DAYS + 0.1), sent)).toEqual({ action: "send" });
  });

  it("can't be set to fire on the day of a visit", () => {
    expect(checkStepEdit({ subject: "S", body: "B", anchor: "inactive", day: 0, condition: "always" })).toHaveProperty("error");
  });
});

describe("uploaded but not tagged", () => {
  it("only for people with a video and no brand tagged", () => {
    expect(CONDITIONS.uploaded_not_tagged.test(facts({ uploads: 1 }), t0)).toBe(true);
    expect(CONDITIONS.uploaded_not_tagged.test(facts({ uploads: 1, brandTagged: true }), t0)).toBe(false);
    expect(CONDITIONS.uploaded_not_tagged.test(facts(), t0)).toBe(false);
  });
});

describe("the quoted reminders (migration 0044)", () => {
  const seed = readFileSync(join(__dirname, "../../migrations/0044_journey_reminders.sql"), "utf8");
  it("every journey gets a 2-day nudge, and creators get the tagging reminder", () => {
    for (const seg of ["creators", "brands", "publishers", "talent_agencies", "brand_agencies", "fashion_weeks", "film_festivals"]) {
      expect(seed).toContain(`$j$${seg}$j$, 13, $j$inactive$j$, 2,`);
    }
    expect(seed).toContain("$j$uploaded_not_tagged$j$");
    expect(seed).not.toMatch(/—/);
  });
});

describe("merge fields", () => {
  const ana = { displayName: "Ana Costa", companyName: "Costa Talent", role: "affiliate" };

  it("fills first name and company", () => {
    expect(merge("Hi {{FirstName}}, {{CompanyName}} could earn more.", ana)).toBe("Hi Ana, Costa Talent could earn more.");
  });

  it("greets 'there' when there is no usable first name", () => {
    const anon = { displayName: "ana_99", companyName: null, role: "creator" };
    expect(firstNameOf("ana_99")).toBe("");
    expect(merge("Hi {{FirstName}},", anon)).toBe("Hi there,");
  });

  it("drops a leading name from a subject rather than writing 'there, ...'", () => {
    const anon = { displayName: "", companyName: null, role: "creator" };
    expect(merge("{{FirstName}}, your videos could be worth more", anon, { subject: true })).toBe("Your videos could be worth more");
    expect(merge("{{FirstName}}, your videos could be worth more", ana, { subject: true })).toBe("Ana, your videos could be worth more");
  });

  it("never leaves an empty company", () => {
    expect(merge("for {{CompanyName}}.", { displayName: "Ana", companyName: "", role: "brand" })).toBe("for your brand.");
    expect(merge("for {{CompanyName}}.", { displayName: "Ana", companyName: null, role: "affiliate" })).toBe("for your team.");
  });

  it("catches typos in field names", () => {
    expect(unknownFields("Hi {{FirstName}} at {{Company}}")).toEqual(["Company"]);
  });
});

describe("rendering", () => {
  it("escapes what people typed into their names", () => {
    const r = renderStep({ subject: "Hi {{FirstName}}", body: "Hi {{FirstName}},", ctaLabel: null, ctaPath: null },
      { displayName: "<img src=x onerror=alert(1)>", companyName: null, role: "creator" }, "https://www.mtrlzd.com");
    expect(r.bodyHtml).not.toMatch(/<img/);
  });

  it("turns bullet lines into a list and blank lines into paragraphs", () => {
    expect(bodyToHtml("One\n\n• a\n• b")).toMatch(/^<p>One<\/p><ul[^>]*><li>a<\/li><li>b<\/li><\/ul>$/);
  });

  it("buttons go to the right page for each kind of account, on our own site only", () => {
    const o = "https://www.mtrlzd.com";
    expect(ctaUrl("{upload}", "creator", o)).toBe(`${o}/creator/my-videos`);
    expect(ctaUrl("{upload}", "brand", o)).toBe(`${o}/brand`);
    expect(ctaUrl("{portal}/invites", "affiliate", o)).toBe(`${o}/affiliate/invites`);
    expect(ctaUrl("{plans}", "brand", o)).toBe(`${o}/brand/settings/subscription`);
    expect(ctaUrl("//evil.example/x", "brand", o)).toBe(`${o}/brand`);
    expect(ctaUrl("https://evil.example", "creator", o)).toBe(`${o}/creator`);
  });
});

describe("checkStepEdit", () => {
  const ok = { subject: "S", body: "B", day: 3, anchor: "signup", condition: "always" };
  it("accepts a sensible edit", () => {
    expect(checkStepEdit(ok)).toMatchObject({ subject: "S", day: 3, enabled: true, resolveNote: false });
  });
  it("refuses links off the site, unknown fields and impossible days", () => {
    expect(checkStepEdit({ ...ok, ctaPath: "https://evil.example" })).toHaveProperty("error");
    expect(checkStepEdit({ ...ok, ctaPath: "javascript:alert(1)" })).toHaveProperty("error");
    expect(checkStepEdit({ ...ok, body: "Hi {{Name}}" })).toHaveProperty("error");
    expect(checkStepEdit({ ...ok, day: -2 })).toHaveProperty("error");
    expect(checkStepEdit({ ...ok, anchor: "trial_end", day: -4 })).not.toHaveProperty("error");
    expect(checkStepEdit({ ...ok, condition: "whenever" })).toHaveProperty("error");
  });
});

describe("segments", () => {
  it("default by account type", () => {
    expect(defaultSegment("creator")).toBe("creators");
    expect(defaultSegment("brand")).toBe("brands");
    expect(defaultSegment("affiliate")).toBe("publishers");
  });
});

describe("the seeded copy", () => {
  const seed = readFileSync(join(__dirname, "../../migrations/0043_email_journeys.sql"), "utf8");
  const inserts = seed.split("\n").filter((l) => l.startsWith("INSERT INTO email_journey_steps"));

  it("has all 84 emails", () => {
    expect(inserts.length).toBe(84);
  });

  it("lost merge fields are restored: no 'Hi ,' and no subject starting with a comma", () => {
    expect(seed).not.toMatch(/Hi ,/);
    expect(seed).not.toMatch(/\$j\$, [a-z]/);
    expect(seed).not.toMatch(/ for \./);
  });

  it("no em dashes, as the client asked", () => {
    expect(inserts.join("\n")).not.toMatch(/—/);
  });

  it("every journey starts off", () => {
    expect(seed).not.toMatch(/INSERT INTO email_journeys \([^)]*enabled_at/);
  });

  it("emails about features the app doesn't have are paused", () => {
    for (const l of inserts.filter((l) => /Creator Challenges/.test(l) && /CTA|Challenge\$j\$/.test(l))) {
      if (/Explore This Month's Challenge|Join This Month's Challenge/.test(l)) expect(l).toMatch(/\$j\$needs_feature\$j\$/);
    }
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
  it("admin routes are admin only", () => {
    const routes = read("server/routes.ts");
    for (const r of ["get(\"/api/admin/journeys\"", "put(\"/api/admin/journeys/:segment\"", "put(\"/api/admin/journey-steps/:id\"",
      "post(\"/api/admin/journey-steps/:id/preview\"", "put(\"/api/admin/journey-partners\""]) {
      expect(routes).toContain(`app.${r}, requireAdmin,`);
    }
  });
  it("every journey email carries one-click unsubscribe headers", () => {
    const mail = read("server/emailService.ts");
    expect(mail).toMatch(/"List-Unsubscribe": `<\$\{e\.unsubscribePostUrl\}>`/);
    expect(mail).toMatch(/"List-Unsubscribe-Post": "List-Unsubscribe=One-Click"/);
  });
  it("admins, unverified and unsubscribed people never get journey email", () => {
    expect(read("server/journeyStore.ts")).toMatch(/not coalesce\(u\.is_admin, false\) and u\.email_verified and u\.email_opt_out_at is null/);
  });
  it("the old day-2 brand email stands aside while the Brands journey is on", () => {
    expect(read("server/index.ts")).toMatch(/isJourneyOn\("brands"\)\) \? \[\]/);
  });
});

describe("plain first email and sender (23 Oct 2026)", () => {
  it("a sender name can't smuggle in an address, and reply-to must be an email", async () => {
    const { checkSender } = await import("../../server/journeys");
    expect(checkSender({ fromName: "Beth at MTRLZD", replyTo: "Beth@One30m.co" })).toEqual({ fromName: "Beth at MTRLZD", replyTo: "beth@one30m.co" });
    expect(checkSender({ fromName: "", replyTo: "" })).toEqual({ fromName: null, replyTo: null });
    expect(checkSender({ fromName: "Evil <x@y.com>" })).toHaveProperty("error");
    expect(checkSender({ replyTo: "not an email" })).toHaveProperty("error");
  });

  it("a plain email has no logo or layout, but still has the unsubscribe link", async () => {
    const { journeyEmailHtml } = await import("../../server/emailService");
    const e = { bodyHtml: "<p>Hi Ana,</p>", ctaLabel: null, ctaUrl: "", unsubscribeUrl: "https://www.mtrlzd.com/unsubscribe/t" };
    const plain = journeyEmailHtml({ ...e, plain: true });
    expect(plain).not.toMatch(/<img/);
    expect(plain).toContain("/unsubscribe/t");
    expect(journeyEmailHtml(e)).toMatch(/<img/);
  });

  it("replaces only first emails nobody has edited, and asks for a reply in all 7", () => {
    const m = readFileSync(join(__dirname, "../../migrations/0045_journey_sender_plain.sql"), "utf8");
    const updates = m.split("\n").filter((l) => l.startsWith("UPDATE email_journey_steps"));
    expect(updates.length).toBe(7);
    for (const u of m.split("UPDATE").slice(1)) {
      expect(u).toMatch(/AND position = 1 AND subject = \$j\$/);
      expect(u).toMatch(/plain = true/);
      expect(u).toMatch(/reply to this email/);
    }
    expect(m).not.toMatch(/—/);
  });

  it("journey emails carry the sender name and reply-to", () => {
    const mail = readFileSync(join(__dirname, "../../server/emailService.ts"), "utf8");
    expect(mail).toMatch(/from: `\$\{e\.fromName \|\| "MTRLZD"\} <\$\{FROM_ADDRESS\}>`/);
    expect(mail).toMatch(/\.\.\.\(e\.replyTo \? \{ replyTo: e\.replyTo \} : \{\}\)/);
    expect(readFileSync(join(__dirname, "../../server/routes.ts"), "utf8")).toMatch(/app\.put\("\/api\/admin\/journeys\/:segment\/sender", requireAdmin,/);
  });
});
