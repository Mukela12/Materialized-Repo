/**
 * What a brand's PR contact actually receives.
 *
 * Every line here is something the client asked for by name, and each one is
 * the kind of thing that silently regresses when the template is next edited:
 *
 *   "Can email pls use MTRLZD logo at the top of email layout for branding."
 *   'replace "by a creator" should use "by [Creator_Instagram_Handle]"'
 *   "include the Video link to preview the campaign"
 *   "Should mention the $29 campaign activation fee (one-time admin setup
 *    fee), which gives the Brand 30-days of licensing and the video can be
 *    embedded to their eCommerce"
 *   "Also mention, 'if you like how well in-video shopping works, ask us about
 *    our latest Offers…'"
 *
 * The transport is mocked; the real template and copy run.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

const sent: Array<{ to: string; subject: string; html: string }> = [];

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (m: any) => {
        sent.push({ to: m.to, subject: m.subject, html: m.html });
        return { data: { id: "stub" } };
      },
    };
  },
}));

let sendBrandOutreachEmail: any;

beforeAll(async () => {
  process.env.RESEND_API_KEY = "re_stub";
  process.env.RESEND_FROM_EMAIL = "noreply@mtrlzd.com";
  process.env.PUBLIC_ORIGIN = "https://www.mtrlzd.com";
  ({ sendBrandOutreachEmail } = await import("../../server/emailService"));
});

const base = {
  prContactName: "Amanda Moss",
  prContactEmail: "amanda@example.test",
  creatorDisplayName: "MTRLZD Editorial",
  brandName: "Maison Test",
  videoTitle: "Finding Frida",
  videoPreviewUrl: "https://www.mtrlzd.com/embed/abc123",
  authorizeUrl: "https://www.mtrlzd.com/brand-authorize/tok",
};

async function render(over: Record<string, any> = {}) {
  sent.length = 0;
  await sendBrandOutreachEmail({ ...base, ...over });
  return sent[0];
}

describe("the outreach email", () => {
  it("shows the MTRLZD logo, from a stable path", async () => {
    const m = await render({ creatorInstagramHandle: "bethanie.ash" });
    expect(m.html).toContain("/mtrlzd-logo.png");
    // Absolute: a relative src resolves against the mail client, not our site.
    expect(m.html).toMatch(/src="https:\/\/[^"]+\/mtrlzd-logo\.png"/);
    // alt text, for the many clients that block images by default.
    expect(m.html).toMatch(/alt="MTRLZD"/);
  });

  it("names the creator by their Instagram handle", async () => {
    const m = await render({ creatorInstagramHandle: "bethanie.ash" });
    expect(m.html).toContain("@bethanie.ash");
    expect(m.subject).toContain("@bethanie.ash");
  });

  it("falls back to the display name when no handle is set", async () => {
    // Most existing creators have none. "by @" would be worse than a name.
    const m = await render({ creatorInstagramHandle: null });
    expect(m.html).toContain("MTRLZD Editorial");
    expect(m.html).not.toMatch(/>@</);
  });

  it("links to the campaign preview", async () => {
    const m = await render({ creatorInstagramHandle: "x" });
    expect(m.html).toContain("https://www.mtrlzd.com/embed/abc123");
    expect(m.html).toContain("Preview the campaign");
  });

  it("states the fee, what it covers and for how long", async () => {
    const m = await render({ creatorInstagramHandle: "x" });
    expect(m.html).toContain("$29");
    expect(m.html).toMatch(/30 days of licensing/i);
    expect(m.html).toMatch(/embedded on your own eCommerce/i);
  });

  it("carries the offers line", async () => {
    const m = await render({ creatorInstagramHandle: "x" });
    expect(m.html).toMatch(/latest Offers for/i);
    expect(m.html).toMatch(/Influencer Content/i);
  });

  it("cannot be turned into markup by a hostile handle", async () => {
    const m = await render({ creatorInstagramHandle: '"><script>alert(1)</script>' });
    expect(m.html).not.toContain("<script>alert(1)</script>");
    expect(m.subject).not.toContain("<");
  });
});
