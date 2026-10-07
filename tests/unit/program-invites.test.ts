/**
 * Program invites (7 Oct 2026): a producer invites its designers and
 * influencers from the app, one message mail-merged, each with their own code.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  seatTypeOf, mergeFields, escapeHtml, messageToHtml, checkRecipient, templateProblem,
  inviteVoucherFromTemplate, programBatchId, offerLine, type TemplateVoucher,
} from "../../server/programInvites";

const code = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const tpl = (o: Partial<TemplateVoucher> = {}): TemplateVoucher => ({
  id: "t1", code: "BKLN-DESIGN", grantType: "free_access", roleRestriction: "brand", activeFrom: null,
  expiresAt: new Date("2026-11-01T05:00:00Z"), freeDays: null, creatorPasses: 10, partner: "Fashion Week Brooklyn", revokedAt: null, ...o,
});

describe("reading a CSV's type column", () => {
  it("knows the words people use", () => {
    for (const w of ["designer", "Designers", "brand", "LABEL"]) expect(seatTypeOf(w), w).toBe("brand");
    for (const w of ["influencer", "Creator", "talent", "models"]) expect(seatTypeOf(w), w).toBe("creator");
    for (const w of ["", "press", "buyer", undefined]) expect(seatTypeOf(w as any)).toBeNull();
  });
});

describe("the message", () => {
  it("fills {first_name} and {name}, and leaves other braces alone", () => {
    expect(mergeFields("Hi {first_name}, welcome {name}! {code}", { name: "Ava Laurent" })).toBe("Hi Ava, welcome Ava Laurent! {code}");
    expect(mergeFields("Hi { First_Name }", { name: "Jordan" })).toBe("Hi Jordan");
  });

  it("can't carry markup: everything typed is escaped, paragraphs kept", () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
    const html = messageToHtml("Hi <b>Ava</b>,\n\nLine one\nline two");
    expect(html).toBe("<p>Hi &lt;b&gt;Ava&lt;/b&gt;,</p><p>Line one<br>line two</p>");
  });
});

describe("each person", () => {
  it("needs a real email and a type; a missing name comes from the email", () => {
    expect(checkRecipient({ email: "nope", type: "designer" })).toMatchObject({ ok: false, error: "Email doesn't look right" });
    expect(checkRecipient({ email: "a@b.co", type: "" })).toMatchObject({ ok: false, error: "Choose designer or influencer" });
    expect(checkRecipient({ email: " Ava@Studio.COM ", type: "Designer" })).toEqual({ ok: true, recipient: { name: "ava", email: "ava@studio.com", type: "brand" } });
  });
});

describe("the code each invite carries", () => {
  it("copies the template's terms, single-use, for that person", () => {
    const v = inviteVoucherFromTemplate({
      code: "ABCD-1234", template: tpl(), type: "brand",
      recipient: { name: "Ava Laurent", email: "ava@studio.com", type: "brand" },
      sender: { id: "u1", name: "FWB Producer" }, programName: "Fashion Week Brooklyn",
    });
    expect(v).toMatchObject({
      code: "ABCD-1234", grantType: "free_access", roleRestriction: "brand", maxRedemptions: 1,
      expiresAt: new Date("2026-11-01T05:00:00Z"), creatorPasses: 10, partner: "Fashion Week Brooklyn",
      assignedTo: "ava@studio.com", createdBy: "u1", batchId: programBatchId("u1", "brand"),
    });
  });

  it("an influencer seat never carries creator passes", () => {
    const v = inviteVoucherFromTemplate({
      code: "X", template: tpl({ roleRestriction: "creator" }), type: "creator",
      recipient: { name: "J", email: "j@x.co", type: "creator" }, sender: { id: "u1", name: "P" }, programName: "P",
    });
    expect(v.creatorPasses).toBeNull();
    expect(v.roleRestriction).toBe("creator");
  });

  it("refuses a template that's missing, withdrawn, over, or for the other seat", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    expect(templateProblem(null, "brand", now)).toMatch(/aren't set up/);
    expect(templateProblem(tpl({ revokedAt: now }), "brand", now)).toMatch(/withdrawn/);
    expect(templateProblem(tpl({ expiresAt: new Date("2026-10-01T05:00:00Z") }), "brand", now)).toMatch(/ended/);
    expect(templateProblem(tpl(), "creator", now)).toMatch(/another kind of account/);
    expect(templateProblem(tpl(), "brand", now)).toBeNull();
    expect(templateProblem(tpl({ roleRestriction: null }), "creator", now)).toBeNull();
  });

  it("says what it gives in plain words", () => {
    expect(offerLine(tpl(), "brand")).toBe("Free access until October 31.");
    expect(offerLine(tpl({ grantType: "waive_setup_fee" }), "brand")).toBe("Your setup fee is waived.");
    expect(offerLine(tpl({ expiresAt: null, freeDays: 30 }), "creator")).toBe("30 days of free access.");
  });
});

describe("the routes", () => {
  const routes = code("server/routes.ts");
  const at = (p: string) => routes.slice(routes.indexOf(p), routes.indexOf("\n  app.", routes.indexOf(p) + 10));

  it("only signed-in accounts an admin switched on can preview or send", () => {
    for (const p of ['app.post("/api/program/preview"', 'app.post("/api/program/invites"']) {
      const body = at(p);
      expect(body, p).toMatch(/if \(!userId\) return res\.status\(401\)/);
      expect(body, p).toMatch(/status\(403\)\.json\(\{ error: "Program invites aren't switched on|status: 403, body: \{ error: "Program invites aren't switched on/);
    }
  });

  it("sends are one at a time per account, never over the allowance, never twice to one person", () => {
    const body = at('app.post("/api/program/invites"');
    expect(body).toMatch(/withProgramLock\(userId,/);
    expect(body).toMatch(/if \(left\[r\.type\] <= 0\)/);
    expect(body).toMatch(/if \(already\.has\(r\.email\)\)/);
    expect(body).toMatch(/if \(seen\.has\(r\.email\)\)/);
  });

  it("an email that didn't send gives its code back", () => {
    const body = at('app.post("/api/program/invites"');
    expect(body).toMatch(/await S\.releaseUnsent\(toSend\.filter\(\(_, i\) => failed\.has\(i\)\)/);
  });

  it("replies go to the sender, and links carry the code and the right role", () => {
    const body = at('app.post("/api/program/invites"');
    expect(body).toMatch(/replyTo: ctx\.user\?\.email \?\? null/);
    expect(routes).toMatch(/`\$\{publicOrigin\(req\)\}\/register\?code=\$\{encodeURIComponent\(code\)\}&role=\$\{type\}`/);
  });

  it("the admin routes are admin-only", () => {
    for (const p of ['app.get("/api/admin/program-senders", requireAdmin', 'app.put("/api/admin/program-senders", requireAdmin', 'app.delete("/api/admin/program-senders/:userId", requireAdmin']) {
      expect(routes).toContain(p);
    }
  });
});

describe("the emails", () => {
  const email = code("server/emailService.ts");
  it("go out in batches of 100 through Resend", () => {
    expect(email).toMatch(/for \(let i = 0; i < emails\.length; i \+= 100\)/);
    expect(email).toMatch(/client\(\)\.batch\.send\(/);
  });

  it("the brand invite escapes what people typed (it was raw HTML) and merges {first_name}", () => {
    const fn = email.slice(email.indexOf("export async function sendCreatorInvitationEmail"), email.indexOf("export interface ProgramInviteEmail"));
    expect(fn).toMatch(/escapeHtml\(mergeFields\(opts\.message, \{ name: opts\.creatorName \}\)\)/);
    expect(fn).toMatch(/const brandName = escapeHtml\(opts\.brandName\)/);
    expect(fn).not.toMatch(/"\$\{opts\.message\}"/);
  });
});

describe("who joined", () => {
  it("the sub-queries name the voucher column in full (Drizzle writes ${vouchers.id} as a bare id there)", () => {
    const src = code("server/programSenders.ts");
    expect(src).not.toMatch(/r\.voucher_id = \$\{vouchers\.id\}/);
    expect((src.match(/r\.voucher_id = "vouchers"\."id"/g) ?? []).length).toBe(2);
  });
});
