/**
 * Admin CRM and partner inactivity (client, 22 Nov 2026): flag a partner after
 * 30 days with no activity, switch their partner status off after 60, and show
 * every account's status and free trial in one admin table.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PARTNER_DEACTIVATE_DAYS, PARTNER_INACTIVE_DAYS, conversionPct, crmStatus, crmType, daysSince, firstName,
  partnerIsDue, partnerState, trialProgress,
} from "../../shared/crm";

const DAY = 86_400_000;
const now = new Date("2026-11-23T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

describe("partner inactivity", () => {
  it("uses the client's numbers: flag at 30 days, off at 60", () => {
    expect(PARTNER_INACTIVE_DAYS).toBe(30);
    expect(PARTNER_DEACTIVATE_DAYS).toBe(60);
  });

  it("is active until 30 whole days have passed with nothing happening", () => {
    expect(partnerState(ago(0), null, now)).toBe("active");
    expect(partnerState(ago(29.9), null, now)).toBe("active");
    expect(partnerState(ago(30), null, now)).toBe("inactive");
    expect(partnerState(ago(59), null, now)).toBe("inactive");
  });

  it("is off once the status was switched off, however recent the activity", () => {
    expect(partnerState(ago(1), ago(2), now)).toBe("off");
  });

  it("is due to be switched off at 60 days, once", () => {
    expect(partnerIsDue(ago(59.9), null, now)).toBe(false);
    expect(partnerIsDue(ago(60), null, now)).toBe(true);
    expect(partnerIsDue(ago(90), ago(5), now)).toBe(false);
  });

  it("the job switches off only partners past 60 days who are still on", () => {
    const src = read("server/crm.ts");
    const sweep = src.slice(src.indexOf("export async function sweepPartnerInactivity"), src.indexOf("export async function setPartnerActive"));
    expect(sweep).toContain("PARTNER_DEACTIVATE_DAYS * 86_400_000");
    expect(sweep).toMatch(/ps\.deactivated_at is null and act\.last_activity < \$\{cutoff\}/);
  });

  it("counts the partner's own use, new joiners, their accounts' uploads and their sales as activity", () => {
    const src = read("server/crm.ts");
    const act = src.slice(src.indexOf("export function partnerActivitySql"), src.indexOf("export async function sweepPartnerInactivity"));
    for (const part of ["u.last_seen_at", "max(r.joined_at)", "max(v.created_at)", "c.kind = 'partner'", "ps.reactivated_at"]) expect(act).toContain(part);
  });

  it("switching a partner back on restarts the count", () => {
    const src = read("server/crm.ts");
    expect(src).toMatch(/set deactivated_at = null, reactivated_at = \$\{now\}/);
  });

  it("runs every day and emails nobody", () => {
    const index = read("server/index.ts");
    const job = index.slice(index.indexOf('name: "partner-inactivity"'), index.indexOf('name: "snapshot-report"'));
    expect(job).toContain('"30 3 * * *"');
    expect(job).toContain("sweepPartnerInactivity");
    expect(job).not.toMatch(/send|email/i);
  });
});

describe("account status", () => {
  it("is Archived when admin archived it, whatever else is true", () => {
    expect(crmStatus({ archivedAt: ago(1), lastUsedAt: ago(0), partner: "active" }, now)).toBe("archived");
  });
  it("is Inactive after 30 days without use", () => {
    expect(crmStatus({ archivedAt: null, lastUsedAt: ago(29), partner: null }, now)).toBe("active");
    expect(crmStatus({ archivedAt: null, lastUsedAt: ago(30), partner: null }, now)).toBe("inactive");
  });
  it("follows the partner rule for a partner, not their own last sign-in", () => {
    expect(crmStatus({ archivedAt: null, lastUsedAt: ago(45), partner: "active" }, now)).toBe("active");
    expect(crmStatus({ archivedAt: null, lastUsedAt: ago(1), partner: "inactive" }, now)).toBe("inactive");
    expect(crmStatus({ archivedAt: null, lastUsedAt: ago(1), partner: "off" }, now)).toBe("inactive");
  });
});

describe("type, name and sales performance", () => {
  it("shows a partner as a partner whatever account they joined with", () => {
    expect(crmType("brand", true)).toBe("partner");
    expect(crmType("brand", false)).toBe("brand");
    expect(crmType("affiliate", false)).toBe("publisher");
    expect(crmType("creator", false)).toBe("creator");
    expect(crmType(null, false)).toBe("creator");
  });
  it("takes the first name, or the start of the email with no name", () => {
    expect(firstName("Johnny Love")).toBe("Johnny");
    expect(firstName("  ", "trevor@example.com")).toBe("trevor");
    expect(firstName(null, null)).toBe("");
  });
  it("is sales per 100 views, and nothing with no views", () => {
    expect(conversionPct(3, 200)).toBe(1.5);
    expect(conversionPct(1, 3)).toBe(33.3);
    expect(conversionPct(0, 500)).toBe(0);
    expect(conversionPct(2, 0)).toBeNull();
  });
  it("counts whole days", () => {
    expect(daysSince(ago(2.5), now)).toBe(2);
    expect(daysSince(null, now)).toBeNull();
  });
});

describe("free trial bar", () => {
  it("has no bar for an account that never had a free period", () => {
    expect(trialProgress({ freeAccess: false, start: ago(10), end: null }, now).state).toBe("none");
  });
  it("is open for free access with no end date", () => {
    expect(trialProgress({ freeAccess: true, start: ago(10), end: null }, now).state).toBe("open");
  });
  it("runs green part way through a 30 day trial", () => {
    const t = trialProgress({ freeAccess: true, start: ago(12), end: new Date(now.getTime() + 18 * DAY) }, now);
    expect(t).toMatchObject({ state: "running", pct: 40, days: 30, daysLeft: 18 });
  });
  it("is ended, full, once the 30 days are over", () => {
    const t = trialProgress({ freeAccess: true, start: ago(40), end: ago(10) }, now);
    expect(t).toMatchObject({ state: "ended", pct: 100, daysLeft: 0 });
  });
  it("never shows a running trial as full or with no days left", () => {
    const t = trialProgress({ freeAccess: true, start: ago(29.99), end: new Date(now.getTime() + 60_000) }, now);
    expect(t.state).toBe("running");
    expect(t.pct).toBeLessThan(100);
    expect(t.daysLeft).toBe(1);
  });
});

describe("the admin routes and the fields only admin can write", () => {
  const routes = read("server/routes.ts");
  it("are admin only", () => {
    expect(routes).toContain('app.get("/api/admin/crm", requireAdmin,');
    expect(routes).toContain('app.patch("/api/admin/crm/:userId", requireAdmin,');
    expect(routes).toContain('app.post("/api/admin/crm/:userId/partner-status", requireAdmin,');
  });
  it("keep the notes, company and archive columns out of the schema user routes write through", () => {
    const schema = read("shared/schema.ts");
    const table = (decl: string) => {
      const at = schema.indexOf(decl);
      expect(at).toBeGreaterThan(-1);
      return schema.slice(at, schema.indexOf("\nexport ", at + decl.length));
    };
    const users = table('export const users = pgTable("users"');
    for (const col of ["crm_notes", "crm_company", "archived_at"]) expect(users).not.toContain(col);
    const senders = table('export const programSenders = pgTable("program_senders"');
    for (const col of ["deactivated_at", "reactivated_at"]) expect(senders).not.toContain(col);
  });
  it("never list or change the team's own admin accounts", () => {
    const src = read("server/crm.ts");
    expect(src).toMatch(/from users u where not coalesce\(u\.is_admin, false\)/);
    expect(src).toMatch(/where id = \$\{userId\} and not coalesce\(is_admin, false\)/);
  });
});

describe("what partners see", () => {
  it("a Partner badge beside their account type, in its own colour", () => {
    const pill = read("client/src/components/RolePill.tsx");
    expect(pill).toContain('partner: { label: "Partner", dot: "text-violet-500" }');
    expect(pill).toContain('testId="badge-partner"');
  });
  it("partner payouts on all three homepages", () => {
    for (const p of ["dashboard", "brand-dashboard", "affiliate-dashboard"]) expect(read(`client/src/pages/${p}.tsx`)).toContain("<PartnerPayouts role=");
  });
});
