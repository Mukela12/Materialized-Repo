/**
 * Invite campaigns: the rules, with no database and no mail client. The store
 * is server/inviteCampaignStore.ts.
 *
 * The client, 3 Nov 2026: a list of about 800 creators and brands who have no
 * MTRLZD account. "If it's possible to drip send by like, 50 at a time... I've
 * just been having calls this last week with email marketing platforms and
 * understanding that when brands go and send out hundreds of emails, they're
 * spammed." Email journeys only write to accounts, so this is the step before:
 * each person gets one email with their own free pass, a set number a day,
 * spread over the working day, with an unsubscribe link. Whoever signs up with
 * the pass is an account like any other and joins their journey from there.
 */
import { escapeHtml } from "./programInvites";
import { bodyToHtml, bodyToText, merge } from "./journeys";
import { voucherInstantToDay } from "../shared/voucherDates";

export type ContactType = "creator" | "brand";
export const CONTACT_TYPES: readonly ContactType[] = ["creator", "brand"];

/** Words people put in a "type" column, to the account they mean. */
export function contactTypeOf(raw: string | null | undefined): ContactType | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (/^(creators?|influencers?|talent|models?|content creators?|ugc)$/.test(v)) return "creator";
  if (/^(brands?|designers?|labels?|houses?|retailers?|stores?|shops?)$/.test(v)) return "brand";
  return null;
}

export const TYPE_WORD: Record<ContactType, string> = { creator: "creator", brand: "brand" };
export const PASS_NAME: Record<ContactType, string> = { creator: "Creator Pass", brand: "Brand Pass" };

const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
export const MAX_CONTACTS_PER_UPLOAD = 5000;

export interface ContactIn { name?: unknown; email?: unknown; type?: unknown; company?: unknown }
export interface Contact { name: string; email: string; type: ContactType; company: string | null }
export type ContactCheck = { ok: true; contact: Contact } | { ok: false; email: string; error: string };

/** One row of the list, checked. A row without a type takes the upload's default. */
export function checkContact(r: ContactIn, defaultType: ContactType | null): ContactCheck {
  const email = String(r.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, email, error: "Email doesn't look right" };
  const rawType = String(r.type ?? "").trim();
  const type = rawType ? contactTypeOf(rawType) : defaultType;
  if (!type) return { ok: false, email, error: rawType ? `"${rawType.slice(0, 30)}" isn't creator or brand` : "No type: creator or brand" };
  const name = String(r.name ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const company = String(r.company ?? "").trim().replace(/\s+/g, " ").slice(0, 120) || null;
  return { ok: true, contact: { name, email, type, company } };
}

// ── Pacing ───────────────────────────────────────────────────────────────────

/**
 * Sending hours, UTC: 14:00 to 21:59, which is 9am to 5pm in New York in
 * winter (10 to 6 in summer). The job runs at the top of each hour and sends
 * a share of the day's number, so 50 a day goes out as about 6 or 7 an hour
 * rather than 50 at once, which is how a person's mail looks to a filter.
 */
export const SEND_WINDOW_UTC = { from: 14, to: 22 } as const;
export const MAX_DAILY_LIMIT = 200;

/** How many to send on this run: what's left of today's number, over the runs left today. */
export function shareThisRun(now: Date, dailyLimit: number, sentToday: number): number {
  const h = now.getUTCHours();
  if (h < SEND_WINDOW_UTC.from || h >= SEND_WINDOW_UTC.to) return 0;
  const left = Math.max(0, dailyLimit - sentToday);
  const runsLeft = SEND_WINDOW_UTC.to - h;
  return Math.ceil(left / runsLeft);
}

/** Midnight UTC at the start of `now`'s day: "today" for the daily number. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** When the next run that can send happens, for the admin's "next send" line. */
export function nextSendAt(now: Date, dailyLimit: number, sentToday: number): Date {
  const h = now.getUTCHours();
  const nextHour = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h + 1));
  if (sentToday < dailyLimit && h + 1 < SEND_WINDOW_UTC.to && h + 1 >= SEND_WINDOW_UTC.from) return nextHour;
  if (sentToday < dailyLimit && h + 1 < SEND_WINDOW_UTC.from) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SEND_WINDOW_UTC.from));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, SEND_WINDOW_UTC.from));
}

/** Sending days left for this many people at this many a day. */
export function daysToFinish(waiting: number, dailyLimit: number): number {
  return dailyLimit > 0 ? Math.ceil(waiting / dailyLimit) : 0;
}

// ── The campaign's settings ──────────────────────────────────────────────────

export interface CampaignSettings {
  name: string;
  fromName: string | null;
  replyTo: string | null;
  creatorSubject: string; creatorBody: string;
  brandSubject: string; brandBody: string;
  ctaLabel: string;
  creatorFreeDays: number; brandFreeDays: number;
  /** A pass has to be used within this many days of its email. */
  useWithinDays: number;
  dailyLimit: number;
  /** The postal address the law asks commercial email to carry (CAN-SPAM). */
  postalAddress: string | null;
}

