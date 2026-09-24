/**
 * The certificate watch: the client's marketing agency told her about a
 * certificate problem before anyone on the inside knew anything. Whether or
 * not their report was accurate, that it COULD have been true without an
 * alarm is the defect this job removes.
 */
import { describe, it, expect } from "vitest";
import { makeCertWatchJob, CERT_ALERT_DAYS } from "../../server/scheduledJobs";

function harness(world: Record<string, number | Error>) {
  const alerts: Array<{ subject: string; lines: string[] }> = [];
  const probe = async (host: string) => {
    const v = world[host];
    if (v instanceof Error) throw v;
    return { daysLeft: v as number };
  };
  const job = makeCertWatchJob(probe, {
    sendAlert: async (subject, lines) => { alerts.push({ subject, lines }); },
  }, { hosts: Object.keys(world) });
  return { job, alerts };
}

describe("the daily certificate watch", () => {
  it("healthy certificates: quiet success naming the nearest expiry", async () => {
    const h = harness({ "a.com": 60, "b.com": 33 });
    const r = await h.job.run();
    expect(r.status).toBe("success");
    expect(h.alerts).toHaveLength(0);
    expect(r.detail).toContain("nearest expiry 33");
  });

  it("an expiring certificate alerts BEFORE it expires, and the run reads failed", async () => {
    const h = harness({ "a.com": 60, "b.com": CERT_ALERT_DAYS - 1 });
    const r = await h.job.run();
    expect(r.status).toBe("failed");
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].lines.join(" ")).toContain("b.com");
    expect(h.alerts[0].lines.join(" ")).toContain(String(CERT_ALERT_DAYS - 1));
  });

  it("a certificate exactly at the threshold does not alert; one day inside does", async () => {
    expect((await harness({ "a.com": CERT_ALERT_DAYS }).job.run()).status).toBe("success");
    expect((await harness({ "a.com": CERT_ALERT_DAYS - 1 }).job.run()).status).toBe("failed");
  });

  it("an unreachable or invalid host alerts with the reason", async () => {
    const h = harness({ "a.com": 60, "b.com": new Error("certificate has expired") });
    const r = await h.job.run();
    expect(r.status).toBe("failed");
    expect(h.alerts[0].lines.join(" ")).toContain("certificate has expired");
  });

  it("several problems arrive as ONE email, not an inbox flood", async () => {
    const h = harness({ "a.com": 2, "b.com": new Error("refused"), "c.com": 90 });
    const r = await h.job.run();
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].lines).toHaveLength(2);
    expect(r.items).toBe(3);
  });
});
