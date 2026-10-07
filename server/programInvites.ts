/**
 * Program invites: a producer (or any account an admin switches on) invites
 * its designers and influencers from the app, one message, mail-merged.
 *
 * The client, 7 Oct 2026: Brooklyn's producers had the codes in a CSV and
 * were meant to email them out themselves, and they did not. "If we integrate
 * a CSV where the Producer... can Edit a message and Mail Merge with their
 * Designers/Influencers from the app itself. That eliminates their need to
 * open and create emails, search for voucher codes etc."
 *
 * Each invite mints its own single-use code. Its terms (free access or setup
 * fee waived, the end date, creator passes) are copied from a template code
 * the admin picked for that kind of seat, normally one of the program's
 * existing codes, so an invite gives exactly what the program already gives.
 * Fresh codes rather than the ones in the producers' CSVs: those may already
 * have been sent by hand, and two people holding one code means the second
 * one's sign-up silently falls back to a plain trial.
 *
 * Everything here is pure, so the rules are tested without a database.
 */

import { voucherInstantToDay } from "../shared/voucherDates";

export type SeatType = "brand" | "creator";

/** Words people put in a "type" column, to the seat they mean. */
export function seatTypeOf(raw: string | null | undefined): SeatType | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (/^(designer|designers|brand|brands|label|labels|house)$/.test(v)) return "brand";
  if (/^(influencer|influencers|creator|creators|talent|model|models)$/.test(v)) return "creator";
  return null;
}

export const SEAT_WORD: Record<SeatType, string> = { brand: "designer", creator: "influencer" };

/** {first_name} and {name} in a message, filled for one person. Unknown braces are left alone. */
export function mergeFields(template: string, person: { name: string }): string {
  const name = person.name.trim();
  const first = name.split(/\s+/)[0] || name;
  return template.replace(/\{\s*(first_name|firstname|first|name|full_name)\s*\}/gi, (_, key: string) =>
    /^(first_name|firstname|first)$/i.test(key) ? first : name);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** A typed message as safe email HTML: escaped, paragraphs and line breaks kept. */
export function messageToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export const MAX_MESSAGE = 3000;
export const MAX_SUBJECT = 150;
export const MAX_RECIPIENTS = 200;
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export interface RecipientIn { name?: unknown; email?: unknown; type?: unknown }
export interface Recipient { name: string; email: string; type: SeatType }
export type RecipientCheck = { ok: true; recipient: Recipient } | { ok: false; email: string; error: string };

/** One row, checked: a real email, a name (or one made from the email), and a seat type. */
export function checkRecipient(r: RecipientIn): RecipientCheck {
  const email = String(r.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, email, error: "Email doesn't look right" };
  const type = seatTypeOf(String(r.type ?? ""));
  if (!type) return { ok: false, email, error: "Choose designer or influencer" };
  const name = String(r.name ?? "").trim().slice(0, 120) || email.split("@")[0];
  return { ok: true, recipient: { name, email, type } };
}

/** The voucher fields an invite copies from its template, and what it sets itself. */
export interface TemplateVoucher {
  id: string;
  code: string;
  grantType: "free_access" | "waive_setup_fee";
  roleRestriction: string | null;
  activeFrom: Date | null;
  expiresAt: Date | null;
  freeDays: number | null;
  creatorPasses: number | null;
  partner: string | null;
  revokedAt: Date | null;
}

/** Why a template can't be used for this seat right now, or null when it can. */
export function templateProblem(t: TemplateVoucher | null | undefined, type: SeatType, now = new Date()): string | null {
  if (!t) return `Invites for ${SEAT_WORD[type]}s aren't set up yet`;
  if (t.revokedAt) return `The ${SEAT_WORD[type]} offer has been withdrawn`;
  if (t.expiresAt && t.expiresAt.getTime() <= now.getTime()) return `The ${SEAT_WORD[type]} offer has ended`;
  if (t.roleRestriction && t.roleRestriction !== type) return `The ${SEAT_WORD[type]} template code is for another kind of account`;
  return null;
}

export function inviteVoucherFromTemplate(args: {
  code: string;
  template: TemplateVoucher;
  type: SeatType;
  recipient: Recipient;
  sender: { id: string; name: string };
  programName: string;
}) {
  const t = args.template;
  return {
    code: args.code,
    label: `${args.programName}: ${args.recipient.name}`.slice(0, 200),
    grantType: t.grantType,
    brandUserId: null,
    roleRestriction: args.type,
    maxRedemptions: 1,
    activeFrom: t.activeFrom,
    expiresAt: t.expiresAt,
    freeDays: t.freeDays,
    // Designers get the program's creator passes; an influencer seat has none.
    creatorPasses: args.type === "brand" ? t.creatorPasses : null,
    partner: t.partner ?? args.programName,
    assignedTo: args.recipient.email,
    createdBy: args.sender.id,
    batchId: programBatchId(args.sender.id, args.type),
  };
}

export const programBatchId = (userId: string, type: SeatType) => `program:${userId}:${type}`;

/** "Free until 31 October" style wording for the email and the page. */
export function offerLine(t: Pick<TemplateVoucher, "grantType" | "expiresAt" | "freeDays">, type: SeatType): string {
  // A code's end is stored as the morning after its last day (see
  // shared/voucherDates.ts), so read it back as that last day.
  const until = t.expiresAt
    ? new Date(`${voucherInstantToDay(t.expiresAt, "end")}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })
    : null;
  if (t.grantType === "waive_setup_fee") return "Your setup fee is waived.";
  if (until) return `Free access until ${until}.`;
  if (t.freeDays) return `${t.freeDays} days of free access.`;
  return type === "brand" ? "Free access to MTRLZD." : "Free access to MTRLZD.";
}

export const DEFAULT_SUBJECT = "{sender} invited you to MTRLZD";

export const DEFAULT_MESSAGE = `Hi {first_name},

As part of our program, our sponsorship from MTRLZD gives you free access to in-video shopping: shoppable runways, influencer videos, backstage interviews and more.

Your invitation is below. It takes a minute to join.`;
