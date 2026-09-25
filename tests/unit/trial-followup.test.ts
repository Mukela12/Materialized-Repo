/**
 * The day-2 nurture email: once, 48 hours in, brands on a real trial only.
 */
import { describe, it, expect } from "vitest";
import { makeTrialFollowupJob } from "../../server/scheduledJobs";

const NOW = new Date("2026-10-10T12:15:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function harness(opts: { due?: any[]; mailFails?: boolean } = {}) {
  const sent: any[] = [];
  const marked: string[] = [];
  const store = {
    getBrandsDueTrialFollowup: async () => opts.due ?? [{
      id: "b1", email: "brand@x.com", displayName: "Maison Demo",
      freeAccessUntil: new Date(NOW.getTime() + 12 * 86_400_000),
    }],
    markTrialFollowupSent: async (id: string) => { marked.push(id); },
  };
  const mailer = {
    send: async (o: any) => {
      if (opts.mailFails) throw new Error("mailbox full");
      sent.push(o);
    },
  };
  const job = makeTrialFollowupJob(store as any, mailer, { now: () => NOW, dashboardUrl: "https://x/brand" });
  return { job, sent, marked };
}

describe("the hourly nurture job", () => {
  it("emails a due brand once and marks it", async () => {
    const h = harness();
    const r = await h.job.run();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toBe("brand@x.com");
    expect(h.sent[0].trialDaysLeft).toBe(12);
    expect(h.marked).toEqual(["b1"]);
    expect(r.status).toBe("success");
  });

  it("a failed send is NOT marked — the next run retries it", async () => {
    const h = harness({ mailFails: true });
    const r = await h.job.run();
    expect(h.marked).toHaveLength(0);
    expect(r.status).toBe("failed");
    expect(r.detail).toContain("mailbox full");
  });

  it("nothing due: quiet skip", async () => {
    const h = harness({ due: [] });
    expect((await h.job.run()).status).toBe("skipped");
  });
});

describe("who counts as due, against real storage", () => {
  async function seedBrand(st: any, over: Record<string, any> = {}) {
    const u = await st.createUser({
      username: "b" + Math.random(), email: `b${Math.random()}@x.com`,
      password: "x", role: "brand", ...over,
    });
    await st.updateUser(u.id, {
      freeAccess: true,
      freeAccessUntil: new Date(NOW.getTime() + 12 * 86_400_000),
      createdAt: hoursAgo(50),
      ...over,
    });
    return u;
  }

  it("a 50-hour-old trial brand is due; a 20-hour-old one is not yet", async () => {
    const { MemStorage } = await import("../../server/storage");
    const st: any = new MemStorage();
    const seeded = (await st.getBrandsDueTrialFollowup(NOW)).length; // demo data baseline
    const due = await seedBrand(st);
    await seedBrand(st, { createdAt: hoursAgo(20) });
    const rows = await st.getBrandsDueTrialFollowup(NOW);
    expect(rows.length - seeded).toBe(1);
    expect(rows.some((r: any) => r.id === due.id)).toBe(true);
  });

  it("already-emailed and months-old accounts are never due again", async () => {
    const { MemStorage } = await import("../../server/storage");
    const st: any = new MemStorage();
    const baseline = (await st.getBrandsDueTrialFollowup(NOW)).length;
    await seedBrand(st, { trialFollowupEmailSentAt: hoursAgo(1) });
    await seedBrand(st, { createdAt: hoursAgo(24 * 60) }); // 60 days old
    expect((await st.getBrandsDueTrialFollowup(NOW)).length).toBe(baseline);
  });
});

describe("the email itself", () => {
  it("carries the client's brief: affiliate program, five creators, days-left honesty", async () => {
    const { renderTrialFollowupEmailHtml } = await import("../../server/emailService");
    const html = renderTrialFollowupEmailHtml({
      to: "b@x.com", brandDisplayName: "Maison Demo", trialDaysLeft: 12,
      dashboardUrl: "https://www.mtrlzd.com/brand",
    });
    expect(html).toContain("affiliate program");
    expect(html).toContain("five content creators");
    expect(html).toContain("12 days to go");
    expect(html).toContain("Invite Your Creators");
    // The copy must never hard-code a trial length the account may not have.
    expect(html).not.toContain("28 days");
  });
});