export const DEFAULTS: CampaignSettings = {
  name: "MTRLZD invites",
  fromName: "MTRLZD",
  replyTo: null,
  creatorSubject: "{{FirstName}}, a free Creator Pass for MTRLZD",
  creatorBody: `Hi {{FirstName}},

MTRLZD turns your videos into shoppable experiences: the people watching can buy what they see right inside the video, and you earn on the sales.

We'd love you to try it, so here's a free Creator Pass with your name on it.`,
  brandSubject: "A free Brand Pass for {{CompanyName}} on MTRLZD",
  brandBody: `Hi {{FirstName}},

MTRLZD turns creator videos, runway shows and campaigns into shoppable experiences, so viewers can buy your products right inside the video.

We'd love {{CompanyName}} to try it, so here's a free Brand Pass.`,
  ctaLabel: "Claim my free pass",
  creatorFreeDays: 30,
  brandFreeDays: 30,
  useWithinDays: 30,
  dailyLimit: 50,
  postalAddress: null,
};

/** Merge fields a campaign email may use; anything else in double braces is a typo. */
export function unknownCampaignFields(text: string): string[] {
  return Array.from(text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g), (m) => m[1])
    .filter((f) => !/^(FirstName|CompanyName)$/i.test(f));
}

const int = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);

/** What an admin may change, checked. */
export function checkSettings(b: Record<string, unknown>): { error: string } | CampaignSettings {
  const text = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  const name = text("name");
  if (!name || name.length > 80) return { error: "Give the campaign a name, up to 80 characters." };
  if (/[:]/.test(name)) return { error: "The name can't contain a colon." };
  const fromName = text("fromName");
  if (fromName.length > 60 || /[<>"\r\n@]/.test(fromName)) return { error: "The sender name can't be longer than 60 characters or contain < > \" or @." };
  const replyTo = text("replyTo").toLowerCase();
  if (replyTo && (replyTo.length > 200 || !EMAIL.test(replyTo))) return { error: "That reply-to address doesn't look like an email address." };
  const out: CampaignSettings = {
    name, fromName: fromName || null, replyTo: replyTo || null,
    creatorSubject: text("creatorSubject"), creatorBody: text("creatorBody"),
    brandSubject: text("brandSubject"), brandBody: text("brandBody"),
    ctaLabel: text("ctaLabel") || DEFAULTS.ctaLabel,
    creatorFreeDays: int(b.creatorFreeDays), brandFreeDays: int(b.brandFreeDays),
    useWithinDays: int(b.useWithinDays), dailyLimit: int(b.dailyLimit),
    postalAddress: text("postalAddress").replace(/\s*\n\s*/g, ", ") || null,
  };
  for (const [who, subject, body] of [["creator", out.creatorSubject, out.creatorBody], ["brand", out.brandSubject, out.brandBody]] as const) {
    if (!subject || subject.length > 150) return { error: `The ${who} subject needs to be between 1 and 150 characters.` };
    if (!body || body.length > 3000) return { error: `The ${who} message needs to be between 1 and 3,000 characters.` };
    const bad = unknownCampaignFields(`${subject}\n${body}`);
    if (bad.length) return { error: `Unknown merge field {{${bad[0]}}}. Use {{FirstName}} or {{CompanyName}}.` };
  }
  if (out.ctaLabel.length > 40) return { error: "Keep the button text under 40 characters." };
  for (const [label, v] of [["Creator free days", out.creatorFreeDays], ["Brand free days", out.brandFreeDays]] as const) {
    if (!Number.isInteger(v) || v < 1 || v > 365) return { error: `${label} needs to be a whole number from 1 to 365.` };
  }
  if (!Number.isInteger(out.useWithinDays) || out.useWithinDays < 1 || out.useWithinDays > 365) return { error: "\"Use within\" needs to be a whole number of days from 1 to 365." };
  if (!Number.isInteger(out.dailyLimit) || out.dailyLimit < 1 || out.dailyLimit > MAX_DAILY_LIMIT) return { error: `The daily number needs to be from 1 to ${MAX_DAILY_LIMIT}.` };
  if (out.postalAddress && out.postalAddress.length > 200) return { error: "Keep the postal address under 200 characters." };
  return out;
}

/** Why a campaign can't start yet, or null when it can. */
export function startProblem(s: Pick<CampaignSettings, "postalAddress">, waiting: number): string | null {
  if (waiting === 0) return "Upload the list first: there's no one waiting to be invited.";
  if (!s.postalAddress) return "Add the postal address for the foot of the email. Commercial email has to show one.";
  return null;
}

// ── The email ────────────────────────────────────────────────────────────────

export interface InviteEmailInput {
  settings: CampaignSettings;
  contact: Contact;
  code: string;
  /** When the pass stops working (the voucher's expires_at). */
  useBy: Date;
  origin: string;
  unsubscribeUrl: string;
}

export interface RenderedInvite { subject: string; html: string; text: string; signupUrl: string }

/** "December 3": the last day the pass can be used. */
export function useByLabel(useBy: Date): string {
  return new Date(`${voucherInstantToDay(useBy, "end")}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

export function signupUrl(origin: string, code: string, type: ContactType): string {
  return `${origin.replace(/\/$/, "")}/register?code=${encodeURIComponent(code)}&role=${type}`;
}

/**
 * One invite for one person. Plain on purpose, like a person's email: no
 * logo, no blocks of colour. A first email from a sender a mailbox has never
 * seen is judged on how much it looks like a newsletter.
 */
export function renderInvite(e: InviteEmailInput): RenderedInvite {
  const { settings: s, contact: c } = e;
  // A brand row's name is usually the brand itself ("Fashion Week Brooklyn"),
  // which is no name to greet: without a Company column, a brand's name is its
  // {{CompanyName}} and the greeting is "Hi there". With one, the name is the person's.
  const person = c.type === "brand"
    ? { displayName: c.company ? c.name || null : null, companyName: c.company ?? (c.name || null), role: c.type }
    : { displayName: c.name || null, companyName: c.company, role: c.type };
  const subject = merge(c.type === "brand" ? s.brandSubject : s.creatorSubject, person, { subject: true }).slice(0, 150);
  const body = merge(c.type === "brand" ? s.brandBody : s.creatorBody, person);
  const days = c.type === "brand" ? s.brandFreeDays : s.creatorFreeDays;
  const url = signupUrl(e.origin, e.code, c.type);
  const by = useByLabel(e.useBy);
  const offer = `Your free ${PASS_NAME[c.type]}: ${days} days of MTRLZD free. Use it by ${by}.`;
  const from = s.fromName || "MTRLZD";
  const why = `You're getting this one-off invitation from ${from}. If you'd rather not hear from us,`;
  const p = (inner: string, style = "margin:0 0 14px;") => `<p style="${style}">${inner}</p>`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:16px;background:#ffffff;">
<div style="max-width:560px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#222;">
${bodyToHtml(body).replace(/<p>/g, '<p style="margin:0 0 14px;">').replace(/<ul style="[^"]*">/g, '<ul style="margin:0 0 14px;padding-left:20px;">')}
${p(escapeHtml(offer))}
${p(`<a href="${escapeHtml(url)}" style="color:#1a56b0;font-weight:bold;">${escapeHtml(s.ctaLabel)}</a>`)}
${p(`Your code, if you're asked for it: <strong style="font-family:ui-monospace,Menlo,monospace;letter-spacing:.04em;">${escapeHtml(e.code)}</strong>`)}
${p(`${escapeHtml(why)} <a href="${escapeHtml(e.unsubscribeUrl)}" style="color:#888;">unsubscribe</a> and we won't email you again.`, "margin:28px 0 4px;font-size:12px;color:#888;")}
${s.postalAddress ? p(escapeHtml(s.postalAddress), "margin:0;font-size:12px;color:#888;") : ""}
</div></body></html>`;
  const text = [
    bodyToText(body), offer, `${s.ctaLabel}: ${url}`, `Your code, if you're asked for it: ${e.code}`,
    `${why} unsubscribe and we won't email you again: ${e.unsubscribeUrl}`, s.postalAddress ?? "",
  ].filter(Boolean).join("\n\n");
  return { subject, html, text, signupUrl: url };
}

/** The pass a sent invite carries, as a voucher row. Single use, for that kind of account. */
export function inviteVoucher(args: {
  code: string; campaignId: string; campaignName: string; contact: Contact;
  settings: Pick<CampaignSettings, "creatorFreeDays" | "brandFreeDays" | "useWithinDays">;
  now: Date; createdBy: string | null;
}) {
  const { contact: c, settings: s } = args;
  return {
    code: args.code,
    label: `${args.campaignName}: ${c.name || c.email}`.slice(0, 200),
    // Its partner is the campaign, so sign-ups show where they came from in
    // Admin > Activity, and the campaign can be given its own journey.
    partner: args.campaignName,
    grantType: "free_access" as const,
    roleRestriction: c.type,
    maxRedemptions: 1,
    freeDays: c.type === "brand" ? s.brandFreeDays : s.creatorFreeDays,
    expiresAt: new Date(args.now.getTime() + s.useWithinDays * 86_400_000),
    batchId: campaignBatchId(args.campaignId),
    assignedTo: c.email,
    createdBy: args.createdBy,
  };
}

export const campaignBatchId = (id: string) => `campaign:${id}`;
