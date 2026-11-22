/**
 * Admin CRM and partner inactivity (client, 22 Nov 2026). The rules, with no
 * database in them so they can be tested; server/crm.ts supplies the facts.
 *
 * PARTNER INACTIVITY. A partner is active while anything is happening: they
 * use their own account, someone joins with their code or invite, one of the
 * accounts they brought in uploads a video, or they earn on a sale. After 30
 * days with none of that they are flagged Inactive, so admin can follow up.
 * After 60 their partner status is switched off: new sales stop earning them
 * a share until admin switches it back on. No email is sent to the partner.
 *
 * ACCOUNT STATUS, for every account: Archived when admin archived it;
 * otherwise Inactive when the account has not been used for 30 days (a
 * partner: flagged or switched off as above); otherwise Active.
 */

export const PARTNER_INACTIVE_DAYS = 30;
export const PARTNER_DEACTIVATE_DAYS = 60;
const DAY = 86_400_000;

export type CrmType = "partner" | "creator" | "brand" | "publisher";
export type CrmStatus = "active" | "inactive" | "archived";
export type PartnerState = "active" | "inactive" | "off";

const at = (d: Date | string | null | undefined): number | null => {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
};

/** Whole days from `since` to `now`, never negative. */
export function daysSince(since: Date | string | null | undefined, now: Date): number | null {
  const t = at(since);
  return t == null ? null : Math.max(0, Math.floor((now.getTime() - t) / DAY));
}

/** A partner's state from their last activity and whether their status was switched off. */
export function partnerState(lastActivity: Date | string | null, deactivatedAt: Date | string | null, now: Date): PartnerState {
  if (deactivatedAt) return "off";
  const d = daysSince(lastActivity, now);
  return d != null && d >= PARTNER_INACTIVE_DAYS ? "inactive" : "active";
}

/** Whether the daily job should switch this partner's status off now. */
export function partnerIsDue(lastActivity: Date | string | null, deactivatedAt: Date | string | null, now: Date): boolean {
  if (deactivatedAt) return false;
  const d = daysSince(lastActivity, now);
  return d != null && d >= PARTNER_DEACTIVATE_DAYS;
}

export function crmStatus(a: {
  archivedAt: Date | string | null; lastUsedAt: Date | string | null; partner: PartnerState | null;
}, now: Date): CrmStatus {
  if (a.archivedAt) return "archived";
  if (a.partner) return a.partner === "active" ? "active" : "inactive";
  const d = daysSince(a.lastUsedAt, now);
  return d != null && d >= PARTNER_INACTIVE_DAYS ? "inactive" : "active";
}

/** The account type the CRM shows: a partner is a partner whatever account type they joined as. */
export function crmType(role: string | null | undefined, isPartner: boolean): CrmType {
  if (isPartner) return "partner";
  if (role === "brand") return "brand";
  if (role === "affiliate") return "publisher";
  return "creator";
}

export function firstName(displayName: string | null | undefined, email?: string | null): string {
  const n = (displayName ?? "").trim().split(/\s+/)[0];
  if (n) return n;
  return (email ?? "").split("@")[0] || "";
}

export interface TrialProgress {
  /** none: never had a free period. open: free with no end date. running or ended otherwise. */
  state: "none" | "open" | "running" | "ended";
  /** 0 to 100, how much of the free period has gone. */
  pct: number;
  days: number;
  daysLeft: number;
  endsAt: string | null;
}

/** The free period as a bar: from when it started to when it ends. */
export function trialProgress(t: { freeAccess: boolean; start: Date | string | null; end: Date | string | null }, now: Date): TrialProgress {
  const end = at(t.end);
  if (end == null) return { state: t.freeAccess ? "open" : "none", pct: 0, days: 0, daysLeft: 0, endsAt: null };
  const start = Math.min(at(t.start) ?? end - 30 * DAY, end);
  const days = Math.max(1, Math.round((end - start) / DAY));
  const endsAt = new Date(end).toISOString();
  if (now.getTime() >= end) return { state: "ended", pct: 100, days, daysLeft: 0, endsAt };
  const pct = Math.min(99, Math.max(0, Math.round(((now.getTime() - start) / (end - start)) * 100)));
  return { state: "running", pct, days, daysLeft: Math.max(1, Math.ceil((end - now.getTime()) / DAY)), endsAt };
}

/** Sales per 100 views, to one decimal. Null when there are no views to measure against. */
export function conversionPct(sales: number, views: number): number | null {
  if (!(views > 0)) return null;
  return Math.round((sales / views) * 1000) / 10;
}

export interface CrmRow {
  id: string;
  type: CrmType;
  /** The account type they signed up as: creator, brand or publisher. */
  accountType: Exclude<CrmType, "partner">;
  firstName: string;
  name: string;
  email: string;
  company: string;
  status: CrmStatus;
  notes: string;
  createdAt: string;
  lastUsedAt: string | null;
  trial: TrialProgress;
  videos: number;
  views: number;
  sales: number;
  /** Sales per 100 views; null with no views. */
  conversionPct: number | null;
  grossCents: number;
  /** Set for partners only. */
  partner: null | {
    state: PartnerState;
    pct: number | null;
    lastActivityAt: string | null;
    daysQuiet: number | null;
    referrals: number;
    deactivatedAt: string | null;
  };
}

export interface CrmReport {
  currency: "usd";
  rows: CrmRow[];
  rules: { inactiveDays: number; deactivateDays: number };
}
